// The run order (sequences.js, through scene.js): a queue per output of sequences and scenes. Next plays the
// head; a sequence that ends plays the queue head instead of its Then, and its Then when nothing is queued;
// game triggers move their sequence to the head; whatever is at the head leaves as it starts; saved orders.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-runorder-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const seq = name => st().sequences.find(s => s.name === name);
const sc = name => st().scenes.find(s => s.name === name);
const step = (names, length = { type: 'time', sec: 20 }) => ({ sources: names.map(id), length });
const link = p => scene.deck(p.split('/'));
const wait = sec => mock.timers.tick(sec * 1000);
const playingName = () => st().playing && st().sequences.find(s => s.id === st().playing.id).name;
const order = () => st().runOrder.map(it => it.name);
const currentScene = () => st().scenes.find(s => s.id === st().current)?.name || null;

let g;
let gameNo = 0;
function newGame(changes = {}) {
  g = { id: `g${++gameNo}`, label: 'Stormz v Titans', startAt: Date.now() + 30 * 60000, period: 1, last: 4, left: 600, running: false, onBreak: false, finished: false, ...changes };
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
function siren() { set({ left: 3, running: true }); tick(3); tick(3); }

function reset() {
  scene.apply({ type: 'seqStop' });
  scene.apply({ type: 'seqCancel' });
  ok({ type: 'roClear' });
  ok({ type: 'seqAuto', value: 'on' });
  for (const o of [...st().runOrders]) ok({ type: 'roDeleteOrder', order: o.id });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: ['Scoreboard', 'Ladder', 'Fixtures', 'Countdown', 'Winner'].map(name => ({ type: 'browser', name, url: `${name.toLowerCase()}.html` })) });
  // The Live scene: the scoreboard on, the rest off.
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'hide', name: 'Scoreboard' });
  newGame();
}
function make(name, changes) { ok({ type: 'seqAdd', changes: { name, ...changes } }); return seq(name); }
const add = (kind, name) => ok({ type: 'roAdd', kind, name });

test('Next plays the head of the run order, a sequence that ends plays the next head instead of its Then, and the Then is the fallback when nothing is queued', () => {
  reset();
  make('Run-up', { then: { type: 'off' }, steps: [step(['Ladder'])] });
  make('Walk out', { then: { type: 'scene', scene: sc('Live').id }, steps: [step(['Countdown'], { type: 'time', sec: 10 })] });
  add('sequence', 'Run-up'); add('sequence', 'Walk out'); add('scene', 'Live');
  assert.deepEqual(order(), ['Run-up', 'Walk out', 'Live']);
  assert.equal(st().runOrder[0].kind, 'sequence');
  ok({ type: 'roNext' });
  assert.equal(playingName(), 'Run-up');
  assert.deepEqual(order(), ['Walk out', 'Live'], 'the head left as it started');
  // Run-up ends: Walk out is queued, so it plays instead of Run-up's Then (off).
  wait(20);
  assert.equal(playingName(), 'Walk out');
  assert.deepEqual(on(), ['Countdown']);
  assert.deepEqual(order(), ['Live']);
  // Walk out ends: the Live scene is queued, so it goes there (its own Then is Live too, but the queue is first).
  wait(10);
  assert.equal(playingName(), null);
  assert.equal(currentScene(), 'Live');
  assert.deepEqual(on(), ['Scoreboard']);
  assert.deepEqual(order(), []);
  // With nothing queued, the Then is the fallback: Run-up turns its sources off and leaves the scene alone.
  ok({ type: 'seqPlay', sequence: 'Run-up' });
  wait(20);
  assert.equal(playingName(), null);
  assert.deepEqual(on(), ['Scoreboard']);
});

test('Next with a scene at the head goes to it and stops the sequence playing; with nothing queued it ends the sequence (its Then); with nothing at all it says so', () => {
  reset();
  make('Break', { repeat: 'loop', then: { type: 'off' }, steps: [step(['Ladder']), step(['Fixtures'])] });
  ok({ type: 'seqPlay', sequence: 'Break' });
  add('scene', 'Live');
  ok({ type: 'roNext' });
  assert.equal(playingName(), null);
  assert.equal(currentScene(), 'Live');
  assert.deepEqual(on(), ['Scoreboard']);
  ok({ type: 'seqPlay', sequence: 'Break' });
  ok({ type: 'roNext' });
  assert.equal(playingName(), null, 'nothing queued: Next ends the sequence');
  assert.deepEqual(on(), ['Scoreboard'], 'its Then turned its own sources off and left the scoreboard');
  assert.equal(scene.apply({ type: 'roNext' }), 'Nothing is in the run order, and no sequence is playing.');
});

test('Skip drops the head, items can be moved and taken out, Clear empties it, and renaming a sequence renames it in the order', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [step(['Fixtures'])] });
  add('sequence', 'A'); add('sequence', 'B'); add('scene', 'Live');
  ok({ type: 'roMove', key: st().runOrder[2].key, to: 0 });
  assert.deepEqual(order(), ['Live', 'A', 'B']);
  ok({ type: 'roMove', key: st().runOrder[1].key, direction: 'down' });
  assert.deepEqual(order(), ['Live', 'B', 'A']);
  ok({ type: 'roSkip' });
  assert.deepEqual(order(), ['B', 'A']);
  ok({ type: 'roRemove', key: st().runOrder[1].key });
  assert.deepEqual(order(), ['B']);
  ok({ type: 'seqUpdate', sequence: seq('B').id, changes: { name: 'Half time' } });
  assert.deepEqual(order(), ['Half time']);
  ok({ type: 'roClear' });
  assert.deepEqual(order(), []);
  assert.equal(scene.apply({ type: 'roSkip' }), 'Nothing is in the run order.');
  assert.equal(scene.apply({ type: 'roAdd', kind: 'sequence', name: 'Nope' }), 'No sequence "Nope".');
});

test('a deleted sequence or scene shows as gone in the order and is skipped when its turn comes', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [step(['Fixtures'])] });
  add('sequence', 'A'); add('sequence', 'B');
  ok({ type: 'seqRemove', sequence: seq('A').id });
  assert.deepEqual(st().runOrder.map(it => it.gone), [true, false]);
  ok({ type: 'roNext' });
  assert.equal(playingName(), 'B');
  assert.deepEqual(order(), []);
});

test('a game trigger moves its sequence to the head with its countdown, Cancel takes it out again, and one queued by hand stays', () => {
  reset();
  make('Quarter time', { start: { type: 'break', breaks: ['qt'], afterSec: 5 }, then: { type: 'scene', scene: sc('Live').id }, steps: [step(['Ladder'], { type: 'time', sec: 30 })] });
  make('Promo', { steps: [step(['Fixtures'], { type: 'time', sec: 10 })] });
  add('sequence', 'Promo');
  set({ startAt: Date.now() - 1000, running: true });
  siren();
  assert.deepEqual(order(), ['Quarter time', 'Promo'], 'the trigger put its sequence at the head');
  assert.equal(st().pending.id, seq('Quarter time').id);
  ok({ type: 'seqCancel' });
  assert.deepEqual(order(), ['Promo'], 'Cancel took it out again');
  // Queued by hand, then triggered: it moves up and stays when cancelled.
  newGame({ startAt: Date.now() - 1000, running: true });
  add('sequence', 'Quarter time');
  assert.deepEqual(order(), ['Promo', 'Quarter time']);
  siren();
  assert.deepEqual(order(), ['Quarter time', 'Promo']);
  ok({ type: 'seqCancel' });
  assert.deepEqual(order(), ['Quarter time', 'Promo']);
  // Next plays it now, then Promo follows when it ends, then Promo's end has nothing queued: its Then (off).
  ok({ type: 'roNext' });
  assert.equal(playingName(), 'Quarter time');
  assert.deepEqual(order(), ['Promo']);
  wait(30);
  assert.equal(playingName(), 'Promo');
  wait(10);
  assert.equal(playingName(), null);
  assert.deepEqual(order(), []);
  // A trigger left to run starts it and it leaves the order as it starts.
  newGame({ startAt: Date.now() - 1000, running: true });
  siren();
  assert.deepEqual(order(), ['Quarter time']);
  tick(5);
  assert.equal(playingName(), 'Quarter time');
  assert.deepEqual(order(), []);
});

test('playing a sequence or scene by hand leaves the order alone unless it was the head', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [step(['Fixtures'])] });
  add('sequence', 'A'); add('scene', 'Live'); add('sequence', 'B');
  ok({ type: 'seqPlay', sequence: 'B' });
  assert.deepEqual(order(), ['A', 'Live', 'B'], 'B was not the head');
  ok({ type: 'seqPlay', sequence: 'A' });
  assert.deepEqual(order(), ['Live', 'B'], 'A was the head');
  ok({ type: 'sceneGo', scene: sc('Live').id });
  assert.deepEqual(order(), ['B']);
  assert.equal(playingName(), null, 'the scene stopped the sequence without its Then');
});

test('saved orders: Save as, load (in place of the queue), delete, and the file keeps the queue and the orders for a relaunch', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [step(['Fixtures'])] });
  add('sequence', 'A'); add('scene', 'Live'); add('sequence', 'B');
  ok({ type: 'roSave', name: 'Thursday' });
  assert.deepEqual(st().runOrders.map(o => [o.name, o.count]), [['Thursday', 3]]);
  ok({ type: 'roClear' });
  add('sequence', 'B');
  ok({ type: 'roLoad', order: 'thursday' });
  assert.deepEqual(order(), ['A', 'Live', 'B']);
  assert.equal(scene.apply({ type: 'roSave', name: '' }), 'Give the run order a name, such as "Thursday night".');
  assert.equal(scene.apply({ type: 'roLoad', order: 'friday' }), 'No saved run order "friday".');
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'sequences.json'), 'utf8'));
  assert.deepEqual(saved.runOrder.main.map(it => it.kind), ['sequence', 'scene', 'sequence']);
  assert.equal(saved.runOrders[0].name, 'Thursday');
  ok({ type: 'roDeleteOrder', order: st().runOrders[0].id });
  assert.deepEqual(st().runOrders, []);
});

test('Stream Deck links: /deck/runorder/next, skip, add/<name>, load/<order> and clear', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  assert.equal(link('runorder/next').status, 409);
  assert.equal(link('runorder/add/a').status, 200);
  assert.equal(link('runorder/add/live').status, 200);
  assert.deepEqual(order(), ['A', 'Live']);
  assert.equal(link('runorder/add/nothing-here').status, 404);
  const r = link('runorder/next');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, next: 'Live', queued: 1, playing: 'A' });
  assert.equal(link('runorder/skip').status, 200);
  assert.deepEqual(order(), []);
  assert.equal(scene.apply({ type: 'roSave', name: 'Night' }), 'The run order is empty, so there\'s nothing to save.');
  link('runorder/add/a');
  ok({ type: 'roSave', name: 'Night' });
  link('runorder/clear');
  assert.equal(link('runorder/load/night').status, 200);
  assert.deepEqual(order(), ['A']);
  assert.equal(link('runorder/load/day').status, 404);
  assert.equal(link('runorder/bogus'), null, 'not a run order link');
});

test('what the run order has played stays listed tonight, oldest first, with when; Skip and × don\'t add to it and Clear empties it', () => {
  reset();
  const played = () => st().runOrderPlayed.map(it => `${it.kind}:${it.name}`);
  make('Run-up', { then: { type: 'off' }, steps: [step(['Ladder'])] });
  make('Promo', { then: { type: 'off' }, steps: [step(['Fixtures'])] });
  add('sequence', 'Run-up'); add('sequence', 'Promo'); add('scene', 'Live'); add('sequence', 'Promo');
  assert.deepEqual(played(), []);
  ok({ type: 'roNext' });
  assert.deepEqual(played(), ['sequence:Run-up'], 'played as it starts');
  assert.equal(st().runOrderPlayed[0].at, Date.now());
  ok({ type: 'roSkip' });
  assert.deepEqual(played(), ['sequence:Run-up'], 'a skipped item never played');
  // Run-up ends and the queue takes it to the Live scene.
  wait(20);
  assert.equal(currentScene(), 'Live');
  assert.deepEqual(played(), ['sequence:Run-up', 'scene:Live']);
  ok({ type: 'roRemove', key: st().runOrder[0].key });
  assert.deepEqual(played(), ['sequence:Run-up', 'scene:Live'], 'one taken out never played');
  // A sequence played by hand isn't from the run order, so it isn't listed.
  ok({ type: 'seqPlay', sequence: seq('Promo').id });
  assert.deepEqual(played(), ['sequence:Run-up', 'scene:Live']);
  // Clear empties both, even with nothing queued.
  assert.deepEqual(order(), []);
  ok({ type: 'roClear' });
  assert.deepEqual(played(), []);
});
