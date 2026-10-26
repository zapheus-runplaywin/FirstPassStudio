// Where the stinger plays (switcher.js stingerOutput): on the output on a downstream key, Output 1 unless another is
// (and switched on), as only a downstream key covers the whole picture; each output keeps its own line-up (NDI reaches the switcher later
// than HDMI), and only the stinger's own output's report times the cut. An older switcher.json's one line-up becomes
// Output 1's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio, wait } = require('./support/studio');
const { startAtem } = require('./support/atem');

test('the stinger plays on the output on a downstream key, with that output\'s line-up, and only its report times the cut', async t => {
  const atem = await startAtem({ model: 'MiniExtreme', names: ['Wide', 'Court', 'Bench'] });
  t.after(() => atem.close());
  const studio = await startStudio(t);
  await studio.post('/api/switcher', { type: 'use', address: `127.0.0.1:${atem.port}` });
  await studio.until(async () => (await studio.get('/api/switcher')).state === 'connected', 8000, 100);
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Stinger', url: 'stinger.html' }] });
  let s = await studio.get('/api/switcher');
  // Output 1 set to Off is off, so the card says to turn it on (a stinger without an output is a late plain cut).
  assert.deepEqual(s.stingerOutput, { id: 'main', name: 'Output 1', on: false }, 'Output 1 with nothing set up');

  // Output 1 goes on upstream key 1 (a chroma screen, say) and a second output, NDI, takes downstream key 1.
  await studio.post('/api/outputs', { mode: 'chroma', keyer: 'usk1', on: true });
  const added = await studio.post('/api/outputs', { add: true, name: 'Over all' });
  const two = added.outputs.find(o => o.slot === 2).id;
  await studio.post('/api/outputs', { output: two, mode: 'ndi', ndiSignal: 'fillkey', keyer: 'dsk1' });
  s = await studio.get('/api/switcher');
  // A new output starts switched off: the stinger stays on Output 1, which is on, until it's turned on.
  assert.deepEqual(s.stingerOutput, { id: 'main', name: 'Output 1', on: true }, 'not an output that\'s off');
  // With Output 1 off too, it's the downstream key's output, and the card says to turn it on.
  await studio.post('/api/outputs', { on: false });
  s = await studio.get('/api/switcher');
  assert.deepEqual(s.stingerOutput, { id: two, name: 'Over all', on: false });
  await studio.post('/api/outputs', { on: true });
  await studio.post('/api/outputs', { output: two, on: true });
  s = await studio.get('/api/switcher');
  assert.deepEqual(s.stingerOutput, { id: two, name: 'Over all', on: true });
  assert.equal(s.lineup, 0);

  // Each output's line-up is its own; the Switcher card's is the stinger's output's.
  await studio.post('/api/switcher', { type: 'lineup', frames: 4 });
  await studio.post('/api/switcher', { type: 'lineup', frames: -2, output: 'main' });
  s = await studio.get('/api/switcher');
  assert.equal(s.lineup, 4);
  assert.deepEqual(s.lineups, { [two]: 4, main: -2 });

  // A stinger: it goes on for Over all (not Output 1), and Output 1's own report of it is no cue to cut.
  const play = studio.request('POST', '/api/switcher', { type: 'stinger', input: 2 });
  await studio.until(async () => (await studio.get('/api/scene')).sources.find(x => x.name === 'Stinger').out?.[two], 3000, 10);
  const src = (await studio.get('/api/scene')).sources.find(x => x.name === 'Stinger');
  assert.equal(src.visible, false, 'not on Output 1');
  await studio.post('/api/switcher', { type: 'stingerStarted', cover: [0.22, 1.22], output: 'main' });
  await wait(1000);
  assert.equal(atem.state.program, 1, 'no cut from Output 1\'s report');
  const at = Date.now();
  await studio.post('/api/switcher', { type: 'stingerStarted', cover: [0.22, 1.22], output: two });
  const answered = Date.now();
  await play;
  const cut = atem.received.filter(c => c.name === 'DCut').at(-1).at;
  assert.equal(atem.state.program, 2);
  // 720 ms plus 4 frames at 50 fps (80 ms), timed from when Studio got the report, which is
  // somewhere between sending it and its answer (a slow runner can take a while to answer).
  assert.ok(cut - at > 700 && cut - answered < 900, `cut ${cut - at} ms after sending Over all's report and ${cut - answered} ms after its answer, wanted 800`);
  assert.match(studio.log(), /stinger to Court \(on Over all, cut at 0\.80 s/);
  assert.match(studio.log(), /Stinger line-up 4 frames for Over all/);
});

test('an older switcher.json\'s one line-up becomes Output 1\'s', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-stinger-lineup-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'switcher.json'), JSON.stringify({ pick: null, lineup: 3 }));
  const studio = await startStudio(t, { dataDir });
  const s = await studio.get('/api/switcher');
  assert.equal(s.lineup, 3);
  assert.deepEqual(s.lineups, { main: 3 });
});
