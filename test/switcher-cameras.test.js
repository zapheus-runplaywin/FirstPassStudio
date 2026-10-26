// Cameras per output (switcher.js): an output on an upstream key names the cameras its graphics go with. Studio's own
// cuts, autos and program presses take its key on with them and off with any other camera, in the same transition
// (the switcher's next transition selection, put back afterwards); with Keys follow the camera on, a cut made on the
// switcher itself brings the keys straight after. Against the stand-in switcher (test/support/atem.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');

const NAMES = ['Wide', 'Court', 'Bench', 'Crowd', 'GFX Fill', 'GFX Key', 'GFX2 Fill', 'GFX2 Key'];
const sent = (atem, name, from = 0) => atem.received.slice(from).filter(r => r.name === name);

async function setUp(t, before = () => {}) {
  const atem = await startAtem({ model: 'MiniExtreme', names: NAMES });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/outputs', { mode: 'fillkey', swFill: 5, swKey: 6 });
  const added = await studio.post('/api/outputs', { add: true });
  const two = added.outputs.find(o => o.slot === 2).id;
  // Output 2 on upstream key 2 (the usual), going with Court.
  await studio.post('/api/outputs', { output: two, mode: 'ndi', ndiSignal: 'fillkey', swFill: 7, swKey: 8, swCameras: [2] });
  await before(atem);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'connected', 8000, 100);
  return { atem, studio, two };
}
const check = async (studio, id) => (await studio.get('/api/switcher')).keys.find(k => k.output === id);

test('Studio\'s cuts take an output\'s key with its camera, in the same transition, and leave the panel\'s selection as it was', async t => {
  const { atem, studio, two } = await setUp(t);
  let c = await check(studio, two);
  assert.deepEqual(c.cameras, [2]);
  assert.equal(c.withCamera, 'Waiting for Court');
  assert.equal(c.keyer, 'usk2');

  // Cut to Court: the key goes on with it.
  let from = atem.received.length;
  let r = await studio.post('/api/switcher', { type: 'cut', input: 2 });
  assert.equal(atem.state.program, 2);
  assert.deepEqual(atem.state.usk, [false, true, false, false]);
  const order = atem.received.slice(from).map(x => x.name).filter(n => ['CTTp', 'DCut'].includes(n));
  assert.deepEqual(order, ['CTTp', 'DCut', 'CTTp'], 'the selection is set, the cut taken, and the selection put back');
  assert.equal(sent(atem, 'CTTp', from)[0].data[3], 1 | 4, 'background and upstream key 2 in the transition');
  assert.equal(sent(atem, 'CKOn', from).length, 0, 'the key went with the cut, not after it');
  assert.equal(atem.state.nextSelection, 1, 'background only again, as the operator had it');
  assert.match(studio.log(), /cut to Court, with Output 2's key on/);
  c = await studio.until(async () => { const x = await check(studio, two); return x.withCamera === 'On air with Court' && x; }, 3000, 50);

  // Auto to Wide: the key goes off with it.
  from = atem.received.length;
  await studio.post('/api/switcher', { type: 'auto', input: 1 });
  assert.equal(atem.state.program, 1);
  assert.deepEqual(atem.state.usk, [false, false, false, false]);
  await studio.until(async () => atem.state.nextSelection === 1 && sent(atem, 'CTTp', from).length === 2, 3000, 50);

  // A cut between two cameras that aren't Court changes no key, and sends no selection.
  await studio.post('/api/switcher', { type: 'preview', input: 3 });
  from = atem.received.length;
  await studio.post('/api/switcher', { type: 'cut' });
  assert.equal(atem.state.program, 3);
  assert.equal(sent(atem, 'CTTp', from).length, 0);

  // Straight to program (the program bus): the key follows straight after, even with Keys follow the camera off.
  await studio.post('/api/switcher', { type: 'follow', on: false });
  r = await studio.request('GET', '/deck/switcher/program/Court');
  assert.equal(r.status, 200);
  assert.deepEqual(atem.state.usk, [false, true, false, false]);
  assert.match(r.json.done, /with Output 2's key on/);
});

test('Keys follow the camera: a cut on the switcher itself brings the keys, a key changed by hand stays, and it can be turned off', async t => {
  const { atem, studio, two } = await setUp(t);
  assert.equal((await studio.get('/api/switcher')).follow, true, 'on unless turned off');
  // Someone presses Court on the panel.
  atem.set({ program: 2 });
  await studio.until(() => atem.state.usk[1] === true, 3000, 20);
  assert.match(studio.log(), /Keys follow the camera: Court on program, with Output 2's key on/);
  // The operator takes the key off by hand: Studio leaves it off (it only follows a change of camera).
  atem.set({ usk: [false, false, false, false] });
  await wait(400);
  assert.equal(atem.state.usk[1], false);
  // Back to Wide and to Court again: it follows each time.
  atem.set({ program: 1 });
  await wait(300);
  assert.equal(atem.state.usk[1], false);
  atem.set({ program: 2 });
  await studio.until(() => atem.state.usk[1] === true, 3000, 20);
  atem.set({ program: 1 });
  await studio.until(() => atem.state.usk[1] === false, 3000, 20);

  // Turned off (saved): the panel's cuts leave the keys alone.
  await studio.post('/api/switcher', { type: 'follow', on: false });
  assert.equal((await studio.get('/api/switcher')).follow, false);
  const from = atem.received.length;
  atem.set({ program: 2 });
  await wait(400);
  assert.equal(atem.state.usk[1], false);
  assert.equal(sent(atem, 'CKOn', from).length, 0);

  // Output 2 with no cameras: its key is never touched.
  await studio.post('/api/switcher', { type: 'follow', on: true });
  await studio.post('/api/outputs', { output: two, swCameras: [] });
  atem.set({ program: 1 });
  await wait(100);
  atem.set({ program: 2 });
  await wait(400);
  assert.equal(sent(atem, 'CKOn', from).length, 0);
  assert.equal((await check(studio, two)).withCamera, '');
});

test('connecting sends nothing, even with a paired camera on program and its key off', async t => {
  const { atem, studio } = await setUp(t, atem => atem.set({ program: 2 }));
  await wait(800);
  assert.equal(atem.state.usk[1], false);
  assert.deepEqual(atem.received.filter(r => ['CKOn', 'CTTp', 'DCut', 'DAut'].includes(r.name)), []);
  assert.doesNotMatch(studio.log(), /Keys follow the camera:/);
});

test('an output whose key has a problem, or a downstream key, is never paired', async t => {
  const { atem, studio, two } = await setUp(t);
  // Output 2 on downstream key 1 with Output 1: a clash, so Court's cut leaves every key alone.
  await studio.post('/api/outputs', { output: two, keyer: 'dsk1' });
  const c = await check(studio, two);
  assert.deepEqual(c.cameras, [], 'a downstream key is over every camera');
  await studio.post('/api/switcher', { type: 'cut', input: 2 });
  assert.deepEqual(atem.state.usk, [false, false, false, false]);
  assert.deepEqual(atem.state.dsk, [false, false]);
});

test('the usual keys never clash: Output 1 on downstream key 1 (upstream key 1 for chroma), the others on upstream keys 2 to 4', async t => {
  const studio = await startStudio(t);
  for (let n = 0; n < 3; n++) await studio.post('/api/outputs', { add: true });
  const usual = async () => (await studio.get('/api/outputs')).outputs.map(o => o.keyerNow);
  for (const mode of ['fillkey', 'chroma']) {
    for (const o of (await studio.get('/api/outputs')).outputs) await studio.post('/api/outputs', { output: o.id, mode });
    const keys = await usual();
    assert.deepEqual(keys, [mode === 'chroma' ? 'usk1' : 'dsk1', 'usk2', 'usk3', 'usk4']);
    assert.equal(new Set(keys).size, 4);
  }
});
