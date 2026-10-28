// NDI video formats (outputs.js): 1080p at the rates a Blackmagic device can name (23.98 to 120 fps) and 720p at 25 to 60, each sent at its exact
// rate (23.98 is 24000/1001). A format Studio doesn't know falls back to 1080p50.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ndi-formats-'));
process.env.FIRSTPASS_DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'outputs.json'), JSON.stringify({ mode: 'ndi', on: true, ndiSignal: 'alpha', ndiName: 'Studio', ndiFormat: '2160p50' }));

const outputs = require('../outputs');
outputs.init(() => {});
outputs.message({ type: 'ndi', ok: true, version: '6' });

const sent = () => outputs.windows().find(w => w.kind === 'ndi').format;

test('a format Studio doesn\'t know falls back to 1080p50', () => {
  assert.equal(outputs.state().outputs[0].ndiFormat, '1080p50');
  assert.deepEqual(sent(), { id: '1080p50', width: 1920, height: 1080, rateN: 50, rateD: 1 });
});

test('every Blackmagic 1080p rate can be picked and are sent at their exact rates', () => {
  const ids = outputs.state().ndiFormats.map(f => f.id);
  for (const id of ['1080p23.98', '1080p24', '1080p25', '1080p29.97', '1080p30', '1080p47.95', '1080p48', '1080p50', '1080p59.94', '1080p60', '1080p95.9', '1080p96', '1080p100', '1080p119.88', '1080p120']) assert.ok(ids.includes(id), id);
  assert.equal(outputs.apply({ output: 'main', ndiFormat: '1080p24' }), null);
  assert.deepEqual(sent(), { id: '1080p24', width: 1920, height: 1080, rateN: 24, rateD: 1 });
  assert.equal(outputs.apply({ output: 'main', ndiFormat: '1080p23.98' }), null);
  assert.deepEqual(sent(), { id: '1080p23.98', width: 1920, height: 1080, rateN: 24000, rateD: 1001 });
  assert.equal(outputs.apply({ output: 'main', ndiFormat: '1080p119.88' }), null);
  assert.deepEqual(sent(), { id: '1080p119.88', width: 1920, height: 1080, rateN: 120000, rateD: 1001 });
});
