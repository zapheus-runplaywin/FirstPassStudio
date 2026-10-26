// How hard each output is working (outputs.js perf): the app reports every few seconds while an output
// is showing; the Output page gets each output's numbers and Studio's total, and the log a line a minute.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outputs-perf-'));
const outputs = require('../outputs');
const lines = [];
outputs.init((level, area, text) => lines.push(text));
outputs.apply({ add: true });
const second = () => outputs.state().outputs[1];

test('no numbers until the app reports them', () => {
  assert.equal(outputs.state().outputs[0].perf, null);
  assert.equal(outputs.state().perfTotal, null);
});

test('each output gets its own numbers, and the page gets Studio in all', () => {
  outputs.message({ type: 'perf', outputs: { main: { cpu: 21.4, memMB: 300, fps: 50, target: 50 }, [second().id]: { cpu: 9, memMB: 180, fps: 41, target: 50 } }, total: { cpu: 60, memMB: 1500, gpu: 18 } });
  const st = outputs.state();
  assert.deepEqual(st.outputs[0].perf, { cpu: 21, memMB: 300, fps: 50, target: 50 });
  assert.deepEqual(st.outputs[1].perf, { cpu: 9, memMB: 180, fps: 41, target: 50 });
  assert.deepEqual(st.perfTotal, { cpu: 60, memMB: 1500, gpu: 18 });
  assert.deepEqual(st.perf, st.outputs[0].perf, 'the primary at the top, as before');
});

test('bad numbers are dropped, not shown', () => {
  outputs.message({ type: 'perf', outputs: { main: { cpu: 'x', memMB: -4, fps: null, target: 50 } }, total: null });
  assert.deepEqual(outputs.state().outputs[0].perf, { cpu: 0, memMB: 0, fps: 0, target: 50 });
  assert.equal(outputs.state().outputs[1].perf, null);
  assert.equal(outputs.state().perfTotal, null);
});

test('a minute of reports logs one line with each output and Studio in all', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  outputs.message({ type: 'perf', outputs: {}, total: null }); // nothing showing: starts afresh
  lines.length = 0;
  for (let i = 0; i <= 12; i++) {
    outputs.message({ type: 'perf', outputs: { main: { cpu: 20, memMB: 300, fps: i === 5 ? 30 : 50, target: 50 }, [second().id]: { cpu: 10, memMB: 200, fps: 50, target: 60 } }, total: { cpu: 50, memMB: 1200, gpu: 15 } });
    t.mock.timers.tick(5000);
  }
  const line = lines.find(l => l.startsWith('Performance'));
  assert.ok(line, lines.join('\n'));
  assert.match(line, /Output 1 20% CPU, 300 MB, 48 of 50 fps \(lowest 30\)/);
  assert.match(line, /Output 2 10% CPU, 200 MB, 50 of 60 fps \(lowest 50\)/);
  assert.match(line, /Studio in all 50% CPU, 1200 MB, graphics processor 15% CPU/);
  assert.equal(lines.filter(l => l.startsWith('Performance')).length, 1);
});

test('numbers older than 15 seconds are dropped (the app stopped reporting)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  outputs.message({ type: 'perf', outputs: { main: { cpu: 5, memMB: 100, fps: 50, target: 50 } }, total: { cpu: 5, memMB: 500, gpu: 1 } });
  assert.ok(outputs.state().outputs[0].perf);
  t.mock.timers.tick(16000);
  assert.equal(outputs.state().outputs[0].perf, null);
  assert.equal(outputs.state().perfTotal, null);
});
