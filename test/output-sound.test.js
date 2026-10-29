// Sound on every output (music.js, sequences.js, mics.js, scene.js): the music plays on the outputs ticked in Music
// plays on (Output 1 unless set), a sequence's music on every output playing that sequence (and the last of them to
// end ends it), each mic goes to the outputs ticked for it, and the music makes way for a video only on its outputs.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-output-sound-'));
const MEDIA = path.join(process.env.FIRSTPASS_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
for (const f of ['Walk out.m4a', 'Ad.mp4']) fs.writeFileSync(path.join(MEDIA, f), '');
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const outputs = require('../outputs');
const scene = require('../scene');
const mics = require('../mics');
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
outputs.apply({ add: true });
outputs.apply({ output: outputs.state().outputs[1].id, name: 'Commentary' });
const two = () => outputs.find('commentary').id;

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const m = () => st().music;
const id = name => st().sources.find(s => s.name === name).id;
const wait = sec => mock.timers.tick(sec * 1000);
const step = (names, sec = 10) => ({ sources: names.map(id), length: { type: 'time', sec } });

ok({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'browser', name: 'Worm', url: 'worm.html' },
  { type: 'video', name: 'Ad', file: 'Ad.mp4', sound: true, loop: true }] });

test('the player\'s music plays on Output 1 unless Music plays on says otherwise', () => {
  assert.deepEqual(m().outputs, ['main']);
  ok({ type: 'musicSettings', settings: { outputs: ['main', two()] } });
  assert.deepEqual(m().outputs, ['main', two()]);
  ok({ type: 'musicSettings', settings: { outputs: [] } });
  assert.deepEqual(m().outputs, ['main'], 'never on no output at all');
  ok({ type: 'musicSettings', settings: { fadeInSec: 0 } });
  assert.deepEqual(m().outputs, ['main'], 'another setting leaves it as it was');
});

test('a sequence\'s music plays on the outputs playing it, and the last of them to end ends it', () => {
  ok({ type: 'seqAdd', changes: { name: 'Feature', playsOn: ['main', two()], music: { track: 'Walk out.m4a', fadeInSec: 0 }, musicEnd: { type: 'cut' },
    steps: [step(['Ladder']), step(['Worm'])] } });
  ok({ type: 'seqPlay', sequence: 'Feature' });
  assert.equal(m().status, 'playing');
  assert.deepEqual(m().outputs.sort(), ['main', two()].sort());
  // Stopped on Output 1 alone: Commentary carries on with the music.
  ok({ type: 'seqStop' });
  assert.equal(st().playing, null);
  assert.equal(m().status, 'playing', 'still playing for Commentary');
  assert.deepEqual(m().outputs, [two()]);
  ok({ type: 'seqStop', output: two() });
  assert.equal(m().status, 'stopped');
});

test('a sequence played on another output alone brings its music there, not to Output 1', () => {
  ok({ type: 'seqPlay', sequence: 'Feature', output: two(), only: true });
  assert.equal(st().playing, null);
  assert.equal(m().status, 'playing');
  assert.deepEqual(m().outputs, [two()]);
  wait(10);
  wait(10);
  assert.equal(m().status, 'stopped', 'it ends with the sequence');
  assert.deepEqual(m().outputs, ['main'], 'back to Music plays on');
});

test('the music makes way for a video with sound only on an output it plays on', () => {
  ok({ type: 'musicSettings', settings: { underVideo: 'pause' } });
  ok({ type: 'musicLoad', track: 'Walk out.m4a', play: true, fade: 0 });
  ok({ type: 'show', name: 'Ad', output: two() });
  assert.equal(m().video, null, 'the ad is on Commentary, the music on Output 1');
  ok({ type: 'show', name: 'Ad' });
  assert.notEqual(m().video, null, 'on Output 1 too: the music gets out of the way');
  ok({ type: 'hide', name: 'Ad' });
  ok({ type: 'hide', name: 'Ad', output: two() });
  ok({ type: 'musicStop', fade: 0 });
});

test('each mic goes to the outputs ticked for it (Output 1 unless set), and the meters come from every window', () => {
  ok({ type: 'micAdd', changes: { name: 'Court', device: 'USB Audio CODEC' } });
  ok({ type: 'micAdd', changes: { name: 'Booth', device: 'USB Audio CODEC', channel: 'right' } });
  const court = () => st().mics.mics.find(x => x.name === 'Court'), booth = () => st().mics.mics.find(x => x.name === 'Booth');
  assert.deepEqual(court().outputs, ['main']);
  ok({ type: 'micUpdate', mic: court().id, changes: { outputs: ['main', two()] } });
  assert.deepEqual(court().outputs, ['main', two()]);
  assert.deepEqual(booth().outputs, ['main'], 'the commentators\' own mic stays off their feed');
  ok({ type: 'micUpdate', mic: court().id, changes: { level: 90 } });
  assert.deepEqual(court().outputs, ['main', two()], 'kept through another change');
  mics.report({ output: 'main', devices: ['USB Audio CODEC'], levels: { [court().id]: -30, [booth().id]: -12 } });
  mics.report({ output: two(), devices: ['USB Audio CODEC'], levels: { [court().id]: -20 } });
  const live = mics.live();
  assert.equal(live.mixing, true);
  assert.deepEqual(live.levels, { [court().id]: -20, [booth().id]: -12 });
  wait(5);
  assert.equal(mics.live().mixing, false, 'no window reporting any more');
});
