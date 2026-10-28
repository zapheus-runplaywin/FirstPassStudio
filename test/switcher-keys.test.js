// Each output's key on the ATEM switcher (Into the switcher as on the Output page): Studio reads how that key is set
// up and says what doesn't suit the output (switcher.js keyChecks), sends nothing to the switcher until Set up this
// key for me is pressed, and then changes only the key's inputs, type and Pre Multiplied Key. Against the stand-in
// switcher (test/support/atem.js), which keeps each key's settings as ATEM Software Control would.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { startAtem } = require('./support/atem');

const SETUP = ['CDsF', 'CDsC', 'CDsG', 'CKTp', 'CKeF', 'CKeC', 'CKLm'];
const keyFor = async (studio, output, ok = c => c) => studio.until(async () => {
  const s = await studio.get('/api/switcher');
  const c = s.state === 'connected' && (s.keys || []).find(k => k.output === output);
  return c && ok(c) ? c : null;
}, 5000, 50);

async function setUp(t, opts) {
  const atem = await startAtem(opts);
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'connected', 8000, 100);
  return { atem, studio };
}

test('Output 1 as fill and key on downstream key 1: the check says what differs, and Set up this key for me fixes just that', async t => {
  const { atem, studio } = await setUp(t, { model: 'MiniExtreme', names: ['Wide', 'Court', 'Bench', 'Crowd', 'Fill', 'Key'] });
  // Nothing picked yet: told which inputs to pick, and nothing to set up.
  await studio.post('/api/outputs', { mode: 'fillkey' });
  let c = await keyFor(studio, 'main', x => x.problems.length);
  assert.equal(c.keyer, 'dsk1', 'Output 1 comes into downstream key 1 unless picked');
  assert.equal(c.label, 'Downstream key 1');
  assert.match(c.problems.join(' '), /Pick the switcher input its fill comes into/);
  assert.match(c.problems.join(' '), /Pick the switcher input its key comes into/);
  assert.equal((await studio.request('POST', '/api/switcher', { type: 'keySetup', output: 'main' })).status, 409);

  await studio.post('/api/outputs', { swFill: 5, swKey: 6 });
  c = await keyFor(studio, 'main', x => !x.problems.length);
  assert.deepEqual(c.fixes, ['Fill source is Black, should be Fill', 'Key source is Black, should be Key', 'Pre Multiplied Key is off, should be on']);
  assert.equal(c.onAir, false);
  assert.deepEqual(atem.received.filter(r => SETUP.includes(r.name)), [], 'only read: nothing sent to the switcher before the press');

  const r = await studio.post('/api/switcher', { type: 'keySetup', output: 'main' });
  assert.equal(r.state, 'connected');
  assert.deepEqual(atem.state.dskKeys[0], { fill: 5, cut: 6, preMultiply: true });
  assert.deepEqual(atem.state.dskKeys[1], { fill: 0, cut: 0, preMultiply: false }, 'the other downstream key is left alone');
  assert.deepEqual(atem.state.dsk, [false, false], 'and nothing goes on air');
  c = await keyFor(studio, 'main', x => !x.fixes.length);
  assert.deepEqual(c.problems, []);
  assert.match(studio.log(), /set up downstream key 1 for Output 1: Fill source Fill, Key source Key, Pre Multiplied Key on/);

  // Already right: a second press changes nothing.
  const before = atem.received.length;
  await studio.post('/api/switcher', { type: 'keySetup', output: 'main' });
  assert.equal(atem.received.filter((x, i) => i >= before && SETUP.includes(x.name)).length, 0);

  // Someone changes the key in ATEM Software Control: the check follows it.
  atem.set({ dskKeys: [{ fill: 5, cut: 6, preMultiply: false }, atem.state.dskKeys[1]] });
  c = await keyFor(studio, 'main', x => x.fixes.length);
  assert.deepEqual(c.fixes, ['Pre Multiplied Key is off, should be on']);
});

test('a chroma output on an upstream key, a Straight fill, and what the switcher can\'t key', async t => {
  const { atem, studio } = await setUp(t, { model: 'MiniExtreme' });
  await studio.post('/api/outputs', { mode: 'fillkey', swFill: 5, swKey: 6 });
  const added = await studio.post('/api/outputs', { add: true });
  const two = added.outputs.find(o => o.slot === 2).id;
  await studio.post('/api/outputs', { output: two, mode: 'ndi', ndiSignal: 'chroma', swFill: 7 });
  let c = await keyFor(studio, two, x => !x.problems.length);
  assert.equal(c.keyer, 'usk2', 'Output 2 comes into upstream key 2 unless picked');
  assert.deepEqual(c.fixes, ['Key type is Luma, should be Chroma', 'Fill source is Black, should be Camera 7'], 'a chroma key has no key input or pre multiplied');
  await studio.post('/api/switcher', { type: 'keySetup', output: two });
  assert.deepEqual(atem.state.uskKeys[1], { type: 1, fill: 7, cut: 0, preMultiplied: false });
  assert.deepEqual(atem.state.uskKeys[0], { type: 0, fill: 0, cut: 0, preMultiplied: false }, 'upstream key 1 is left alone');
  await keyFor(studio, two, x => !x.fixes.length);

  // A chroma output picked onto a downstream key, or the same key as another output.
  await studio.post('/api/outputs', { output: two, keyer: 'dsk2' });
  c = await keyFor(studio, two, x => x.problems.length);
  assert.match(c.problems[0], /A chroma key needs an upstream key/);
  await studio.post('/api/outputs', { output: two, keyer: 'dsk1', ndiSignal: 'fillkey', swKey: 8 });
  c = await keyFor(studio, two, x => x.problems.length && x.keyer === 'dsk1');
  assert.match(c.problems[0], /Output 1 comes into downstream key 1 too/);
  assert.match((await keyFor(studio, 'main', x => x.problems.length)).problems[0], /Output 2 comes into downstream key 1 too/, 'and Output 1 says so too');
  // NDI with transparency, and a Blackmagic device sending fill only, can't be keyed.
  await studio.post('/api/outputs', { output: two, keyer: '', ndiSignal: 'alpha' });
  c = await keyFor(studio, two, x => x.problems.length && x.keyer === 'usk2');
  assert.match(c.problems[0], /can't key NDI with transparency/);
  await studio.post('/api/outputs', { output: two, mode: 'decklink', decklinkKeying: 'off' });
  c = await keyFor(studio, two, x => /Fill only/.test(x.problems.join(' ')));
  // Now fill and key from a Blackmagic device sending Straight: the key it set up for chroma goes back to luma, and
  // Straight is asked to be off with Pre Multiplied Key on (straight fill into a Pre Multiplied Key leaves a light
  // fringe round logos), and Set up this key for me unticks it.
  await studio.post('/api/outputs', { output: two, decklinkKeying: 'external', decklinkStraight: true });
  c = await keyFor(studio, two, x => !x.problems.length);
  assert.deepEqual(c.fixes, ['Key type is Chroma, should be Luma', 'Key source is Black, should be Camera 8', 'Pre Multiplied Key is off, should be on',
    'Studio\'s Straight fill is on, should be off (it leaves a light edge round logos and text)']);
  await studio.post('/api/switcher', { type: 'keySetup', output: two });
  assert.deepEqual(atem.state.uskKeys[1], { type: 0, fill: 7, cut: 8, preMultiplied: true });
  assert.equal((await studio.get('/api/outputs')).outputs.find(o => o.id === two).decklinkStraight, false, 'Straight unticked');
  await keyFor(studio, two, x => !x.fixes.length);
  assert.match(studio.log(), /set up upstream key 2 for Output 2: .*Pre Multiplied Key on, Studio's Straight fill off/);
  // Not keyed by the switcher: nothing to check.
  await studio.post('/api/outputs', { output: two, keyer: 'none' });
  c = await keyFor(studio, two, x => x.keyer === 'none');
  assert.deepEqual([c.problems, c.fixes], [[], []]);
  assert.equal((await studio.request('POST', '/api/switcher', { type: 'keySetup', output: two })).status, 400);
});

test('an ATEM Mini Pro: a key it hasn\'t got is said plainly, and nothing is set up while it isn\'t answering', async t => {
  const { atem, studio } = await setUp(t, { model: 'MiniPro' });
  const added = await studio.post('/api/outputs', { add: true });
  const two = added.outputs.find(o => o.slot === 2).id;
  await studio.post('/api/outputs', { output: two, mode: 'fillkey', swFill: 3, swKey: 4 });
  let c = await keyFor(studio, two, x => x.problems.length);
  assert.match(c.problems[0], /The ATEM Mini Pro has one upstream key, so there's no upstream key 2: pick another/);
  await studio.post('/api/outputs', { output: two, keyer: 'usk1' });
  c = await keyFor(studio, two, x => x.keyer === 'usk1' && !x.problems.length);
  assert.deepEqual(c.fixes, ['Fill source is Black, should be Camera 3', 'Key source is Black, should be Camera 4', 'Pre Multiplied Key is off, should be on']);
  atem.drop();
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'lost', 8000, 100);
  assert.deepEqual((await studio.get('/api/switcher')).keys, []);
  const r = await studio.request('POST', '/api/switcher', { type: 'keySetup', output: two });
  assert.equal(r.status, 409);
  assert.deepEqual(atem.received.filter(x => SETUP.includes(x.name)), []);
});
