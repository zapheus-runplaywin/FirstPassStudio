// Scenes and sequences shared by the outputs (scene.js, sequences.js): any output can play any scene or
// sequence, each output has its own current scene and its own playing sequence, and only the primary plays music.
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
const sceneId = name => st().scenes.find(s => s.name === name).id;
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

test('a scene saved from another output keeps that output\'s look and becomes its current scene', () => {
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'show', name: 'Ladder', output: two() });
  ok({ type: 'sceneSave', name: 'Ladder up', output: two() });
  const s = st().scenes.find(x => x.name === 'Ladder up');
  assert.equal(s.output, undefined, 'scenes belong to no output');
  assert.equal(s.states[id('Ladder')], 'on');
  assert.equal(s.states[id('Scoreboard')], 'off', 'the scoreboard is off on Commentary, whatever the primary shows');
  assert.equal(st().currentOut[two()], s.id);
  assert.equal(st().current, sceneId('Live'), 'the primary keeps its own');
});

test('one scene plays on any output, setting that output\'s sources only', () => {
  ok({ type: 'show', name: 'Game stats', output: two() });
  assert.deepEqual(st().changedOut[two()], [id('Game stats')]);
  assert.deepEqual(st().changed, []);
  ok({ type: 'sceneGo', scene: 'Ladder up', output: two() });
  assert.deepEqual(onTwo(), ['Ladder']);
  assert.deepEqual(onMain(), ['Scoreboard']);
  ok({ type: 'sceneGo', scene: 'Ladder up' });
  assert.deepEqual(onMain(), ['Ladder'], 'the same scene on the primary');
  assert.equal(st().current, sceneId('Ladder up'));
  assert.equal(st().currentOut[two()], sceneId('Ladder up'), 'both have it as their current scene');
  ok({ type: 'sceneGo', scene: 'Live', output: two() });
  assert.deepEqual(onTwo(), ['Scoreboard']);
  assert.deepEqual(onMain(), ['Ladder'], 'the primary is untouched');
});

test('Next and Previous go through all the scenes from the output\'s own current one', () => {
  ok({ type: 'sceneSave', name: 'Stats', states: { [id('Game stats')]: 'on', [id('Ladder')]: 'off', [id('Scoreboard')]: 'off' } });
  const list = st().scenes.map(s => s.name);
  const at = list.indexOf('Live');
  const r = link('output/commentary/scene/next');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.output, 'Commentary');
  assert.equal(r.body.scene, list[at + 1] || 'Live');
  assert.equal(st().current, sceneId('Ladder up'), 'the primary\'s scene is untouched');
  const g = link('output/commentary/scene/stats');
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.scene, 'Stats');
  assert.deepEqual(onTwo(), ['Game stats']);
  assert.equal(link('scene/live').body.scene, 'Live', '/deck/scene/<name> plays on the primary');
  assert.deepEqual(onMain(), ['Scoreboard']);
  assert.equal(link('output/commentary/scene/nope').status, 404);
});

test('one sequence plays on two outputs at once, each with its own runner', () => {
  ok({ type: 'hideAll', output: two() });
  ok({ type: 'seqAdd', changes: { name: 'commentaryLoop', repeat: 'loop', steps: [step(['Game stats'], 10), step(['Worm'], 10)] } });
  ok({ type: 'seqAdd', changes: { name: 'Main run', steps: [step(['Ladder'], 30)] } });
  assert.deepEqual(st().sequences.find(s => s.name === 'commentaryLoop').playsOn, ['main']);
  ok({ type: 'seqPlay', sequence: 'commentaryLoop', output: two() });
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

test('Next and Stop act on the output they name; a scene on Commentary stops only its sequence', () => {
  const r = link('output/commentary/sequence/next');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.playing, 'commentaryLoop');
  assert.deepEqual(onTwo(), ['Worm']);
  assert.ok(st().playing, 'the primary\'s is still playing');
  ok({ type: 'sceneGo', scene: 'Ladder up', output: two() });
  assert.equal(st().playingOut[two()], undefined, 'picking a scene on Commentary stops its loop');
  assert.deepEqual(onTwo(), ['Ladder']);
  assert.ok(st().playing, 'and leaves the primary\'s alone');
  assert.equal(link('output/commentary/sequence/commentaryloop').status, 200, 'a sequence link per output');
  assert.equal(st().playingOut[two()].id, st().sequences.find(s => s.name === 'commentaryLoop').id);
  link('output/commentary/sequence/stop');
  assert.equal(st().playingOut[two()], undefined);
  assert.ok(st().playing);
  link('sequence/stop');
  assert.equal(st().playing, null);
});

test('a sequence set to play on another output keeps that, and stays off once that output has gone', () => {
  const sq = st().sequences.find(s => s.name === 'commentaryLoop');
  ok({ type: 'seqUpdate', sequence: sq.id, changes: { startOn: two() } });
  assert.deepEqual(st().sequences.find(s => s.name === 'commentaryLoop').playsOn, [two()], 'an older startOn becomes playsOn');
  const was = two();
  ok({ type: 'seqPlay', sequence: 'commentaryLoop', output: was });
  ok({ type: 'sceneGo', scene: 'Stats', output: was });
  ok({ type: 'seqPlay', sequence: 'commentaryLoop', output: was });
  assert.equal(outputs.apply({ remove: was }), null);
  assert.equal(st().playingOut[was], undefined, 'what played there stops');
  assert.equal(st().currentOut[was], undefined);
  const after = st().sequences.find(s => s.name === 'commentaryLoop');
  assert.deepEqual(after.playsOn, [was], 'kept, for the editor to show');
  assert.deepEqual(after.goneOn, [was]);
  assert.equal(after.startGone, true);
  // Its moment comes: it doesn't start on Output 1 instead (where it would be on air).
  scene.apply({ type: 'seqStop' });
  ok({ type: 'seqUpdate', sequence: sq.id, changes: { start: { type: 'before', min: 10 } } });
  const game = { id: 'g-gone', label: 'Stormz v Titans', startAt: Date.now() + 30 * 60000, period: 1, last: 4, left: 600, running: false, onBreak: false, finished: false };
  scene.game(game);
  assert.notEqual(st().nextAuto?.id, sq.id, 'not shown as starting next');
  wait(21 * 60);
  scene.game(game);
  assert.equal(st().playing, null, 'nothing started on Output 1');
  assert.equal(st().pending, null);
  ok({ type: 'seqUpdate', sequence: sq.id, changes: { start: { type: 'hand' }, playsOn: ['main'] } });
  assert.equal(st().sequences.find(s => s.name === 'commentaryLoop').startGone, undefined, 'picking another output clears it');
  ok({ type: 'sceneGo', scene: 'Ladder up' });
  assert.ok(onMain().includes('Ladder'));
});

test('the scene feed lists the outputs for the Stream Deck plugin', () => {
  const o = st().outputs;
  assert.ok(o.length >= 1);
  assert.deepEqual(Object.keys(o[0]).sort(), ['colour', 'id', 'link', 'name', 'slot']);
  assert.equal(o[0].id, 'main');
});

// One sequence played on two outputs together, each going somewhere different when it ends.
test('a sequence that plays on two outputs starts on both together and does each output\'s own Then', () => {
  outputs.apply({ add: true });
  outputs.apply({ output: outputs.state().outputs[1].id, name: 'Camera key' });
  outputs.apply({ add: true });
  outputs.apply({ output: outputs.state().outputs[2].id, name: 'Spare' });
  const cam = () => outputs.find('camera-key').id, spare = outputs.find('spare').id;
  const onCam = () => st().sources.filter(s => s.out[cam()]).map(s => s.name).sort();
  ok({ type: 'hideAll' });
  ok({ type: 'hideAll', output: cam() });
  ok({ type: 'sceneSave', name: 'Scores', states: { [id('Scoreboard')]: 'on', [id('Ladder')]: 'off', [id('Game stats')]: 'off', [id('Worm')]: 'off' } });
  ok({ type: 'seqAdd', changes: { name: 'Feature', playsOn: ['main', cam()], then: { type: 'scene', scene: sceneId('Scores') },
    thenOn: { [cam()]: { type: 'sequence', sequence: st().sequences.find(s => s.name === 'commentaryLoop').id }, nowhere: { type: 'leave' } },
    steps: [step(['Ladder'], 10), step(['Worm'], 10)] } });
  const sq = st().sequences.find(s => s.name === 'Feature');
  assert.deepEqual(sq.playsOn, ['main', cam()]);
  assert.deepEqual(Object.keys(sq.thenOn), [cam()], 'only outputs it plays on keep a Then of their own');
  // Played on the camera key output (one of its two): it starts on both.
  ok({ type: 'seqPlay', sequence: 'Feature', output: cam() });
  assert.equal(st().playing.id, sq.id);
  assert.equal(st().playingOut[cam()].id, sq.id);
  assert.deepEqual(onMain(), ['Ladder']);
  assert.deepEqual(onCam(), ['Ladder']);
  wait(10);
  assert.deepEqual(onMain(), ['Worm']);
  assert.deepEqual(onCam(), ['Worm']);
  wait(10);
  // Output 1 goes to its scene; the camera key output plays its own next sequence.
  assert.equal(st().playing, null);
  assert.equal(st().current, sceneId('Scores'));
  assert.deepEqual(onMain(), ['Scoreboard']);
  assert.equal(st().playingOut[cam()].id, st().sequences.find(s => s.name === 'commentaryLoop').id);
  assert.deepEqual(onCam(), ['Game stats']);
  ok({ type: 'seqStop', output: cam() });
  // Played on an output it doesn't play on, it plays there alone.
  ok({ type: 'seqPlay', sequence: 'Feature', output: spare });
  assert.equal(st().playingOut[spare].id, sq.id);
  assert.equal(st().playing, null, 'not on Output 1');
  assert.equal(st().playingOut[cam()], undefined);
  ok({ type: 'seqStop', output: spare });
  // only: on the output picked alone.
  assert.equal(link('output/camera-key/sequence/feature/only').status, 200);
  assert.equal(st().playingOut[cam()].id, sq.id);
  assert.equal(st().playing, null, 'only plays on the output named');
  // Toggle (and Stop naming it) stops it on every output it plays on together, each doing its Then.
  link('sequence/feature/play');
  assert.equal(st().playing.id, sq.id);
  link('sequence/feature/toggle');
  assert.equal(st().playing, null);
  assert.equal(st().current, sceneId('Scores'));
  assert.equal(st().playingOut[cam()].id, st().sequences.find(s => s.name === 'commentaryLoop').id, 'the camera key output did its own Then');
  ok({ type: 'seqStop', output: cam() });
  // Plain Stop on one output stops just that one.
  link('sequence/feature');
  link('output/camera-key/sequence/stop');
  assert.equal(st().playing.id, sq.id, 'Output 1 carries on');
  link('sequence/stop');
});

test('a sequence that plays on two outputs starts by itself on both, and on what\'s left when one goes', () => {
  const cam = outputs.find('camera-key').id;
  const sq = st().sequences.find(s => s.name === 'Feature');
  ok({ type: 'seqUpdate', sequence: sq.id, changes: { start: { type: 'fulltime', afterSec: 0 } } });
  const game = { id: 'g-two', label: 'Stormz v Titans', startAt: Date.now() - 60000, period: 4, last: 4, left: 5, running: true, onBreak: false, finished: false };
  scene.game(game);
  scene.game({ ...game, period: 4, left: 0, running: false });
  wait(4);
  scene.game({ ...game, period: 4, left: 0, running: false });
  assert.equal(st().playing?.id, sq.id, 'on Output 1');
  assert.equal(st().playingOut[cam]?.id, sq.id, 'and on the camera key output, together');
  link('sequence/feature/stop');
  ok({ type: 'seqStop', output: cam });
  assert.equal(outputs.apply({ remove: cam }), null);
  const after = st().sequences.find(s => s.name === 'Feature');
  assert.deepEqual(after.goneOn, [cam]);
  assert.equal(after.startGone, undefined, 'it still plays on Output 1');
  ok({ type: 'seqPlay', sequence: 'Feature' });
  assert.equal(st().playing.id, sq.id);
  link('sequence/stop');
});

test('an output says which sequence last ended there, played out or cut short, until that one plays again', () => {
  const main = () => st().sequences.find(s => s.name === 'Main run').id;
  ok({ type: 'seqPlay', sequence: 'Main run' });
  assert.notEqual(st().stoppedOn.main, main());
  ok({ type: 'sceneGo', scene: 'Live' });
  assert.equal(st().stoppedOn.main, st().sequences.find(s => s.name === 'Main run').id, 'a scene cut it short');
  ok({ type: 'seqPlay', sequence: 'Main run' });
  assert.equal(st().stoppedOn.main, undefined, 'playing again clears it');
  wait(30);
  assert.equal(st().playing, null);
  assert.equal(st().stoppedOn.main, main(), 'played out is stopped too');
  ok({ type: 'seqPlay', sequence: 'Main run' });
  link('sequence/stop');
  assert.equal(st().stoppedOn.main, st().sequences.find(s => s.name === 'Main run').id, 'Stop cut it short');
});
