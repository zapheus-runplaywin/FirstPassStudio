// Sequences that start by themselves from the game (sequences.js game(), through scene.js): before the
// start, at the breaks and full time, the pending start with Start now / Cancel, "until the game
// moves on", "repeat until", and the Automatic sequences switch.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-triggers-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const seq = name => st().sequences.find(s => s.name === name);
const step = (names, length = { type: 'time', sec: 20 }) => ({ sources: names.map(id), length });
const link = p => scene.deck(p.split('/'));
const playingName = () => st().playing && st().sequences.find(s => s.id === st().playing.id).name;

// The game, as server.js sends it each second. tick() moves time on a second at a time, sending it each time.
let g;
let gameNo = 0;
function newGame(changes = {}) {
  g = { id: `g${++gameNo}`, label: 'Stormz v Titans on Court 1', startAt: Date.now() + 30 * 60000, period: 1, last: 4, left: 600, running: false, onBreak: false, finished: false, ...changes };
  scene.game(g);
}
function tick(sec = 1) {
  for (let i = 0; i < sec; i++) {
    mock.timers.tick(1000);
    if (g.running && g.left > 0) g.left--;
    if (g.left === 0) g.running = false;
    scene.game(g);
  }
}
const set = changes => { Object.assign(g, changes); scene.game(g); };
// Plays a quarter out to the siren and the few seconds it takes to count.
function siren() { set({ left: 3, running: true }); tick(3); tick(3); }

function reset() {
  scene.apply({ type: 'seqStop' });
  scene.apply({ type: 'seqCancel' });
  ok({ type: 'seqAuto', value: 'on' });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: ['Scoreboard', 'Ladder', 'Fixtures', 'Countdown', 'Shooting', 'Winner'].map(name => ({ type: 'browser', name, url: `${name.toLowerCase()}.html` })) });
  newGame();
}
function make(name, changes) { ok({ type: 'seqAdd', changes: { name, ...changes } }); return seq(name); }

test('a sequence set to start N minutes before the game starts then, and the Output page is told when', () => {
  reset();
  make('Run-up', { start: { type: 'before', min: 10 }, steps: [step(['Countdown'], { type: 'game' })] });
  assert.equal(st().nextAuto.id, seq('Run-up').id);
  assert.equal(st().nextAuto.at, g.startAt - 10 * 60000);
  tick(19 * 60 + 59);
  assert.equal(st().playing, null);
  tick(1);
  assert.equal(playingName(), 'Run-up');
  assert.deepEqual(on(), ['Countdown']);
  assert.equal(st().nextAuto, null);
  // Until the game moves on: the first bounce.
  tick(9 * 60);
  set({ running: true });
  assert.equal(st().playing, null);
  assert.deepEqual(on(), []);
});

test('repeat until N minutes before the start finishes the step on screen, then the next sequence starts', () => {
  reset();
  make('Run-up', { start: { type: 'before', min: 10 }, repeat: 'until', until: { moment: 'before', min: 2 }, steps: [step(['Ladder'], { type: 'time', sec: 50 }), step(['Fixtures'], { type: 'time', sec: 50 })] });
  make('Walk out', { start: { type: 'before', min: 2 }, steps: [step(['Countdown'], { type: 'next' })] });
  tick(20 * 60);
  assert.equal(playingName(), 'Run-up');
  // 8 minutes of 100 s loops: 4 loops and 80 s, so Fixtures is 30 s into its step at 2 minutes before.
  tick(8 * 60);
  assert.equal(st().playing.finishing, true, 'Run-up is finishing its step');
  assert.ok(st().pending, 'Walk out waits for it');
  assert.equal(st().pending.leftMs, null);
  assert.deepEqual(on(), ['Fixtures']);
  tick(20);
  assert.equal(playingName(), 'Walk out');
  assert.deepEqual(on(), ['Countdown']);
});

test('a break sequence starts a few seconds after the siren at the breaks it is ticked for, repeats until play resumes, then goes to its scene', () => {
  reset();
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Game' });
  const game = st().scenes.find(s => s.name === 'Game').id;
  ok({ type: 'hide', name: 'Scoreboard' });
  make('Quarter break', { start: { type: 'break', breaks: ['qt', '3qt'], afterSec: 5 }, repeat: 'until', until: { moment: 'resume' }, then: { type: 'scene', scene: game },
    steps: [step(['Shooting']), step(['Ladder'])] });
  set({ startAt: Date.now() - 1000, running: true });
  siren();
  assert.equal(st().pending.id, seq('Quarter break').id);
  assert.equal(st().playing, null);
  tick(5);
  assert.equal(playingName(), 'Quarter break');
  assert.deepEqual(on(), ['Shooting']);
  tick(30);
  assert.deepEqual(on(), ['Ladder']);
  // Play resumes in quarter 2: Ladder finishes its 20 s, then the Game scene.
  set({ period: 2, left: 600, running: true });
  assert.equal(st().playing.finishing, true);
  tick(10);
  assert.equal(st().playing, null);
  assert.deepEqual(on(), ['Scoreboard']);
  // Half time isn't ticked: nothing starts.
  siren();
  tick(10);
  assert.equal(st().playing, null);
  assert.equal(st().pending, null);
  // Three quarter time is.
  set({ period: 3, left: 600, running: true });
  siren();
  tick(5);
  assert.equal(playingName(), 'Quarter break');
});

test('a pending start waits its few seconds; Start now and Cancel', () => {
  reset();
  make('Full time', { start: { type: 'fulltime', afterSec: 5 }, steps: [step(['Winner'], { type: 'next' })] });
  set({ startAt: Date.now() - 1000, period: 4, running: true });
  siren();
  assert.equal(st().pending.id, seq('Full time').id);
  tick(4);
  assert.equal(st().playing, null);
  tick(1);
  assert.equal(playingName(), 'Full time');
  // Again with a new game: Start now and Cancel.
  ok({ type: 'seqStop' });
  newGame({ startAt: Date.now() - 1000, period: 4, running: true });
  siren();
  assert.equal(link('sequence/now').status, 200);
  assert.equal(playingName(), 'Full time');
  ok({ type: 'seqStop' });
  newGame({ startAt: Date.now() - 1000, period: 4, running: true });
  siren();
  assert.equal(link('sequence/cancel').status, 200);
  tick(10);
  assert.equal(st().playing, null);
  assert.equal(link('sequence/now').status, 409);
});

test('the siren only counts once the clock has stayed at 0:00 for a moment, and only once per break', () => {
  reset();
  make('Quarter break', { start: { type: 'break', afterSec: 0 }, steps: [step(['Ladder'], { type: 'next' })] });
  set({ startAt: Date.now() - 1000, left: 1, running: true });
  tick(1);
  set({ left: 4, running: true }); // the scorer puts 4 seconds back on
  tick(2);
  assert.equal(st().playing, null);
  tick(2);
  tick(3);
  assert.equal(playingName(), 'Quarter break');
  ok({ type: 'seqStop' });
  tick(30);
  assert.equal(st().playing, null, "stopped by hand, it doesn't start again for the same break");
});

test('a quarter moved on by the scorer counts as its siren, and a game picked part way through does not start anything', () => {
  reset();
  make('Quarter break', { start: { type: 'break', afterSec: 0 }, steps: [step(['Ladder'], { type: 'next' })] });
  newGame({ startAt: Date.now() - 60000, period: 2, left: 0 });
  tick(10);
  assert.equal(st().playing, null);
  set({ left: 600, running: true });
  tick(5);
  set({ period: 3, left: 600, running: false });
  assert.equal(playingName(), 'Quarter break');
});

test('PlayHQ marking the game finished is full time too, and halves have only half time', () => {
  reset();
  make('Half time', { start: { type: 'break', breaks: ['ht'], afterSec: 0 }, steps: [step(['Ladder'], { type: 'next' })] });
  make('Full time', { start: { type: 'fulltime', afterSec: 0 }, steps: [step(['Winner'], { type: 'next' })] });
  newGame({ startAt: Date.now() - 1000, last: 2, running: true });
  siren();
  assert.equal(playingName(), 'Half time');
  set({ period: 2, left: 600, running: true });
  tick(5);
  set({ finished: true });
  assert.equal(playingName(), 'Full time');
});

test('with Automatic sequences off nothing starts by itself, the switch is remembered, and turning it off cancels a pending start', () => {
  reset();
  make('Full time', { start: { type: 'fulltime', afterSec: 5 }, steps: [step(['Winner'], { type: 'next' })] });
  set({ startAt: Date.now() - 1000, period: 4, running: true });
  siren();
  assert.ok(st().pending);
  assert.equal(link('sequence/auto/off').status, 200);
  assert.equal(st().pending, null);
  assert.equal(st().auto, false);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'sequence-settings.json'), 'utf8'));
  assert.equal(saved.auto, false);
  newGame({ startAt: Date.now() - 1000, period: 4, running: true });
  siren();
  tick(10);
  assert.equal(st().playing, null);
  link('sequence/auto/toggle');
  assert.equal(st().auto, true);
});

test('a step until the game moves on ends at the break, and settings are tidied', () => {
  reset();
  const sq = make('Last minute', { start: { type: 'break', breaks: ['nope'], afterSec: 999 }, steps: [step(['Ladder'], { type: 'game' }), step(['Fixtures'], { type: 'next' })] });
  assert.deepEqual(sq.start, { type: 'break', breaks: ['qt', 'ht', '3qt'], afterSec: 120 });
  assert.equal(make('Plain', {}).start.type, 'hand');
  set({ startAt: Date.now() - 1000, running: true });
  ok({ type: 'seqPlay', sequence: 'Last minute' });
  tick(5);
  assert.deepEqual(on(), ['Ladder']);
  siren();
  assert.deepEqual(on(), ['Fixtures']);
});

test('a start waiting for a repeat until sequence to finish is cancelled if a scene is picked instead', () => {
  reset();
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Game' });
  ok({ type: 'hide', name: 'Scoreboard' });
  make('Run-up', { start: { type: 'before', min: 10 }, repeat: 'until', until: { moment: 'before', min: 2 }, steps: [step(['Ladder'], { type: 'time', sec: 50 })] });
  make('Walk out', { start: { type: 'before', min: 2 }, steps: [step(['Countdown'], { type: 'next' })] });
  tick(28 * 60 + 10);
  assert.equal(st().pending.leftMs, null);
  ok({ type: 'sceneGo', scene: 'Game' });
  assert.equal(st().pending, null);
  tick(60);
  assert.equal(st().playing, null);
  assert.deepEqual(on(), ['Scoreboard']);
});

test('with no game picked, the manual clock drives the breaks, and putting the quarter back to 1 starts a new game', () => {
  reset();
  make('Quarter break', { start: { type: 'break', breaks: ['qt'], afterSec: 0 }, steps: [step(['Ladder'], { type: 'next' })] });
  newGame({ id: 'manual', startAt: null, running: true });
  siren();
  assert.equal(playingName(), 'Quarter break');
  ok({ type: 'seqStop' });
  set({ period: 2, left: 600 });
  set({ period: 1, left: 600, running: true });
  siren();
  assert.equal(playingName(), 'Quarter break');
});
