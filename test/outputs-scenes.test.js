// Scenes and sequences per output (scene.js, sequences.js): each belongs to one output and acts there,
// each output has its own current scene and its own playing sequence, and only the primary plays music.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-scenes-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const outputs = require('../outputs');
const scene = require('../scene');
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
outputs.apply({ add: true });
outputs.apply({ output: outputs.state().outputs[1].id, name: 'Commentary' });
const two = () => outputs.find('commentary').id;

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const onMain = () => st().sources.filter(s => s.visible).map(s => s.name).sort();
const onTwo = () => st().sources.filter(s => s.out[two()]).map(s => s.name).sort();
const link = p => scene.deck(p.split('/'));
const wait = sec => mock.timers.tick(sec * 1000);
const step = (names, sec = 20) => ({ sources: names.map(id), length: { type: 'time', sec } });

ok({ type: 'add', sources: [
  { type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' },
  { type: 'browser', name: 'Ladder', url: 'ladder.html' },
  { type: 'browser', name: 'Game stats', url: 'gamestats.html' },
  { type: 'browser', name: 'Worm', url: 'worm.html' },
] });

test('a scene saved for another output keeps that output\'s look and becomes its current scene', () => {
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'show', name: 'Ladder', output: two() });
  ok({ type: 'sceneSave', name: 'Desk ladder', output: two() });
  const desk = st().scenes.find(s => s.name === 'Desk ladder');
  assert.equal(desk.output, two());
  assert.equal(desk.states[id('Ladder')], 'on');
  assert.equal(desk.states[id('Scoreboard')], 'off', 'the scoreboard is off on Commentary, whatever the primary shows');
  assert.equal(st().currentOut[two()], desk.id);
  assert.equal(st().current, st().scenes.find(s => s.name === 'Live').id, 'the primary keeps its own');
});

test('going to a scene acts on its own output only, and stops only the sequence playing there', () => {
  ok({ type: 'show', name: 'Game stats', output: two() });
  ok({ type: 'hide', name: 'Ladder', output: two() });
  assert.deepEqual(st().changedOut[two()].sort(), [id('Game stats'), id('Ladder')].sort());
  assert.deepEqual(st().changed, []);
  ok({ type: 'sceneGo', scene: 'Desk ladder' });
  assert.deepEqual(onTwo(), ['Ladder']);
  assert.deepEqual(onMain(), ['Scoreboard']);
  assert.deepEqual(st().changedOut[two()], []);
});

test('Next and Previous go through an output\'s own scenes', () => {
  ok({ type: 'sceneSave', name: 'Desk stats', output: two(), states: { [id('Game stats')]: 'on', [id('Ladder')]: 'off' } });
  ok({ type: 'sceneSave', name: 'Desk worm', output: two(), states: { [id('Worm')]: 'on', [id('Game stats')]: 'off', [id('Ladder')]: 'off' } });
  const r = link('output/commentary/scene/next');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.scene, 'Desk stats');
  assert.equal(link('output/commentary/scene/next').body.scene, 'Desk worm');
  assert.equal(link('output/commentary/scene/next').body.scene, 'Desk worm', 'stops at the end');
  assert.deepEqual(onTwo(), ['Worm']);
  assert.equal(st().current, st().scenes.find(s => s.name === 'Live').id, 'the primary\'s scene is untouched');
  assert.equal(link('scene/desk-ladder').body.output, 'Commentary', 'a scene link says which output it acted on');
  assert.deepEqual(onTwo(), ['Ladder']);
});

test('a sequence on another output plays there while the primary plays its own', () => {
  ok({ type: 'hideAll', output: two() });
  ok({ type: 'seqAdd', changes: { name: 'commentaryLoop', repeat: 'loop', steps: [step(['Game stats'], 10), step(['Worm'], 10)] }, output: two() });
  ok({ type: 'seqAdd', changes: { name: 'Main run', steps: [step(['Ladder'], 30)] } });
  assert.equal(st().sequences.find(s => s.name === 'commentaryLoop').output, two());
  assert.equal(st().sequences.find(s => s.name === 'Main run').output, 'main');
  ok({ type: 'seqPlay', sequence: 'commentaryLoop' });
  ok({ type: 'seqPlay', sequence: 'Main run' });
  assert.deepEqual(onTwo(), ['Game stats']);
  assert.ok(onMain().includes('Ladder'));
  assert.equal(st().playing.id, st().sequences.find(s => s.name === 'Main run').id);
  assert.equal(st().playingOut[two()].id, st().sequences.find(s => s.name === 'commentaryLoop').id);
  wait(10);
  assert.deepEqual(onTwo(), ['Worm']);
  wait(10);
  assert.deepEqual(onTwo(), ['Game stats'], 'it loops');
  assert.ok(onMain().includes('Ladder'), 'the primary\'s sequence carries on');
});

test('Next and Stop act on the output they name; a scene on Commentary stops only its loop', () => {
  const r = link('output/commentary/sequence/next');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.playing, 'commentaryLoop');
  assert.deepEqual(onTwo(), ['Worm']);
  assert.ok(st().playing, 'the primary\'s is still playing');
  ok({ type: 'sceneGo', scene: 'Desk ladder' });
  assert.equal(st().playingOut[two()], undefined, 'picking a Commentary scene stops the loop');
  assert.deepEqual(onTwo(), ['Ladder']);
  assert.ok(st().playing, 'and leaves the primary\'s alone');
  assert.equal(link('sequence/commentaryloop').status, 200, 'its own link plays it on its output');
  assert.ok(st().playingOut[two()]);
  link('output/commentary/sequence/stop');
  assert.equal(st().playingOut[two()], undefined);
  assert.ok(st().playing);
  link('sequence/stop');
  assert.equal(st().playing, null);
});

test('scenes and sequences of a removed output act on the primary from then on', () => {
  const was = two();
  ok({ type: 'seqPlay', sequence: 'commentaryLoop' });
  assert.equal(outputs.apply({ remove: was }), null);
  assert.equal(st().playingOut[was], undefined, 'what played there stops');
  assert.equal(st().currentOut[was], undefined);
  assert.equal(st().sequences.find(s => s.name === 'commentaryLoop').output, 'main');
  assert.equal(st().scenes.find(s => s.name === 'Desk ladder').output, 'main');
  ok({ type: 'sceneGo', scene: 'Desk ladder' });
  assert.ok(onMain().includes('Ladder'));
  assert.equal(st().scenes.find(s => s.id === st().current).name, 'Desk ladder');
});
