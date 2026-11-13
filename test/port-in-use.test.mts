// Starting Studio on a port something else already holds: server.ts says so in one plain
// sentence and exits with code 3 (EXIT_PORT_IN_USE, which the Mac app recognises), instead of
// dying with a stack trace and being restarted five times.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

const ROOT = path.join(import.meta.dirname, '..');

test('a taken port gives a plain message and exit code 3', async () => {
  // Held on every address, as server.ts listens: on a Mac a port held only on 127.0.0.1 can
  // still be taken on all addresses, so Studio would start and the test would wait for ever.
  const holder = net.createServer();
  await new Promise<void>(resolve => holder.listen(0, resolve));
  const { port } = holder.address() as net.AddressInfo;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-port-'));
  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  try {
    child = spawn(process.execPath, [path.join(ROOT, 'out', 'server.js')], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), FIRSTPASS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    // If Studio starts after all, stop it after 20 s so the test fails instead of waiting for ever.
    const stop = setTimeout(() => child!.kill(), 20000);
    const code = await new Promise(resolve => child!.on('exit', resolve));
    clearTimeout(stop);
    assert.equal(code, 3);
    assert.match(err, new RegExp(`Port ${port} is already in use, so Studio can't start`));
    assert.doesNotMatch(err, /at .*server\.js:\d+/, 'no stack trace');
    const log = fs.readFileSync(path.join(dataDir, 'logs', 'playhq-graphics.log'), 'utf8');
    assert.match(log, /ERROR \[helper\] Port \d+ is already in use/);
  } finally {
    if (child && child.exitCode === null) child.kill();
    holder.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
