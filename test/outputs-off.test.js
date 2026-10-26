// An output set to Web links only is off (outputs.js clean): never switched on, by the Output page, a Stream Deck link or an
// older outputs.json; and what's on an output that isn't sending isn't on air in the sponsors' exposure report
// (scene.js showing, exposure.js), even while another output is.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-off-'));
// Saved before Web links only counted as off: Output 1 set to Web links only but switched on.
fs.writeFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'outputs.json'), JSON.stringify({ mode: 'off', on: true }));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 24, 19, 0, 0).getTime() });
const competitions = require('../competitions');
const sponsors = require('../sponsors');
const exposure = require('../exposure');
const outputs = require('../outputs');
const scene = require('../scene');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
competitions.setActive(comp);
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
outputs.message({ type: 'ndi', ok: true });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
exposure.init(() => {}, { showing: scene.showing, onAir: outputs.sponsorsOnAir, every: 0 });

const main = () => outputs.state().outputs[0];
const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));

test('an output set to Web links only is off, whatever turns it on', () => {
  assert.equal(main().on, false, 'an older outputs.json');
  outputs.apply({ on: true });
  assert.equal(main().on, false, 'Output on');
  assert.equal(outputs.deck(['output', 'toggle']).body.on, false, 'the Stream Deck toggle');
  assert.equal(outputs.deck(['output', 'on']).body.on, false, 'the Stream Deck on');
  outputs.apply({ add: true, name: 'Wide camera' });
  outputs.apply({ output: 'wide-camera', mode: 'ndi', ndiName: 'Wide', on: false });
  outputs.deck(['output', 'all', 'on']);
  assert.equal(main().on, false, 'every output on leaves Output 1 off');
  assert.equal(outputs.find('wide-camera').on, true);
  assert.deepEqual(outputs.summary().map(o => o.sending), [false, true]);
  assert.equal(outputs.state().previewSound, true, 'Output 1 isn\'t sending, so the Scene View has the sound');
  // Set up, it can be switched on; set to Web links only again, it's off.
  outputs.apply({ mode: 'ndi', on: true });
  assert.equal(main().on, true);
  outputs.apply({ mode: 'off' });
  assert.equal(main().on, false);
});

test('what\'s on an output that isn\'t sending isn\'t on air for sponsors, while another output is', () => {
  const golds = sponsors.save({ name: 'Golds Bakery', competitions: { [comp]: { tier: 'naming' } } });
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }] });
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'show', name: 'Scoreboard', output: outputs.find('wide-camera').id });
  exposure.gave({ headers: { referer: 'http://studio.local:8080/scoreboard.html' } }, [golds], 'scoreboard');
  const seconds = offAir => (exposure.report({ competition: comp, offAir }).sponsors.find(s => s.name === 'Golds Bakery') || { seconds: 0 }).seconds;
  const pass = n => { for (let i = 0; i < n; i++) { mock.timers.tick(1000); exposure.tick(); } };

  // Wide camera counts for sponsors but has nothing of Golds on it until it's ticked; Output 1 is set to Web links only.
  assert.deepEqual(scene.showing().map(s => [s.name, s.air]), [['Scoreboard', false]]);
  pass(10);
  assert.equal(seconds(false), 0, 'not on air: Output 1 is set to Web links only');
  assert.ok(seconds(true) >= 9, 'off air it\'s still counted');

  outputs.apply({ output: 'wide-camera', sponsors: true });
  assert.deepEqual(scene.showing().map(s => [s.name, s.air]), [['Scoreboard', false], ['Scoreboard (Wide camera)', true]]);
  pass(10);
  assert.ok(seconds(false) >= 9 && seconds(false) <= 11, `${seconds(false)} s on air`);
  const where = exposure.report({ competition: comp }).sponsors.find(s => s.name === 'Golds Bakery').showings.map(x => x.source);
  assert.deepEqual([...new Set(where)], ['Scoreboard (Wide camera)'], 'on air on Wide camera only, not on Output 1');
});
