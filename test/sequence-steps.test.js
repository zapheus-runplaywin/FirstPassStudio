// Scene steps (starting and reset points) and sequence steps (a mini sequence played in place) in sequences.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-seqsteps-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const scene = require('../scene');
scene.init(() => {});

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const on = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const seq = name => st().sequences.find(s => s.name === name);
const sceneId = name => st().scenes.find(s => s.name === name).id;
const step = (names, sec = 10) => ({ sources: names.map(id), length: { type: 'time', sec } });
const sceneStep = (name, length = { type: 'now' }) => ({ kind: 'scene', scene: sceneId(name), length });
const seqStep = name => ({ kind: 'sequence', sequence: seq(name).id });
const wait = sec => mock.timers.tick(sec * 1000);
function make(name, changes) { ok({ type: 'seqAdd', changes: { name, ...changes } }); return seq(name); }

function reset() {
  scene.apply({ type: 'seqStop' });
  for (const s of [...st().sequences]) ok({ type: 'seqRemove', sequence: s.id });
  for (const s of [...st().scenes]) ok({ type: 'sceneRemove', scene: s.id });
  for (const s of [...st().sources]) ok({ type: 'remove', id: s.id });
  ok({ type: 'add', sources: ['Scoreboard', 'Title', 'Ladder', 'Fixtures', 'Ad'].map(name => ({ type: 'browser', name, url: 'ladder.html' })) });
  // Base: the scoreboard and title on, the rest off.
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'show', name: 'Title' });
  ok({ type: 'sceneSave', name: 'Base' });
  ok({ type: 'hide', name: 'Scoreboard' });
  ok({ type: 'hide', name: 'Title' });
  ok({ type: 'sceneSave', name: 'Clear' });
}

test('a scene step is a starting point: its sources stay as the base the next steps play over, and after the sequence', () => {
  reset();
  make('Break', { steps: [sceneStep('Base'), step(['Ladder']), step(['Fixtures'])] });
  ok({ type: 'seqPlay', sequence: 'Break' });
  wait(0);
  assert.deepEqual(on(), ['Ladder', 'Scoreboard', 'Title'], 'went straight on past the scene');
  assert.equal(st().playing.step, 1);
  wait(10);
  assert.deepEqual(on(), ['Fixtures', 'Scoreboard', 'Title']);
  wait(10);
  assert.equal(st().playing, null);
  assert.deepEqual(on(), ['Scoreboard', 'Title'], 'the scene\'s sources stay, the sequence\'s own go off');
});

test('a scene step in the middle is a reset point, and can hold for a time', () => {
  reset();
  make('Reset', { steps: [step(['Ladder']), sceneStep('Clear', { type: 'time', sec: 5 }), step(['Fixtures'])] });
  ok({ type: 'show', name: 'Title' });
  ok({ type: 'seqPlay', sequence: 'Reset' });
  assert.deepEqual(on(), ['Ladder', 'Title']);
  wait(10);
  assert.deepEqual(on(), [], 'Clear turned everything off');
  wait(5);
  assert.deepEqual(on(), ['Fixtures']);
});

test('a sequence step plays that sequence\'s steps in place, with its kept-on sources, then carries on', () => {
  reset();
  make('Ad break', { keepOn: [id('Title')], steps: [step(['Ad'], 5), step(['Ladder'], 5)] });
  make('Quarter time', { steps: [step(['Fixtures']), seqStep('Ad break'), step(['Scoreboard'])] });
  ok({ type: 'seqPlay', sequence: 'Quarter time' });
  assert.equal(st().playing.steps, 4);
  assert.deepEqual(on(), ['Fixtures']);
  wait(10);
  assert.deepEqual(on(), ['Ad', 'Title']);
  assert.deepEqual(st().playing.via, ['Ad break']);
  assert.equal(st().playing.top, 1);
  wait(5);
  assert.deepEqual(on(), ['Ladder', 'Title']);
  wait(5);
  assert.deepEqual(on(), ['Scoreboard']);
  // Mini sequences inside mini sequences, and a sequence made only of sequences.
  make('Twice', { steps: [seqStep('Ad break'), seqStep('Ad break')] });
  make('Everything', { steps: [seqStep('Twice'), seqStep('Quarter time')] });
  ok({ type: 'seqPlay', sequence: 'Everything' });
  assert.equal(st().playing.steps, 8);
  assert.deepEqual(st().playing.via, ['Twice', 'Ad break']);
});

test('a sequence can\'t end up inside itself', () => {
  reset();
  make('A', { steps: [step(['Ladder'])] });
  make('B', { steps: [seqStep('A')] });
  assert.match(scene.apply({ type: 'seqUpdate', sequence: 'A', changes: { steps: [seqStep('B')] } }), /already plays "A"/);
  assert.match(scene.apply({ type: 'seqUpdate', sequence: 'A', changes: { steps: [seqStep('A')] } }), /can't play itself/);
});

test('a deleted mini sequence plays nothing, and scene steps that go straight on can\'t loop for ever', () => {
  reset();
  make('Mini', { steps: [step(['Ad'])] });
  make('Outer', { steps: [step(['Ladder']), seqStep('Mini')] });
  ok({ type: 'seqRemove', sequence: 'Mini' });
  ok({ type: 'seqPlay', sequence: 'Outer' });
  assert.equal(st().playing.steps, 1);
  make('Spin', { repeat: 'loop', steps: [sceneStep('Base'), sceneStep('Clear')] });
  ok({ type: 'seqPlay', sequence: 'Spin' });
  wait(1);
  assert.equal(st().playing, null);
});
