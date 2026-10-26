// Switcher actions on sequence steps and scenes (switcher.js run, fired from sequences.js and scene.js):
// what's saved, and that they fire only for what plays on the primary output, with a step's actions still
// to come called off as the sequence moves on. The switcher itself is stood in for by a recorder here;
// test/switcher.test.js has them reaching the stand-in ATEM.
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-switcher-actions-'));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const switcher = require('../switcher');
const outputs = require('../outputs');
const scene = require('../scene');
outputs.init(() => {}, { removed: id => scene.dropOutput(id) });
scene.init(() => {}, { outputs: { find: outputs.find, summary: outputs.summary } });
outputs.apply({ add: true });
outputs.apply({ output: outputs.state().outputs[1].id, name: 'Commentary' });
const two = () => outputs.find('commentary').id;

// What would have gone to the switcher: [why, owner, actions] for each run, and the owners called off.
const runs = [];
const cancels = [];
switcher.run = (actions, why, owner) => { runs.push([why, owner, (actions || []).map(switcher.describe)]); };
switcher.cancel = owner => cancels.push(owner);
const fired = () => runs.filter(r => r[2].length).map(r => `${r[0]}: ${r[2].join(', ')}`);

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const st = () => scene.state();
const id = name => st().sources.find(s => s.name === name).id;
const seq = name => st().sequences.find(s => s.name === name);
const wait = sec => mock.timers.tick(sec * 1000);

ok({ type: 'add', sources: [
  { type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' },
  { type: 'browser', name: 'Ladder', url: 'ladder.html' },
] });

test('switcher actions are tidied as they are saved: known actions only, numbers in range, eight at most', () => {
  const c = switcher.cleanActions([
    { type: 'cut', input: 3, name: 'Bench', atSec: 0.25 },
    { type: 'auto' },
    { type: 'preview' },                       // no input: dropped
    { type: 'usk', key: 9, on: 'sideways' },
    { type: 'dsk', key: 2, on: 'off', mix: 1, atSec: 99 },
    { type: 'ftb', on: 'whatever' },
    { type: 'macro', macro: 0 },
    { type: 'stream' },                        // not something sequences do: dropped
    'nonsense',
    ...Array(10).fill({ type: 'cut' }),
  ]);
  assert.equal(c.length, 8);
  assert.deepEqual(c.slice(0, 6), [
    { type: 'cut', input: 3, name: 'Bench', atSec: 0.3 },
    { type: 'auto', atSec: 0 },
    { type: 'usk', key: 4, on: 'on', atSec: 0 },
    { type: 'dsk', key: 2, on: 'off', mix: true, atSec: 60 },
    { type: 'ftb', on: 'on', atSec: 0 },
    { type: 'macro', macro: 1, atSec: 0 },
  ]);
  assert.deepEqual(c.slice(0, 6).map(switcher.describe), ['cut to Bench at 0.3 s', 'auto to what\'s on preview', 'upstream key 4 on', 'downstream key 2 off (auto) at 60 s', 'fade to black', 'macro 1']);
});

test('a scene\'s switcher actions are saved with it and fire when it is picked on the primary only', () => {
  ok({ type: 'show', name: 'Scoreboard' });
  ok({ type: 'sceneSave', name: 'Live' });
  ok({ type: 'sceneUpdate', scene: 'Live', changes: { switcher: [{ type: 'auto', input: 2, name: 'Court' }, { type: 'dsk', key: 1, on: 'on' }] } });
  const live = st().scenes.find(s => s.name === 'Live');
  assert.deepEqual(live.switcher, [{ type: 'auto', input: 2, name: 'Court', atSec: 0 }, { type: 'dsk', key: 1, on: 'on', atSec: 0 }]);
  assert.equal(live.states[id('Scoreboard')], 'on', 'its sources are as they were');
  runs.length = 0;
  ok({ type: 'sceneGo', scene: 'Live', output: two() });
  assert.deepEqual(fired(), [], 'picked on Commentary: nothing to the switcher');
  ok({ type: 'sceneGo', scene: 'Live' });
  assert.deepEqual(fired(), ['Scene "Live": auto to Court, downstream key 1 on']);
  // A scene without any calls off what the one before still had to come.
  ok({ type: 'sceneSave', name: 'Plain' });
  ok({ type: 'sceneGo', scene: 'Plain' });
  assert.deepEqual(runs.at(-1).slice(0, 2), ['Scene "Plain"', 'scene']);
  // Taking them all out leaves none.
  ok({ type: 'sceneUpdate', scene: 'Live', changes: { switcher: [] } });
  assert.equal(st().scenes.find(s => s.name === 'Live').switcher, undefined);
});

test('a sequence step\'s switcher actions fire as the step starts, on the primary only, and are called off as it ends', () => {
  ok({ type: 'sceneUpdate', scene: 'Live', changes: { switcher: [{ type: 'cut', input: 1, name: 'Wide' }] } });
  ok({ type: 'seqAdd', changes: { name: 'Walk out', steps: [
    { sources: [id('Ladder')], length: { type: 'time', sec: 5 }, switcher: [{ type: 'preview', input: 3, name: 'Bench' }, { type: 'cut', atSec: 1.5 }] },
    { kind: 'scene', scene: st().scenes.find(s => s.name === 'Live').id, length: { type: 'time', sec: 5 }, switcher: [{ type: 'usk', key: 1, on: 'off' }] },
    { sources: [id('Ladder')], length: { type: 'time', sec: 5 } },
  ] } });
  assert.deepEqual(seq('Walk out').steps[0].switcher.map(switcher.describe), ['Bench on preview', 'cut to what\'s on preview at 1.5 s']);
  assert.equal(seq('Walk out').steps[2].switcher, undefined);

  // On Commentary: the sequence plays, the switcher is left alone.
  runs.length = 0;
  cancels.length = 0;
  ok({ type: 'seqPlay', sequence: 'Walk out', output: two() });
  wait(5); wait(5); wait(5);
  assert.deepEqual(fired(), []);
  assert.deepEqual(cancels, [], 'and nothing of the primary\'s is called off');

  // On the primary: each step's, and a scene step's scene's too.
  ok({ type: 'seqPlay', sequence: 'Walk out' });
  assert.deepEqual(fired(), ['Sequence "Walk out" step 1: Bench on preview, cut to what\'s on preview at 1.5 s']);
  wait(5);
  assert.deepEqual(fired().slice(1), ['Scene "Live": cut to Wide', 'Sequence "Walk out" step 2: upstream key 1 off']);
  assert.equal(runs.find(r => r[0] === 'Scene "Live"')[1], 'sequenceScene', 'a scene step\'s scene actions belong to the sequence');
  wait(5);
  assert.deepEqual(runs.at(-1).slice(0, 2), ['Sequence "Walk out" step 3', 'sequence'], 'a step without any calls off the step before\'s');
  cancels.length = 0;
  ok({ type: 'seqStop' });
  assert.deepEqual(cancels, ['sequence', 'sequenceScene'], 'stopping calls off what was still to come, its scene steps\' too');
});
