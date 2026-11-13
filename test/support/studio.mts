// Runs server.ts for a test, in a data folder of its own, against the stand-in PlayHQ
// (test/support/playhq.mts), in a time zone where it's about midday.
//   const studio = await startStudio(t);            // empty data folder, no competition
//   const studio = await startStudio(t, { competition: 'Thunder League' });  // imported from templates/
//   await studio.get('/api/scoreboard'); await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
// Everything is stopped and removed when the test ends.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import type { TestContext } from 'node:test';
import { startPlayhq, createWorld, localZone, type World } from './playhq.mts';

// any: a test reads Studio's JSON answers freely, and its assertions are what check their shape.
export type Json = any;
// What a Stream Deck link answers (null: not one of Studio's), its body read freely like any JSON answer.
export type DeckReply = { status: number; body: Json } | null;

const ROOT = path.join(import.meta.dirname, '..', '..');
const SERVER = path.join(ROOT, 'out', 'server.js');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runs server.ts with env on a free port until it says it is running. The free port is found by
// opening and closing a socket, so another process can take it before server.ts does (seen on the
// Mac runner, where test files run side by side): then it is tried again on another port.
// Gives { child, port, output, exit (a promise of the exit code), exited() }.
export interface Server { child: ChildProcess; port: number; output: string[]; exit: Promise<number | null>; exited: () => number | null }

async function runServer(env: Record<string, string | undefined>, tries = 3): Promise<Server> {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const output: string[] = [];
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, FIRSTPASS_NO_BONJOUR: '1', FIRSTPASS_STORIES_CLOUD: 'off', ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => output.push(String(d)));
    child.stderr.on('data', d => output.push(String(d)));
    let exited: number | null = null;
    const exit = new Promise<number | null>(r => child.on('exit', code => { exited = code; r(code); }));
    const running = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.stdout.on('data', () => { if (output.join('').includes('is running')) { clearTimeout(timer); resolve(true); } });
      exit.then(() => { clearTimeout(timer); resolve(false); });
    });
    if (running) return { child, port, output, exit, exited: () => exited };
    if (exited === null) { child.kill(); await exit; }
    // server.ts exits 3 when its port is taken (EXIT_PORT_IN_USE), saying so in words rather than EADDRINUSE.
    if (attempt < tries && exited === 3) continue;
    throw new Error(exited === null ? `server.ts didn't start:\n${output.join('')}` : `server.ts exited (${exited}):\n${output.join('')}`);
  }
}

// Starts Studio. Options: competition (a template in templates/ to import, by its file name),
// dataDir (an existing data folder to use), removeDataDir (remove that folder too when Studio has
// stopped), world (the stand-in PlayHQ's season), env.
// A test that makes its own data folder passes removeDataDir rather than removing it in a t.after of
// its own: t.after hooks run in the order they were added, so that one would run while Studio is still
// writing to the folder (ENOTEMPTY on the Mac), and its error skips the stop, leaving Studio running
// and the test file never finishing (the Mac app build's 10-minute timeouts on 28 Oct).
export interface StudioOptions { competition?: string; dataDir?: string; removeDataDir?: boolean; keepDataDir?: boolean; world?: World; env?: Record<string, string> }

async function startStudio(t: TestContext | null, opts: StudioOptions = {}) {
  const playhq = await startPlayhq(opts.world || createWorld());
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  let server: Server | null = null;
  const stop = async () => {
    if (server && server.exited() === null) { server.child.kill(); await server.exit; }
    await playhq.close();
    if ((!opts.dataDir || opts.removeDataDir) && !opts.keepDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  if (t) t.after(stop);
  server = await runServer({ FIRSTPASS_DATA_DIR: dataDir, TZ: localZone(playhq.world.now).tz,
    PLAYHQ_API_URL: playhq.url, PLAYHQ_SPECTATOR_URL: playhq.spectatorUrl, ...opts.env });
  const { child, port, output } = server;
  const exited = server.exited;

  const base = `http://127.0.0.1:${port}`;
  // Stream Deck links are pressed the way the Studio plugin presses them (its x-studio-deck header), since Studio
  // refuses one without its key; access.test.mts tests the key itself.
  const request = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; type: string; text: string; json: Json }> => {
    if (/^\/deck(\/|\?|$)/.test(p)) headers = { 'x-studio-deck': '1', ...headers };
    const isRaw = Buffer.isBuffer(body) || typeof body === 'string';
    const res = await fetch(base + p, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : isRaw ? body as string | Buffer<ArrayBuffer> : JSON.stringify(body) });
    const text = await res.text();
    let json: Json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, type: res.headers.get('content-type') || '', text, json };
  };
  const studio = {
    base, port, dataDir, playhq, world: playhq.world, output, child, stop, exitedPromise: server.exit,
    exited,
    request,
    competition: null as Json,
    // The JSON answer of a GET or POST (fails the test on an HTTP error).
    async get(p: string): Promise<Json> { const r = await request('GET', p); if (r.status >= 400) throw new Error(`GET ${p} answered ${r.status}: ${r.text}`); return r.json; },
    async post(p: string, body: unknown = {}): Promise<Json> { const r = await request('POST', p, body); if (r.status >= 400) throw new Error(`POST ${p} answered ${r.status}: ${r.text}`); return r.json; },
    async del(p: string): Promise<Json> { const r = await request('DELETE', p); if (r.status >= 400) throw new Error(`DELETE ${p} answered ${r.status}: ${r.text}`); return r.json; },
    log: () => { try { return fs.readFileSync(path.join(dataDir, 'logs', 'playhq-graphics.log'), 'utf8'); } catch { return ''; } },
    // PlayHQ calls since the last mark, e.g. studio.calls().filter(c => c.spectator).
    calls: () => playhq.world.calls,
    // Polls fn until it gives something truthy (or the time runs out).
    async until<T>(fn: () => T | Promise<T>, ms = 10000, step = 200): Promise<T> {
      const end = Date.now() + ms;
      let last: T | undefined;
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

export type Studio = Awaited<ReturnType<typeof startStudio>>;

export { startStudio, runServer, wait, ROOT };
