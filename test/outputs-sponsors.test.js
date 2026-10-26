// Sponsor ads and exposure with more than one output (scene.js sponsorAd and showing, outputs.js sponsors): an
// ads step plays on any output, in that output's own ad sources; what's on another output counts for sponsors
// only with Counts for sponsors ticked; an output's ad sources go with it.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-sponsors-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const competitions = require('../competitions');
const sponsors = require('../sponsors');
const exposure = require('../exposure');
const outputs = require('../outputs');
const scene = require('../scene');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
competitions.setActive(comp);
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
exposure.init(() => {}, { every: 0 });
outputs.apply({ add: true });
outputs.apply({ output: outputs.state().outputs[1].id, name: 'Wide camera' });
const two = () => outputs.find('wide-camera').id;

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const wait = sec => mock.timers.tick(sec * 1000);
fs.mkdirSync(scene.MEDIA_DIR, { recursive: true });
fs.writeFileSync(path.join(scene.MEDIA_DIR, 'golds.png'), 'x');
sponsors.save({ name: 'Golds Bakery', ads: [{ file: 'golds.png', seconds: 5 }], competitions: { [comp]: { tier: 'major' } } });
ok({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }] });
ok({ type: 'seqAdd', changes: { name: 'Ads', steps: [{ kind: 'ads' }] } });

test('an ads step on another output plays in that output\'s own ad source, there only', () => {
  ok({ type: 'seqPlay', sequence: 'Ads', output: two() });
  assert.equal(st().playingOut[two()].ad, 'Golds Bakery');
  const src = st().sources.find(s => s.name === 'Sponsor ad (still), Wide camera');
  assert.ok(src, st().sources.map(s => s.name).join());
  assert.equal(src.out[two()], true);
  assert.equal(src.visible, false, 'not on Output 1');
  assert.equal(st().sources.find(s => s.name === 'Sponsor ad (still)'), undefined, 'Output 1\'s ad source isn\'t touched');
  wait(5);
  assert.equal(st().playingOut[two()], undefined);
  assert.ok(!st().sources.find(s => s.name === 'Sponsor ad (still), Wide camera').out[two()]);
});

test('another output counts for sponsors only when ticked; Output 1 always does', () => {
  ok({ type: 'show', name: 'Scoreboard', output: two() });
  assert.deepEqual(scene.showing().map(s => s.name), [], 'nothing on Output 1, and Wide camera doesn\'t count');
  assert.equal(outputs.summary().find(o => o.id === two()).sponsors, false);
  assert.equal(outputs.summary()[0].sponsors, true);
  assert.equal(outputs.apply({ output: two(), sponsors: true }), null);
  assert.deepEqual(scene.showing().map(s => s.name), ['Scoreboard (Wide camera)']);
  ok({ type: 'show', name: 'Scoreboard' });
  assert.deepEqual(scene.showing().map(s => s.name).sort(), ['Scoreboard', 'Scoreboard (Wide camera)']);
  assert.equal(outputs.apply({ output: two(), sponsors: false }), null);
  assert.deepEqual(scene.showing().map(s => s.name), ['Scoreboard']);
});

test('an ad on an output that doesn\'t count isn\'t a play in the report; on one that counts it is', () => {
  const plays = () => (exposure.report({ competition: comp, offAir: true }).sponsors.find(s => s.name === 'Golds Bakery') || { plays: 0 }).plays;
  const before = plays();
  ok({ type: 'seqPlay', sequence: 'Ads', output: two() });
  wait(5);
  assert.equal(plays(), before);
  assert.equal(outputs.apply({ output: two(), sponsors: true }), null);
  ok({ type: 'seqPlay', sequence: 'Ads', output: two() });
  wait(5);
  assert.equal(plays(), before + 1);
});

test('a removed output\'s ad sources go with it', () => {
  outputs.apply({ remove: two() });
  assert.deepEqual(st().sources.filter(s => /Sponsor ad|House ad/.test(s.name)).map(s => s.name), []);
});
