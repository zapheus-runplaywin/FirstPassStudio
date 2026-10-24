// Starting Studio on a port something else already holds: server.js says so in one plain
// sentence and exits with code 3 (EXIT_PORT_IN_USE, which the Mac app recognises), instead of
// dying with a stack trace and being restarted five times.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('a taken port gives a plain message and exit code 3', async () => {
  const holder = net.createServer();
  await new Promise(resolve => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-port-'));
  try {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), FIRSTPASS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 3);
    assert.match(err, new RegExp(`Port ${port} is already in use, so Studio can't start`));
    assert.doesNotMatch(err, /at .*server\.js:\d+/, 'no stack trace');
    const log = fs.readFileSync(path.join(dataDir, 'logs', 'playhq-graphics.log'), 'utf8');
    assert.match(log, /ERROR \[helper\] Port \d+ is already in use/);
  } finally {
    holder.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
