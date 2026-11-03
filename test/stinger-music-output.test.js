// The stinger's Music under it (?music=quiet or duck, on the Switcher card and in the source's options): it goes by the
// output the stinger plays on (switcher.js stingerOutput), so it ducks the music on a night Output 1 is off and the stinger
// plays on another output's downstream key; the stinger shown by hand on an output it doesn't play on leaves the music
// alone. The Switcher card reads the choice from /api/switcher (stingerId, stingerMusic) and sets it on the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio } = require('./support/studio');

test('the stinger\'s Music under it goes by the output the stinger plays on, and the Switcher card reads and sets it', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-stinger-music-'));
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'media', 'Break.mp3'), '');
  const studio = await startStudio(t, { dataDir, removeDataDir: true });
  const act = async a => { const r = await studio.request('POST', '/api/scene', a); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  const music = async () => (await studio.get('/api/scene')).music;

  await act({ type: 'add', sources: [{ type: 'browser', name: 'Stinger', url: 'stinger.html?length=1' }] });
  let sw = await studio.get('/api/switcher');
  const id = sw.stingerId;
  assert.ok(id);
  assert.equal(sw.stingerMusic, '', 'carries on by default');
  // The card sets the source's own option, and reads it back (dip, its old name, reads as duck).
  await act({ type: 'update', id, changes: { url: 'stinger.html?length=1&music=dip' } });
  assert.equal((await studio.get('/api/switcher')).stingerMusic, 'duck');
  await act({ type: 'update', id, changes: { url: 'stinger.html?length=1&music=quiet' } });
  assert.equal((await studio.get('/api/switcher')).stingerMusic, 'quiet');
  await act({ type: 'update', id, changes: { url: 'stinger.html?length=1&music=duck' } });
  assert.equal((await studio.get('/api/switcher')).stingerMusic, 'duck');

  // Output 1 off on an upstream key, a second output on the downstream key and on: the stinger plays there.
  await studio.post('/api/outputs', { mode: 'chroma', keyer: 'usk1', on: false });
  const added = await studio.post('/api/outputs', { add: true, name: 'Over all' });
  const two = added.outputs.find(o => o.slot === 2).id;
  await studio.post('/api/outputs', { output: two, mode: 'ndi', ndiSignal: 'fillkey', keyer: 'dsk1' });
  await studio.post('/api/outputs', { output: two, on: true });
  sw = await studio.get('/api/switcher');
  assert.equal(sw.stingerOutput.id, two);

  await act({ type: 'musicLoad', track: 'Break.mp3', play: true, fade: 0 });
  assert.equal((await music()).status, 'playing');
  // Shown by hand on Output 1, which it doesn't play on: the music is left alone.
  await act({ type: 'show', name: 'Stinger' });
  assert.equal((await music()).ducked, false, 'not the stinger\'s output');
  await act({ type: 'hide', name: 'Stinger' });
  // On its own output: down as it sweeps in, back up as it goes.
  await act({ type: 'show', name: 'Stinger', output: two });
  assert.equal((await music()).ducked, true, 'ducked on the output the stinger plays on');
  await act({ type: 'hide', name: 'Stinger', output: two });
  assert.equal((await music()).ducked, false, 'back up as it leaves');
  assert.match(studio.log(), /Stinger: music ducked until it ends/);
});
