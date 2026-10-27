// Mics (mics.js, through scene.js): adding and changing mics, mutes and levels, the dips under music, a video's
// sound and quiet scenes, the /deck/mics and /deck/mic links, saving, and what the output window reports.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mics-'));
const MEDIA = path.join(process.env.FIRSTPASS_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
for (const f of ['Break.mp3', 'Ad.mp4']) fs.writeFileSync(path.join(MEDIA, f), '');
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
const mics = require('../mics');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const x = () => st().mics;
const link = (p, q) => scene.deck(p.split('/'), q);
const wait = sec => mock.timers.tick(sec * 1000);
const down = () => { const d = x().dip; return !d.ms || Date.now() >= d.at + d.ms ? d.to : null; };
const id = name => st().sources.find(s => s.name === name).id;

function reset() {
  scene.apply({ type: 'seqStop' });
  ok({ type: 'musicStop', fade: 0 });
  ok({ type: 'micsDip', value: 'off' });
  ok({ type: 'micsMute', value: 'off' });
  ok({ type: 'micsSettings', settings: { level: 100, dipTo: 30, dipMusic: true, dipVideo: true, dipQuiet: true, dipDownSec: 1, dipUpSec: 2 } });
  for (const m of [...x().mics]) ok({ type: 'micRemove', mic: m.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'video', name: 'Ad', file: 'Ad.mp4', sound: true }] });
  wait(5);
}

test('add mics, change them, mute them and set their levels; names stay unique', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic', device: 'RØDE Wireless GO II RX', channel: 'left' } });
  ok({ type: 'micAdd', changes: { name: 'Court mic', device: 'RØDE Wireless GO II RX', channel: 'right', lowCut: false } });
  const [a, b] = x().mics;
  assert.equal(a.name, 'Court mic');
  assert.equal(b.name, 'Court mic 2');
  assert.deepEqual([a.channel, a.level, a.muted, a.lowCut, a.follow], ['left', 100, false, true, true]);
  assert.equal(b.lowCut, false);
  ok({ type: 'micUpdate', mic: b.id, changes: { name: 'Crowd mic', channel: 'sideways', level: 500 } });
  assert.equal(x().mics[1].name, 'Crowd mic');
  assert.equal(x().mics[1].channel, 'both', 'an unknown channel is both');
  assert.equal(x().mics[1].level, 200, 'levels go up to 200%');
  ok({ type: 'micMute', mic: 'crowd-mic', value: 'toggle' });
  assert.equal(x().mics[1].muted, true);
  ok({ type: 'micLevel', mic: '1', by: -30 });
  assert.equal(x().mics[0].level, 70, 'a mic by its number');
  ok({ type: 'micsLevel', by: 20 });
  assert.equal(x().level, 100, 'the master level stops at 100%');
  assert.match(scene.apply({ type: 'micMute', mic: 'nobody' }), /No mic "nobody"/);
  for (let i = 0; i < 6; i++) ok({ type: 'micAdd', changes: { name: 'Spare' } });
  assert.match(scene.apply({ type: 'micAdd', changes: { name: 'One too many' } }), /up to 8 mics/);
});

test('the mics are saved in mics.json and read back', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic', device: 'USB Audio CODEC', channel: 'right', level: 120 } });
  ok({ type: 'micsSettings', settings: { dipTo: 40, dipMusic: false } });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'mics.json'), 'utf8'));
  assert.equal(saved.dipTo, 40);
  assert.equal(saved.dipMusic, false);
  assert.deepEqual(saved.mics.map(m => [m.name, m.device, m.channel, m.level]), [['Court mic', 'USB Audio CODEC', 'right', 120]]);
  mics.init(() => {});
  assert.deepEqual(x().mics.map(m => m.name), ['Court mic']);
  assert.equal(x().dipTo, 40);
});

test('the mics dip while music plays, and come back up when it stops', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic' } });
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true });
  assert.equal(x().dipped, true);
  assert.deepEqual(x().why, ['music playing']);
  assert.equal(down(), null, 'still going down');
  wait(1);
  assert.equal(down(), 1, 'down after the dip down time');
  ok({ type: 'musicStop', fade: 0 });
  assert.equal(x().dipped, false);
  wait(2);
  assert.equal(down(), 0);
  // Not with the music tick box off.
  ok({ type: 'micsSettings', settings: { dipMusic: false } });
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true });
  assert.equal(x().dipped, false);
  // A muted player isn't heard, so the mics stay up.
  ok({ type: 'micsSettings', settings: { dipMusic: true } });
  assert.equal(x().dipped, true);
  ok({ type: 'musicMute', value: 'on' });
  assert.equal(x().dipped, false);
  ok({ type: 'musicMute', value: 'off' });
});

test('the mics dip under a video with its sound on, and for a scene that quiets the music, even with no music', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic' } });
  ok({ type: 'show', id: id('Ad') });
  assert.deepEqual(x().why, ['a video with sound']);
  ok({ type: 'hide', id: id('Ad') });
  assert.equal(x().dipped, false);
  ok({ type: 'sceneSave', name: 'Interview' });
  ok({ type: 'sceneUpdate', scene: 'Interview', changes: { quiet: true } });
  ok({ type: 'sceneSave', name: 'Live game' });
  ok({ type: 'sceneGo', scene: 'Interview' });
  assert.deepEqual(x().why, ['a quiet scene']);
  ok({ type: 'sceneGo', scene: 'Live game' });
  assert.equal(x().dipped, false);
});

test('Dip by hand, and a mic that does not follow the dips keeps its setting', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Commentary', follow: false } });
  ok({ type: 'micsDip', value: 'toggle' });
  assert.equal(x().hand, true);
  assert.deepEqual(x().why, ['by hand']);
  assert.equal(x().mics[0].follow, false);
  ok({ type: 'micsDip', value: 'toggle' });
  assert.equal(x().dipped, false);
});

test('the /deck/mics and /deck/mic links', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic' } });
  let r = link('mics/mute/toggle');
  assert.equal(r.status, 200);
  assert.equal(r.body.muted, true);
  r = link('mics/mute/off');
  assert.equal(r.body.muted, false);
  r = link('mics/down', { by: '25' });
  assert.equal(r.body.level, 75);
  r = link('mics/up');
  assert.equal(r.body.level, 85);
  r = link('mics/level/60');
  assert.equal(r.body.level, 60);
  r = link('mics/dip/on');
  assert.equal(r.body.dipped, true);
  link('mics/dip/off');
  r = link('mic/court-mic/mute/toggle');
  assert.deepEqual([r.body.mic, r.body.muted], ['Court mic', true]);
  r = link('mic/1/down');
  assert.equal(r.body.level, 90);
  assert.equal(link('mic/nobody/up').status, 404);
  assert.equal(link('mics/sideways').status, 404);
  assert.equal(link('layer/x/flip') === null || link('layer/x/flip').status !== 200, true);
});

test('what the output window hears: devices, levels and trouble, forgotten once it stops saying', () => {
  reset();
  ok({ type: 'micAdd', changes: { name: 'Court mic', device: 'USB Audio CODEC' } });
  const [m] = x().mics;
  mics.report({ devices: ['USB Audio CODEC', 'MacBook Pro Microphone'], levels: { [m.id]: -18.4, other: -3 }, problems: {}, status: '' });
  let live = mics.live();
  assert.equal(live.mixing, true);
  assert.deepEqual(live.devices, ['USB Audio CODEC', 'MacBook Pro Microphone']);
  assert.deepEqual(live.levels, { [m.id]: -18 }, 'only the mics Studio knows');
  wait(4);
  live = mics.live();
  assert.equal(live.mixing, false);
  assert.deepEqual(live.levels, {});
  // The Output page in the Mac app lists the inputs before any output is on.
  mics.devicesListed(['Scarlett 2i2 USB']);
  assert.deepEqual(mics.live().devices, ['Scarlett 2i2 USB']);
});
