// The Scene View (the Output page's, or its pop-out window) never plays sound (outputs.ts, output.html): an output's
// sound plays where its Sound goes to says, on or off, so nothing plays twice and nothing plays from a page that
// happens to be open. There's no tick box for it, and no listen API, any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-'));
const outputs = require('../out/outputs');
outputs.init(() => {});

// The Mac app telling Studio about its displays: the Mac's own and one more for a chroma output.
outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });

test('the Scene View never plays sound: no sound flags for it, and the outputs are never muted for it', async () => {
  outputs.apply({ mode: 'off' });
  assert.equal('previewSound' in outputs.state(), false, 'no "the Scene View may play the sound" flag');
  assert.equal('listening' in outputs.state(), false);
  assert.equal(outputs.listen, undefined, 'no listen API');
  // Turning a video output on: the output plays the sound (never muted), as it did before.
  outputs.apply({ mode: 'chroma', chromaDisplay: '2', on: true });
  assert.equal(outputs.windows().length, 1);
  assert.equal(outputs.windows()[0].muted, undefined, 'outputs are never muted for the Scene View');
  assert.deepEqual(outputs.state().outputs.map(o => 'previewSound' in o || 'listening' in o), [false]);
  // Blanking it (Stream Deck /deck/output/off) changes nothing for the Scene View.
  outputs.deck(['output', 'off']);
  assert.equal('previewSound' in outputs.state(), false);
  outputs.deck(['output', 'on']);
  // The old listen API is gone: the request falls through to whatever else answers.
  const url = new URL('http://localhost/api/outputs/listen');
  assert.equal(await outputs.route({ method: 'POST' }, {}, url, { send: () => assert.fail('answered'), readBody: async () => ({ id: 'a', on: true }) }), false);
  outputs.apply({ mode: 'off' });
});

test('an old Scene View sound setting is dropped, and the page says the Scene View is silent', () => {
  outputs.apply({ previewSound: false });
  assert.equal('previewSound' in outputs.state(), false);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.FIRSTPASS_DATA_DIR, 'outputs.json'), 'utf8'));
  assert.equal('previewSound' in saved, false);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'output.html'), 'utf8');
  assert.doesNotMatch(page, /id="previewSound"/);
  assert.doesNotMatch(page, /only while <b>Video output<\/b> is off/);
  assert.match(page, /id="previewSoundNote">Silent: an output's sound plays where its <b>Sound goes to<\/b> says/);
  for (const f of ['public/output/preview.js', 'public/preview.html', 'public/output/settings.js', 'public/scene.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /outputs\/listen|previewSound|unlockSound/, `${f} no longer asks to play the sound`);
  }
});
