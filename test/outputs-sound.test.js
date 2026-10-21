// Who plays the scene's sound (outputs.js): the Scene View on the Output page (or its pop-out window) only
// while no video output is on; with one on, the output carries the sound and the Scene View is silent.
// There's no tick box for it any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-'));
const outputs = require('../outputs');
outputs.init(() => {});

// The Mac app telling Studio about its displays: the Mac's own and one more for a chroma output.
outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });

test('the Scene View plays the sound only while Video output is off', () => {
  outputs.apply({ mode: 'off' });
  assert.equal(outputs.state().previewSound, true, 'no output on: the Scene View may play the sound');
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: true });
  assert.equal(outputs.state().listening, true);

  // Turning a video output on: the Scene View goes silent and the output plays the sound (never muted).
  outputs.apply({ mode: 'chroma', chromaDisplay: '2', on: true });
  assert.equal(outputs.windows().length, 1);
  assert.equal(outputs.windows()[0].muted, undefined, 'outputs are never muted for the Scene View');
  assert.equal(outputs.state().previewSound, false);
  assert.equal(outputs.state().listening, false);
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: false }, 'asking again gets no');
  assert.deepEqual(outputs.listen({ id: 'b', on: true, take: true }), { sound: false }, 'clicking the Scene View gets no too');

  // Blanking it (Stream Deck /deck/output/off) counts as off: the Scene View can have the sound back.
  outputs.deck(['output', 'off']);
  assert.equal(outputs.state().previewSound, true);
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: true });
  outputs.deck(['output', 'on']);
  assert.equal(outputs.state().listening, false);

  // An output whose display has gone shows nothing, so the Scene View plays the sound.
  outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }] });
  assert.equal(outputs.windows().length, 0);
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: true });
  outputs.apply({ mode: 'off' });
});

test('one Scene View at a time, and a click takes it', () => {
  outputs.apply({ mode: 'off' });
  outputs.listen({ id: 'a', on: false });
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: true });
  assert.deepEqual(outputs.listen({ id: 'b', on: true }), { sound: false }, 'another page waits its turn');
  assert.deepEqual(outputs.listen({ id: 'b', on: true, take: true }), { sound: true }, 'clicking its Scene View takes it');
  assert.deepEqual(outputs.listen({ id: 'a', on: true }), { sound: false });
  outputs.listen({ id: 'b', on: false });
  assert.equal(outputs.state().listening, false, 'letting go leaves nobody playing it');
});

test('an old Scene View sound setting is dropped and the tick box is gone', () => {
  outputs.apply({ previewSound: false });
  assert.equal(outputs.state().previewSound, true, 'the old setting no longer silences the Scene View');
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'outputs.json'), 'utf8'));
  assert.equal('previewSound' in saved, false);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'output.html'), 'utf8');
  assert.doesNotMatch(page, /id="previewSound"/);
  assert.match(page, /only while <b>Video output<\/b> is off/);
});
