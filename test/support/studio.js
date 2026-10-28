// Runs server.js for a test, in a data folder of its own, against the stand-in PlayHQ
// (test/support/playhq.js), in a time zone where it's about midday.
//   const studio = await startStudio(t);            // empty data folder, no competition
//   const studio = await startStudio(t, { competition: 'Thunder League' });  // imported from templates/
//   await studio.get('/api/scoreboard'); await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
// Everything is stopped and removed when the test ends.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { startPlayhq, createWorld, localZone } = require('./playhq');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// Runs server.js with env on a free port until it says it is running. The free port is found by
// opening and closing a socket, so another process can take it before server.js does (seen on the
// Mac runner, where test files run side by side): then it is tried again on another port.
// Gives { child, port, output, exit (a promise of the exit code), exited() }.
async function runServer(env, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const output = [];
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => output.push(String(d)));
    child.stderr.on('data', d => output.push(String(d)));
    let exited = null;
    const exit = new Promise(r => child.on('exit', code => { exited = code; r(code); }));
    const running = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.stdout.on('data', () => { if (output.join('').includes('is running')) { clearTimeout(timer); resolve(true); } });
      exit.then(() => { clearTimeout(timer); resolve(false); });
    });
    if (running) return { child, port, output, exit, exited: () => exited };
    if (exited === null) { child.kill(); await exit; }
    if (attempt < tries && /EADDRINUSE/.test(output.join(''))) continue;
    throw new Error(exited === null ? `server.js didn't start:\n${output.join('')}` : `server.js exited (${exited}):\n${output.join('')}`);
  }
}

// Starts Studio. Options: competition (a template in templates/ to import, by its file name),
// dataDir (an existing data folder to use), world (the stand-in PlayHQ's season), env.
async function startStudio(t, opts = {}) {
  const playhq = await startPlayhq(opts.world || createWorld());
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  let server = null;
  const stop = async () => {
    if (server && server.exited() === null) { server.child.kill(); await server.exit; }
    await playhq.close();
    if (!opts.dataDir && !opts.keepDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  if (t) t.after(stop);
  server = await runServer({ FIRSTPASS_DATA_DIR: dataDir, TZ: localZone(playhq.world.now).tz,
    PLAYHQ_API_URL: playhq.url, PLAYHQ_SPECTATOR_URL: playhq.spectatorUrl, ...opts.env });
  const { child, port, output } = server;
  const exited = server.exited;

  const base = `http://127.0.0.1:${port}`;
  // Stream Deck links are pressed the way the Studio plugin presses them (its x-studio-deck header), since Studio
  // refuses one without its key; access.test.js tests the key itself.
  const request = async (method, p, body, headers = {}) => {
    if (/^\/deck(\/|\?|$)/.test(p)) headers = { 'x-studio-deck': '1', ...headers };
    const isRaw = Buffer.isBuffer(body) || typeof body === 'string';
    const res = await fetch(base + p, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, type: res.headers.get('content-type') || '', text, json };
  };
  const studio = {
    base, port, dataDir, playhq, world: playhq.world, output, child, stop,
    exited,
    request,
    // The JSON answer of a GET or POST (fails the test on an HTTP error).
    async get(p) { const r = await request('GET', p); if (r.status >= 400) throw new Error(`GET ${p} answered ${r.status}: ${r.text}`); return r.json; },
    async post(p, body = {}) { const r = await request('POST', p, body); if (r.status >= 400) throw new Error(`POST ${p} answered ${r.status}: ${r.text}`); return r.json; },
    async del(p) { const r = await request('DELETE', p); if (r.status >= 400) throw new Error(`DELETE ${p} answered ${r.status}: ${r.text}`); return r.json; },
    log: () => { try { return fs.readFileSync(path.join(dataDir, 'logs', 'playhq-graphics.log'), 'utf8'); } catch { return ''; } },
    // PlayHQ calls since the last mark, e.g. studio.calls().filter(c => c.spectator).
    calls: () => playhq.world.calls,
    // Polls fn until it gives something truthy (or the time runs out).
    async until(fn, ms = 10000, step = 200) {
      const end = Date.now() + ms;
      let last;
      while (Date.now() < end) { last = await fn(); if (last) return last; await wait(step); }
      throw new Error(`Gave up waiting after ${ms}ms (last: ${JSON.stringify(last)})`);
    },
  };
  if (opts.competition) {
    const tpl = fs.readFileSync(path.join(ROOT, 'templates', `${opts.competition}.json`));
    studio.competition = await studio.post('/api/setup-template', tpl);
  }
  return studio;
}

module.exports = { startStudio, runServer, wait, ROOT };
