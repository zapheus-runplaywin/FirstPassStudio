// Picture HD or 4K (outputs.js quality): one setting for every output. In 4K each NDI and Blackmagic output keeps
// the format saved for it and sends the 2160p one at the same rate, drawn at twice the density; nothing else about
// it changes (names, sources, keys), and HD again is exactly as before. What can't go to 2160p says why. In 4K a
// Blackmagic output can also have one of the device's own 2160p formats picked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-output-quality-'));
process.env.FIRSTPASS_DATA_DIR = DIR;
const outputs = require('../outputs');
outputs.init(() => {}, {});
outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });
outputs.message({ type: 'ndi', ok: true, version: '6' });
const mode = (code, name, height, supported = true) => ({ mode: code, name, height, interlaced: false, supported, keying: supported });
outputs.message({ type: 'decklink', ok: true, devices: [
  { id: 'uhd', name: 'UltraStudio 4K', externalKeying: true, modes: [mode(1, '1080p50', 1080), mode(2, '1080p25', 1080), mode(3, '2160p50', 2160), mode(4, '2160p25', 2160)] },
  { id: 'hd', name: 'UltraStudio HD Mini', externalKeying: true, modes: [mode(5, '1080p50', 1080), mode(6, '1080p25', 1080)] },
] });

// Output 1 on NDI at 1080p50, Output 2 on the Blackmagic device, Output 3 a chroma display.
assert.equal(outputs.apply({ mode: 'ndi', ndiSignal: 'fillkey', ndiFormat: '1080p50', on: true }), null);
assert.equal(outputs.apply({ add: true, name: 'Court' }), null);
assert.equal(outputs.apply({ output: 'court', mode: 'decklink', decklinkDevice: 'uhd', decklinkMode: 1, on: true }), null);
assert.equal(outputs.apply({ add: true, name: 'Monitor' }), null);
assert.equal(outputs.apply({ output: 'monitor', mode: 'chroma', chromaDisplay: '2', on: true }), null);

const win = id => outputs.windows().find(w => w.output === outputs.find(id).id);
const saved = () => JSON.parse(fs.readFileSync(path.join(DIR, 'outputs.json'), 'utf8'));
const hdWindows = JSON.stringify(outputs.windows());

test('HD is the default, and sends each output\'s own format at one pixel per point', () => {
  assert.equal(outputs.state().quality, 'hd');
  assert.deepEqual(win('main').format, { id: '1080p50', width: 1920, height: 1080, rateN: 50, rateD: 1 });
  assert.equal(win('main').density, 1);
  assert.equal(win('court').mode, 1);
  assert.equal(win('court').density, 1);
  for (const o of outputs.state().outputs) assert.equal(o.picture.why, '');
});

test('4K sends the 2160p format at the same rate, drawn at twice the density, and keeps the saved formats', () => {
  assert.equal(outputs.apply({ quality: 'uhd' }), null);
  assert.equal(outputs.state().quality, 'uhd');
  assert.deepEqual(win('main').format, { id: '2160p50', width: 3840, height: 2160, rateN: 50, rateD: 1 });
  assert.equal(win('main').density, 2);
  assert.equal(win('main').name, 'Output 1', 'the NDI sources keep their names');
  assert.equal(win('main').signal, 'fillkey');
  assert.equal(win('court').mode, 3, 'the device\'s own 2160p50');
  assert.equal(win('court').density, 2);
  const st = outputs.state();
  assert.equal(st.outputs[0].ndiFormat, '1080p50', 'the saved format is unchanged');
  assert.deepEqual(st.outputs[0].picture, { uhd: true, format: '2160p50', why: '' });
  assert.equal(st.outputs[1].decklinkMode, 1);
  assert.equal(st.outputs[1].picture.format, '2160p50');
  assert.equal(saved().quality, 'uhd');
  assert.equal(saved().outputs[0].ndiFormat, '1080p50');
});

test('the rate follows the format picked for the output', () => {
  assert.equal(outputs.apply({ output: 'court', decklinkMode: 2 }), null);
  assert.equal(win('court').mode, 4, '1080p25 goes out as 2160p25');
  assert.equal(outputs.apply({ ndiFormat: '1080p59.94' }), null);
  assert.deepEqual(win('main').format, { id: '2160p59.94', width: 3840, height: 2160, rateN: 60000, rateD: 1001 });
  assert.equal(outputs.apply({ ndiFormat: '1080p50' }), null);
  assert.equal(outputs.apply({ output: 'court', decklinkMode: 1 }), null);
});

test('what can\'t go to 2160p stays as it is and says why', () => {
  assert.equal(outputs.apply({ output: 'court', decklinkDevice: 'hd', decklinkMode: 5 }), null);
  assert.equal(win('court').mode, 5);
  assert.equal(win('court').density, 1);
  assert.match(outputs.state().outputs[1].picture.why, /UltraStudio HD Mini has no 4K version of 1080p50, so it stays 1080p50/);
  assert.equal(outputs.apply({ ndiFormat: '720p50' }), null);
  assert.equal(win('main').format.id, '720p50');
  assert.equal(win('main').density, 1);
  assert.match(outputs.state().outputs[0].picture.why, /720p50 has no 4K version/);
  assert.deepEqual(win('monitor'), { display: '2', kind: 'chroma', color: '#00b140', safe: true, output: outputs.find('monitor').id }, 'a display is left alone');
  assert.match(outputs.state().outputs[2].picture.why, /display draws at its own size/);
  assert.equal(outputs.apply({ ndiFormat: '1080p50' }), null);
  assert.equal(outputs.apply({ output: 'court', decklinkDevice: 'uhd', decklinkMode: 1 }), null);
});

test('in 4K a Blackmagic output can have the device\'s own 2160p format picked, and HD sends the 1080p one at its rate', () => {
  assert.equal(outputs.apply({ output: 'court', decklinkMode: 4 }), null);
  assert.equal(win('court').mode, 4, '2160p25 as it is');
  assert.equal(win('court').density, 2);
  assert.deepEqual(outputs.state().outputs[1].picture, { uhd: true, format: '2160p25', why: '' });
  assert.equal(outputs.apply({ quality: 'hd' }), null);
  assert.equal(win('court').mode, 2, 'HD sends 1080p25, the same rate');
  assert.equal(win('court').density, 1);
  assert.equal(outputs.state().outputs[1].decklinkMode, 4, 'the pick is kept for 4K');
  assert.equal(outputs.apply({ quality: 'uhd' }), null);
  assert.equal(win('court').mode, 4);
  assert.equal(outputs.apply({ output: 'court', decklinkMode: 1 }), null);
});

test('HD again is exactly as before', () => {
  assert.equal(outputs.apply({ quality: 'hd' }), null);
  assert.equal(JSON.stringify(outputs.windows()), hdWindows);
  assert.equal(saved().quality, 'hd');
});

test('only hd and uhd are taken', () => {
  assert.match(outputs.apply({ quality: '8k' }), /hd or uhd/);
  assert.equal(outputs.state().quality, 'hd');
});
