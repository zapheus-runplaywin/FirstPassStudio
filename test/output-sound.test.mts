// Sound on every output (music.ts, sequences.ts, mics.ts, scene.ts): the music and the Mac's mics are Output 1's. Every
// output plays its own video sound, but a sequence's music plays, fades and stops with the sequence on Output 1
// whatever other outputs play it, a sequence on another output alone plays without its music, and the music makes
// way for a video only on Output 1.
import test from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-output-sound-'));
const MEDIA = path.join(process.env.FIRSTPASS_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
for (const f of ['Walk out.m4a', 'Bed.mp3', 'Ad.mp4']) fs.writeFileSync(path.join(MEDIA, f), '');
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const outputs: typeof import('../out/outputs.js') = require('../out/outputs.js');
const scene: typeof import('../out/scene.js') = require('../out/scene.js');
const mics: typeof import('../out/mics.js') = require('../out/mics.js');
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
outputs.apply({ add: true });
outputs.apply({ output: outputs.state().outputs[1].id, name: 'Commentary' });
const two = () => outputs.find('commentary')!.id;

const ok = (a: unknown) => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const m = () => st().music;
const id = (name: string) => st().sources.find(s => s.name === name)!.id;
const wait = (sec: number) => mock.timers.tick(sec * 1000);
const step = (names: string[], sec = 10) => ({ sources: names.map(id), length: { type: 'time', sec } });

ok({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'browser', name: 'Worm', url: 'worm.html' },
  { type: 'video', name: 'Ad', file: 'Ad.mp4', sound: true, loop: true }] });

test('the music has no outputs to pick: an older music.json\'s Music plays on is dropped', () => {
  assert.equal('outputs' in m(), false);
  ok({ type: 'musicSettings', settings: { outputs: ['main', two()], fadeInSec: 0 } });
  assert.equal('outputs' in m(), false, 'the setting is gone');
  assert.equal(st().musicSettings.fadeInSec, 0, 'the rest of the change is taken');
});

test('a sequence\'s music plays with the sequence on Output 1, whatever other outputs play it', () => {
  ok({ type: 'seqAdd', changes: { name: 'Feature', playsOn: ['main', two()], music: { track: 'Walk out.m4a', fadeInSec: 0 }, musicEnd: { type: 'cut' },
    steps: [step(['Ladder']), step(['Worm'])] } });
  ok({ type: 'seqPlay', sequence: 'Feature' });
  assert.equal(m().status, 'playing');
  assert.equal(m().track, 'Walk out.m4a');
  // Stopped on Output 1: the music stops with it, though Commentary plays on.
  ok({ type: 'seqStop' });
  assert.equal(st().playing, null);
  assert.equal(m().status, 'stopped', 'the music is Output 1\'s');
  ok({ type: 'seqStop', output: two() });
});

test('a sequence played on another output alone plays without its music', () => {
  ok({ type: 'seqPlay', sequence: 'Feature', output: two(), only: true });
  assert.equal(st().playing, null);
  assert.equal(m().status, 'stopped', 'no music on Commentary');
  wait(10);
  wait(10);
  assert.equal(m().status, 'stopped');
});

test('cut away from on Output 1, a sequence\'s music fades out by its Music ends, though it plays on elsewhere', () => {
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'seqAdd', changes: { name: 'Pre-game', playsOn: ['main', two()], music: { track: 'Walk out.m4a', fadeInSec: 0 }, musicEnd: { type: 'fade', sec: 4 },
    steps: [step(['Ladder'], 60), step(['Worm'], 60)] } });
  ok({ type: 'seqPlay', sequence: 'Pre-game' });
  wait(5);
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(st().playing, null, 'stopped on Output 1');
  assert.equal(m().status, 'playing', 'fading out');
  assert.deepEqual([m().gain.to, m().gain.ms], [0, 4000], 'over its 4 s');
  wait(4);
  assert.equal(m().status, 'stopped', 'gone, though Commentary still plays the sequence');
  ok({ type: 'seqStop', output: two() });
  // Set to Cut, it goes at once.
  ok({ type: 'seqUpdate', sequence: 'Pre-game', changes: { musicEnd: { type: 'cut' } } });
  ok({ type: 'seqPlay', sequence: 'Pre-game' });
  wait(5);
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(m().status, 'stopped');
  ok({ type: 'seqStop', output: two() });
  ok({ type: 'seqUpdate', sequence: 'Pre-game', changes: { musicEnd: { type: 'fade', sec: 4 } } });
});

test('one song at a time: a sequence with music of its own takes over, and the old song fades out under it by its Music ends', () => {
  ok({ type: 'seqPlay', sequence: 'Pre-game' });
  wait(5);
  ok({ type: 'seqAdd', changes: { name: 'Main only', playsOn: ['main'], music: { track: 'Bed.mp3', fadeInSec: 0 }, steps: [step(['Ladder'], 60)] } });
  ok({ type: 'seqPlay', sequence: 'Main only' });
  assert.equal(m().track, 'Bed.mp3');
  assert.equal(m().status, 'playing');
  assert.equal(m().tail!.track, 'Walk out.m4a');
  assert.deepEqual([m().tail!.gain.to, m().tail!.gain.ms], [0, 4000]);
  wait(4);
  assert.equal(m().tail, null);
  ok({ type: 'seqStop' });
  ok({ type: 'seqStop', output: two() });
  ok({ type: 'musicStop', fade: 0 });
  assert.equal(m().status, 'stopped');
});

test('the music makes way for a video with sound only on Output 1', () => {
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

test('the mics are Output 1\'s: an older Goes to is dropped, and the meters come from every window mixing them', () => {
  ok({ type: 'micAdd', changes: { name: 'Court', device: 'USB Audio CODEC', outputs: ['main', two()] } });
  ok({ type: 'micAdd', changes: { name: 'Booth', device: 'USB Audio CODEC', channel: 'right' } });
  const court = () => st().mics.mics.find(x => x.name === 'Court'), booth = () => st().mics.mics.find(x => x.name === 'Booth');
  assert.equal('outputs' in court()!, false);
  ok({ type: 'micUpdate', mic: court()!.id, changes: { outputs: [two()], level: 90 } });
  assert.equal('outputs' in court()!, false, 'the setting is gone');
  assert.equal(court()!.level, 90, 'the rest of the change is taken');
  // Output 1's window and a sound copy's both report: the louder reading shows.
  mics.report({ output: 'main', devices: ['USB Audio CODEC'], levels: { [court()!.id]: -30, [booth()!.id]: -12 } });
  mics.report({ output: 'copy', devices: ['USB Audio CODEC'], levels: { [court()!.id]: -20 } });
  const live = mics.live();
  assert.equal(live.mixing, true);
  assert.deepEqual(live.levels, { [court()!.id]: -20, [booth()!.id]: -12 });
  wait(5);
  assert.equal(mics.live().mixing, false, 'no window reporting any more');
});
