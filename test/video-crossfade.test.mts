// A video's sound crossfading into the next step's music (sequences.ts planCross): music set to "crossfade from a
// video before it" starts its fade in time before the video ends, fading in while the video's sound fades out
// (soundOut on the source, which scene.html follows), and the music doesn't make way for that video meanwhile.
// The video's length comes from ffmpeg: a stand-in here says every video is 12 s long.
import test from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-crossfade-'));
const MEDIA = path.join(process.env.FIRSTPASS_DATA_DIR, 'media');
fs.mkdirSync(MEDIA, { recursive: true });
for (const f of ['Walk out.m4a', 'Bed.mp3', 'Hype.mp4']) fs.writeFileSync(path.join(MEDIA, f), '');
const ffmpeg = path.join(process.env.FIRSTPASS_DATA_DIR, 'ffmpeg');
fs.writeFileSync(ffmpeg, '#!/bin/sh\necho "  Duration: 00:00:12.00, start: 0.000000, bitrate: 100 kb/s" >&2\necho "    Stream #0:0: Video: vp9, yuv420p, 1920x1080" >&2\nexit 1\n');
fs.chmodSync(ffmpeg, 0o755);
const scene: typeof import('../out/scene.js') = require('../out/scene.js');
scene.init(() => {}, { ffmpeg });

const ok = (a: unknown) => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const m = () => st().music;
const src = (name: string) => st().sources.find(s => s.name === name);
const wait = (sec: number) => { for (let i = 0; i < Math.round(sec * 2); i++) mock.timers.tick(500); };

test("music set to crossfade from a video before it starts under the video's end while the video's sound fades out", async () => {
  // The stand-in ffmpeg measures the video (for real, before the clock is mocked).
  const end = Date.now() + 10000;
  while (!scene.videoSizes().length && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  assert.equal(scene.videoSizes().length, 1, 'the video was measured');
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    ok({ type: 'add', sources: [{ type: 'browser', name: 'Ladder', url: 'ladder.html' }, { type: 'video', name: 'Hype', file: 'Hype.mp4', sound: true }] });
    const ladder = src('Ladder')!.id, hype = src('Hype')!.id;
    ok({ type: 'seqAdd', changes: { name: 'Highlights', steps: [{ sources: [hype], length: { type: 'done' } }] } });
    ok({ type: 'seqAdd', changes: { name: 'Break bed', music: { track: 'Bed.mp3', fadeInSec: 4, underVideo: true }, steps: [{ sources: [ladder], length: { type: 'time', sec: 30 } }] } });
    assert.equal(st().sequences.find(s => s.name === 'Break bed')!.music!.underVideo, true, 'kept as set');
    const [hl, bed] = ['Highlights', 'Break bed'].map(n => st().sequences.find(s => s.name === n)!.id);
    // Both inside another sequence: the video's, then the music's.
    ok({ type: 'seqAdd', changes: { name: 'Quarter time', steps: [{ kind: 'sequence', sequence: hl }, { kind: 'sequence', sequence: bed }] } });
    ok({ type: 'seqPlay', sequence: 'Quarter time' });
    assert.equal(m().status, 'stopped');
    wait(7.5);
    assert.equal(m().status, 'stopped', 'no music yet');
    assert.equal(src('Hype')!.soundOut, undefined);
    wait(0.5); // 4 s before the 12 s video ends
    assert.equal(st().playing!.step, 0, 'still on the video');
    assert.equal(m().track, 'Bed.mp3', 'the music starts under the end of the video');
    assert.equal(m().status, 'playing');
    assert.equal(m().gain.to, 1);
    assert.equal(m().gain.ms, 4000, 'fading in over what is left of the video');
    assert.equal(src('Hype')!.soundOut!.main.ms, 4000, "while the video's sound fades out over the same time");
    assert.equal(src('Hype')!.soundOut!.main.showSeq, src('Hype')!.showSeq);
    assert.equal(m().video, null, "the music doesn't make way for the video whose sound is fading out");
    const playId = m().playId;
    // The video ends: on to the music's step, the same song carrying on.
    ok({ type: 'ended', id: hype, loadSeq: src('Hype')!.loadSeq, showSeq: src('Hype')!.showSeq });
    wait(0.5);
    assert.equal(st().playing!.step, 1);
    assert.equal(m().playId, playId, 'the same song carries on, not started again');
    assert.equal(m().status, 'playing');
    assert.equal(src('Hype')!.visible, false);
    assert.equal(src('Hype')!.soundOut, undefined, 'done with as the video goes off');
    ok({ type: 'seqStop' });
    wait(5);
    // Without the tick, the music starts with its own step as before, and makes way for nothing.
    ok({ type: 'seqUpdate', sequence: 'Break bed', changes: { music: { track: 'Bed.mp3', fadeInSec: 4 } } });
    ok({ type: 'seqPlay', sequence: 'Quarter time' });
    wait(10);
    assert.equal(m().status, 'stopped', 'not under the video');
    assert.equal(src('Hype')!.soundOut, undefined);
    ok({ type: 'ended', id: hype, loadSeq: src('Hype')!.loadSeq, showSeq: src('Hype')!.showSeq });
    wait(0.5);
    assert.equal(st().playing!.step, 1);
    assert.equal(m().status, 'playing', 'starts with its step');
    ok({ type: 'seqStop' });
  } finally { mock.timers.reset(); }
});
