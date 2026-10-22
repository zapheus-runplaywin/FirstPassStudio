// Sponsor ads (sponsors.js nextAd, sequences.js Sponsor ads steps, scene.js sponsorAd): a step plays the
// next ads in the sponsors' rotation in the Sponsor ad sources, each as long as it is; the house ad fills
// in when no sponsor has one; /deck/sponsor/ad plays one by hand.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sponsorads-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const competitions = require('../competitions');
const sponsors = require('../sponsors');
const scene = require('../scene');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
competitions.setActive(comp);
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const seq = name => st().sequences.find(s => s.name === name);
const wait = sec => mock.timers.tick(sec * 1000);
const media = f => { fs.mkdirSync(scene.MEDIA_DIR, { recursive: true }); fs.writeFileSync(path.join(scene.MEDIA_DIR, f), 'x'); };
const add = (name, tier, ads) => sponsors.save({ name, ads, competitions: { [comp]: { tier } } });

function reset() {
  scene.apply({ type: 'seqStop' });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  for (const s of sponsors.all()) sponsors.remove(s.id);
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }] });
}

test('a sponsor keeps up to 10 ads: videos and stills from the media folder, a still for 3 to 60 seconds', () => {
  reset();
  const s = add('Golds Bakery', 'major', [{ file: 'golds.mp4' }, { file: '../x/golds.png', seconds: 200 }, { file: 'notes.txt' }]);
  assert.deepEqual(s.ads, [{ file: 'golds.mp4', seconds: 8 }, { file: 'golds.png', seconds: 60 }]);
});

test('a Sponsor ads step plays the next ads in rotation, stills for their seconds, then moves on', () => {
  reset();
  media('golds.png'); media('wave.png');
  add('Golds Bakery', 'naming', [{ file: 'golds.png', seconds: 5 }]);
  add('Wave Physio', 'major', [{ file: 'wave.png', seconds: 4 }, { file: 'gone.png' }]);
  add('No Ads', 'elite', []);
  ok({ type: 'seqAdd', changes: { name: 'Break', steps: [{ kind: 'ads', count: 2 }] } });
  assert.deepEqual(seq('Break').steps[0], { id: seq('Break').steps[0].id, kind: 'ads', count: 2, house: true });
  ok({ type: 'seqPlay', sequence: 'Break' });
  const first = st().playing.ad;
  assert.ok(['Golds Bakery', 'Wave Physio'].includes(first));
  assert.deepEqual(on(), ['Sponsor ad (still)']);
  const still = st().sources.find(s => s.name === 'Sponsor ad (still)');
  assert.equal(still.file, first === 'Golds Bakery' ? 'golds.png' : 'wave.png');
  wait(first === 'Golds Bakery' ? 5 : 4);
  assert.equal(st().playing.step, 1);
  assert.notEqual(st().playing.ad, first, 'never the same sponsor twice running');
  assert.equal(st().sources.find(s => s.name === 'Sponsor ad (still)').file, first === 'Golds Bakery' ? 'wave.png' : 'golds.png', 'the file whose ad has gone is passed over');
  wait(5);
  assert.equal(st().playing, null);
  assert.deepEqual(on(), [], 'the ad goes off with the sequence');
});

test('a video ad lasts until it finishes; with no ads the house ad plays, or the step goes straight on', () => {
  reset();
  media('surf.mp4');
  add('Surf Club', 'partner', [{ file: 'surf.mp4' }]);
  ok({ type: 'seqAdd', changes: { name: 'Ads', steps: [{ kind: 'ads' }] } });
  ok({ type: 'seqPlay', sequence: 'Ads' });
  const video = st().sources.find(s => s.name === 'Sponsor ad (video)');
  assert.deepEqual([video.file, video.visible, video.sound, st().playing.length], ['surf.mp4', true, true, 'done']);
  ok({ type: 'ended', id: video.id, loadSeq: video.loadSeq });
  wait(0);
  assert.equal(st().playing, null, 'moved on when the video ended');

  for (const s of sponsors.all()) sponsors.remove(s.id);
  ok({ type: 'seqPlay', sequence: 'Ads' });
  assert.equal(st().playing.ad, 'House ad');
  assert.deepEqual(on(), ['House ad']);
  ok({ type: 'seqStop' });
  ok({ type: 'seqUpdate', sequence: seq('Ads').id, changes: { steps: [{ kind: 'ads', house: false }, { sources: [st().sources.find(s => s.name === 'Scoreboard').id], length: { type: 'time', sec: 5 } }] } });
  ok({ type: 'seqPlay', sequence: 'Ads' });
  wait(0);
  assert.equal(st().playing.step, 1, 'nothing to play: straight on');
  assert.deepEqual(on(), ['Scoreboard']);
});

test('/deck/sponsor/ad plays the next ad by hand, and says so when there is none', () => {
  reset();
  ok({ type: 'seqStop' });
  assert.equal(scene.deck(['sponsor', 'ad']).status, 404);
  media('golds.png');
  add('Golds Bakery', 'naming', [{ file: 'golds.png', seconds: 6 }]);
  const r = scene.deck(['sponsor', 'ad']);
  assert.deepEqual(r.body, { ok: true, sponsor: 'Golds Bakery', source: 'Sponsor ad (still)' });
  assert.deepEqual(on(), ['Sponsor ad (still)']);
  wait(6);
  assert.deepEqual(on(), [], 'a still goes off after its seconds');
});
