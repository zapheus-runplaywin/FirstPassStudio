// Music (music.js, through scene.js): the player, playlists, fades, getting out of the way of a video's
// sound, a sequence's own music, Quiet the music, and the /deck/music links.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-music-'));
const MEDIA = path.join(process.env.FIRSTPASS_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
for (const f of ['Pre-game bed.mp3', 'Walk out.m4a', 'Break.mp3', 'Ad.mp4']) fs.writeFileSync(path.join(MEDIA, f), '');
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const m = () => st().music;
const id = name => st().sources.find(s => s.name === name).id;
const link = (p, q) => scene.deck(p.split('/'), q);
const wait = sec => mock.timers.tick(sec * 1000);
const gain = () => { const g = m().gain; return !g.ms || Date.now() >= g.at + g.ms ? g.to : g.from + (g.to - g.from) * (Date.now() - g.at) / g.ms; };

function reset() {
  scene.apply({ type: 'seqStop' });
  ok({ type: 'musicStop', fade: 0 });
  ok({ type: 'musicDuck', value: 'off' });
  ok({ type: 'musicMute', value: 'off' });
  ok({ type: 'musicSettings', settings: { fadeInSec: 2, fadeOutSec: 2, underVideo: 'pause', duckHalf: false } });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().playlists]) ok({ type: 'playlistRemove', playlist: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'browser', name: 'Interview', url: 'lowerthird.html' },
    { type: 'video', name: 'Ad', file: 'Ad.mp4', sound: true }] });
}

test('load a song, play with a fade in, pause and carry on, and stop with a fade out', () => {
  reset();
  ok({ type: 'musicLoad', track: 'pre-game-bed' });
  assert.equal(m().track, 'Pre-game bed.mp3');
  assert.equal(m().status, 'stopped');
  ok({ type: 'musicPlay' });
  assert.equal(m().status, 'playing');
  assert.equal(gain(), 0);
  wait(1);
  assert.equal(gain(), 0.5);
  wait(9);
  ok({ type: 'musicPause', fade: 1 });
  wait(1);
  assert.equal(m().status, 'paused');
  assert.equal(Math.round(m().pos.sec), 11);
  wait(30);
  ok({ type: 'musicResume', fade: 0 });
  assert.equal(m().status, 'playing');
  assert.equal(gain(), 1);
  ok({ type: 'musicStop' });
  assert.equal(m().status, 'playing', 'still fading out');
  wait(2);
  assert.equal(m().status, 'stopped');
});

test('a playlist plays its songs in order, next and previous, and starts again after the last', () => {
  reset();
  ok({ type: 'playlistAdd', changes: { name: 'Pre-game', tracks: ['Pre-game bed.mp3', 'Walk out.m4a', 'Ad.mp4', 'nope.mp3'] } });
  assert.deepEqual(st().playlists[0].tracks, ['Pre-game bed.mp3', 'Walk out.m4a', 'nope.mp3'], 'only audio files');
  assert.equal(link('music/playlist/pre-game', { play: '', fade: '0' }).status, 200);
  assert.equal(m().track, 'Pre-game bed.mp3');
  const first = m().playId;
  ok({ type: 'musicEnded', playId: first });
  assert.equal(m().track, 'Walk out.m4a');
  ok({ type: 'musicEnded', playId: first }); // a second window saying the same thing
  assert.equal(m().track, 'Walk out.m4a');
  link('music/next');
  assert.equal(m().track, 'nope.mp3');
  ok({ type: 'musicEnded', playId: m().playId });
  assert.equal(m().track, 'Pre-game bed.mp3', 'round again');
  link('music/prev');
  assert.equal(m().track, 'nope.mp3');
  assert.equal(link('music/playlist/nothing').status, 404);
});

test('a video with its sound on fades the music out and pauses it, then it fades back in where it was', () => {
  reset();
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true, fade: 0 });
  wait(20);
  ok({ type: 'show', name: 'Ad' });
  assert.equal(m().video, 'pause');
  wait(1);
  assert.equal(m().status, 'paused');
  wait(30);
  ok({ type: 'hide', name: 'Ad' });
  assert.equal(m().status, 'playing');
  assert.equal(Math.round(m().pos.sec), 21);
  wait(1);
  assert.equal(gain(), 1);
  // Lower instead: it keeps playing at the lower level.
  ok({ type: 'musicSettings', settings: { underVideo: 'lower', lowerTo: 30 } });
  ok({ type: 'show', name: 'Ad' });
  assert.equal(m().status, 'playing');
  assert.equal(m().level, 30);
  ok({ type: 'ended', id: id('Ad'), loadSeq: st().sources.find(s => s.name === 'Ad').loadSeq });
  assert.equal(m().level, 100, 'the video ended and switched off');
});

test("a sequence's music starts at its step from the start mark, and fades out when the sequence ends", () => {
  reset();
  ok({ type: 'seqAdd', changes: { name: 'Run-up', music: { track: 'Pre-game bed.mp3', startStep: 2, startAtSec: 42, fadeInSec: 2 }, musicEnd: { type: 'fade', sec: 4 },
    steps: [{ sources: [id('Ladder')], length: { type: 'time', sec: 10 } }, { sources: [id('Ladder')], length: { type: 'time', sec: 10 } }] } });
  ok({ type: 'seqPlay', sequence: 'Run-up' });
  assert.equal(m().status, 'stopped');
  wait(10);
  assert.equal(m().track, 'Pre-game bed.mp3');
  assert.equal(m().pos.sec, 42);
  assert.equal(m().owner, st().sequences[0].id);
  wait(10);
  assert.equal(st().playing, null);
  assert.equal(m().status, 'playing', 'fading out');
  wait(4);
  assert.equal(m().status, 'stopped');
});

test('music carries on into the next sequence, and going to a scene fades it out', () => {
  reset();
  ok({ type: 'show', name: 'Ladder' });
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'hide', name: 'Ladder' });
  ok({ type: 'seqAdd', changes: { name: 'Walk out', steps: [{ sources: [id('Interview')], length: { type: 'next' } }] } });
  ok({ type: 'seqAdd', changes: { name: 'Run-up', music: { track: 'Walk out.m4a' }, musicEnd: { type: 'continue' }, then: { type: 'sequence', sequence: st().sequences[0].id },
    steps: [{ sources: [id('Ladder')], length: { type: 'time', sec: 10 } }] } });
  ok({ type: 'seqPlay', sequence: 'Run-up' });
  const playId = m().playId;
  wait(10);
  assert.equal(st().sequences.find(s => s.id === st().playing.id).name, 'Walk out');
  assert.equal(m().playId, playId, 'the same song carries on');
  assert.equal(m().owner, st().playing.id);
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(st().playing, null);
  wait(3);
  assert.equal(m().status, 'stopped');
});

test('Quiet the music: a scene ducks the player, the next scene brings it back; a sequence\'s music fades out', () => {
  reset();
  ok({ type: 'show', name: 'Interview' });
  ok({ type: 'sceneSave', name: 'Interview' });
  ok({ type: 'sceneUpdate', scene: 'Interview', changes: { quiet: true } });
  ok({ type: 'hide', name: 'Interview' });
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true });
  ok({ type: 'sceneGo', scene: 'Interview' });
  assert.equal(m().ducked, true);
  assert.equal(m().status, 'playing');
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(m().ducked, false);
  // A sequence's music stops instead.
  ok({ type: 'seqAdd', changes: { name: 'Break', music: { track: 'Break.mp3' }, steps: [{ sources: [id('Ladder')], length: { type: 'next' } }] } });
  ok({ type: 'seqPlay', sequence: 'Break' });
  ok({ type: 'sceneGo', scene: 'Interview' });
  wait(3);
  assert.equal(m().status, 'stopped');
  assert.equal(m().ducked, false);
});

test('the music links: toggle, fade, mute and duck, and ?fade=0 cuts', () => {
  reset();
  assert.equal(link('music/load/break').status, 200);
  link('music/toggle', { fade: '0' });
  assert.equal(m().status, 'playing');
  assert.equal(gain(), 1);
  link('music/mute/on');
  assert.equal(m().muted, true);
  link('music/duck/toggle');
  assert.equal(m().ducked, true);
  link('music/stop', { fade: '0' });
  assert.equal(m().status, 'stopped');
  assert.equal(link('music/load/nothing').status, 404);
  assert.equal(link('music/whatever'), null);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'music.json'), 'utf8'));
  assert.equal(saved.settings.fadeInSec, 2);
});

test('the duck fades over the fade time, and ?fade sets its own', () => {
  reset();
  const down = () => { const d = m().duck; return !d.ms || Date.now() >= d.at + d.ms ? d.to : d.from + (d.to - d.from) * (Date.now() - d.at) / d.ms; };
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true, fade: 0 });
  ok({ type: 'musicDuck', value: 'on' });
  assert.equal(m().ducked, true);
  assert.equal(m().duck.ms, 2000);
  wait(1);
  assert.ok(Math.abs(down() - 0.5) < 0.01);
  wait(1);
  assert.equal(down(), 1);
  // Fades ease in and out: turned back a quarter of the way through, it starts from where it's heard.
  ok({ type: 'musicDuck', value: 'off' });
  wait(0.5);
  ok({ type: 'musicDuck', value: 'on' });
  assert.ok(Math.abs(m().duck.from - (1 - 0.15625)) < 0.001);
  wait(2);
  link('music/duck/off', { fade: '0' });
  assert.equal(m().ducked, false);
  assert.equal(down(), 0);
  // Quiet the music ducks over the fade out time too.
  ok({ type: 'musicSettings', settings: { fadeInSec: 2, fadeOutSec: 4 } });
  ok({ type: 'show', name: 'Interview' });
  ok({ type: 'sceneSave', name: 'Interview' });
  ok({ type: 'sceneUpdate', scene: 'Interview', changes: { quiet: true } });
  ok({ type: 'sceneGo', scene: 'Interview' });
  assert.equal(m().duck.ms, 4000);
  assert.equal(m().duck.to, 1);
  // Back up over the fade in time; over half the fade times when set; a link's ?fade still sets its own.
  ok({ type: 'musicDuck', value: 'off' });
  assert.equal(m().duck.ms, 2000);
  ok({ type: 'musicSettings', settings: { duckHalf: true } });
  ok({ type: 'musicDuck', value: 'on' });
  assert.equal(m().duck.ms, 2000);
  ok({ type: 'musicDuck', value: 'off' });
  assert.equal(m().duck.ms, 1000);
  link('music/duck/on', { fade: '3' });
  assert.equal(m().duck.ms, 3000);
  ok({ type: 'musicSettings', settings: { duckHalf: false } });
});

test('separate fade in and fade out times', () => {
  reset();
  ok({ type: 'musicSettings', settings: { fadeInSec: 1, fadeOutSec: 5 } });
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true });
  assert.equal(m().gain.ms, 1000);
  wait(2);
  ok({ type: 'musicPause' });
  assert.equal(m().gain.ms, 5000);
  wait(5);
  assert.equal(m().status, 'paused');
  ok({ type: 'musicResume' });
  assert.equal(m().gain.ms, 1000);
  ok({ type: 'musicStop' });
  assert.equal(m().gain.ms, 5000);
  wait(5);
  assert.equal(m().status, 'stopped');
});

test('the super shot song cuts in when the super shot period starts and fades out when it ends', () => {
  reset();
  ok({ type: 'musicSettings', settings: { superShotSong: 'walk-out', superShotVolume: 60, fadeOutSec: 4 } });
  ok({ type: 'musicLoad', track: 'Break.mp3', play: true, fade: 0 });
  const g = (superShot, running = true, period = 1) => scene.game({ id: 'g1', period, superShot, running, left: 100, last: 4 });
  g(false);
  assert.equal(m().track, 'Break.mp3');
  g(true, false); // clock stopped: waits
  assert.equal(m().track, 'Break.mp3');
  g(true);
  assert.equal(m().track, 'Walk out.m4a');
  assert.equal(m().owner, 'supershot');
  assert.equal(m().gain.ms, 0, 'cuts in');
  assert.equal(m().volume, 60);
  g(false); // the period ends
  assert.equal(m().gain.ms, 4000);
  wait(4);
  assert.equal(m().status, 'stopped');
  assert.equal(m().volume, 80);
  // Once a quarter: stopped by hand, it doesn't come back until the next quarter.
  g(true, true, 2);
  ok({ type: 'musicStop', fade: 0 });
  g(true, true, 2);
  assert.equal(m().status, 'stopped');
  g(true, true, 3);
  assert.equal(m().status, 'playing');
  ok({ type: 'musicStop', fade: 0 });
  ok({ type: 'musicSettings', settings: { superShotSong: '' } });
});
