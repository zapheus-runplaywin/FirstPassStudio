// The venue link (venuelink.ts): FirstPass Vantage hands a game's events to Studio on the venue network, and the
// FirstPass Vision phone app reads them from Studio. Who may: this Mac, and a FirstPass app allowed in Devices… that
// asked and collected its key over the secure link (devices.ts kind 'stats'), whose key counts for these routes only.
// What Studio does with the events is in hqstats.test.mts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// devices.ts keeps devices.json in the data folder it is given when first loaded.
process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-devices-'));
const access: typeof import('../out/access.js') = require('../out/access.js');
const devices: typeof import('../out/devices.js') = require('../out/devices.js');
const venuelink: typeof import('../out/venuelink.js') = require('../out/venuelink.js');
const { startStudio } = require('./support/studio.mts') as typeof import('./support/studio.mts');

const own = new Set(['127.0.0.1', '::1', '192.168.1.20']);
const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const VENUE = '/api/firstpass/venue/events';
const TABLET = '192.168.1.77';

test('a FirstPass app reaches the venue link only: over the secure link, with a key collected over it', () => {
  const app = { kind: 'stats', secure: true };
  assert.equal(access.venue(VENUE), true);
  assert.equal(access.venue('/api/firstpass/venues'), false);
  assert.equal(access.firstpassRefusal('POST', VENUE, TABLET, app, true, own), null);
  assert.equal(access.firstpassRefusal('GET', VENUE, TABLET, app, true, own), null);
  // Plain http: refused, whoever asks.
  assert.match(access.firstpassRefusal('POST', VENUE, TABLET, app, false, own)!, /secure link \(https\)/);
  // A key that crossed the network in the clear doesn't count.
  assert.ok(access.firstpassRefusal('GET', VENUE, TABLET, { kind: 'stats' }, true, own));
  // No device at all, a Stream Deck plugin, a program: refused.
  for (const d of [null, { kind: 'plugin', secure: true }, { kind: 'program', secure: true }, { kind: 'links' }]) assert.ok(access.firstpassRefusal('GET', VENUE, TABLET, d, true, own));
  // The app gets nothing else of FirstPass stats.
  for (const p of ['/api/firstpass/status', '/api/firstpass/onair', '/api/firstpass/markers', '/api/firstpass/clubs']) assert.ok(access.firstpassRefusal('GET', p, TABLET, app, true, own), p);
  // This Mac always may; a browser paired over the secure link may read, as it reads the rest.
  assert.equal(access.firstpassRefusal('POST', VENUE, '192.168.1.20', null, false, own), null);
  assert.equal(access.firstpassRefusal('GET', VENUE, TABLET, { kind: 'browser', secure: true }, true, own), null);
});

test('a FirstPass app is allowed on the Mac like any device, and its key opens nothing but the venue link', () => {
  devices.load(() => {});
  const asked = devices.ask('Court 1 tablet', TABLET, undefined, false, true);
  assert.ok('id' in asked, JSON.stringify(asked));
  assert.equal(devices.pending()!.stats, true, 'the Devices page and the Mac\'s dialog say what is asking');
  assert.equal(devices.collect(asked.id, asked.token, true).status, 'waiting', 'nothing until someone presses Allow');
  assert.equal(devices.answer(asked.id, true, 'full'), true);
  const got = devices.collect(asked.id, asked.token, true) as { status: string; key?: string; device?: string; cookie?: string };
  assert.equal(got.status, 'allowed');
  assert.ok(got.key && !got.cookie);
  const listed = devices.list().find(d => d.id === got.device)!;
  assert.deepEqual([listed.kind, listed.level, listed.secure], ['stats', 'scoring', true]);
  assert.ok(!('secret' in listed));
  // In the header it is the app; as a Stream Deck link key, or a browser's cookie, it is nobody.
  assert.equal(devices.fromKey(got.key)!.id, got.device);
  assert.equal(devices.match(got.key), null, 'not a /k/ link key');
  assert.equal(devices.fromCookie(`${devices.COOKIE}=${got.key}`), null);
  assert.equal(devices.fromKey('nope'), null);
  assert.equal(devices.fromKey(undefined), null);
  assert.equal(devices.fromKey(devices.linkKey()), null, 'a Stream Deck key is not a FirstPass app');
  // Taken away in Devices…: the key stops counting at once.
  assert.equal(devices.revoke(got.device!), true);
  assert.equal(devices.fromKey(got.key), null);
  // One whose key was collected over plain http (only possible on the Mac itself) is never marked secure.
  const local = devices.ask('This Mac\'s Vantage', '127.0.0.1', undefined, false, true);
  assert.ok('id' in local);
  devices.answer(local.id, true);
  const plain = devices.collect(local.id, local.token, false) as { device?: string };
  assert.equal(devices.list().find(d => d.id === plain.device)!.secure, undefined);
});

// A stand-in for hqstats.ts: one followed game with events 1..n.
function standIn() {
  const s = {
    events: [] as { seq: number }[], listeners: new Set<() => void>(), took: [] as unknown[][], refuse: '' as '' | 'not-followed' | 'other-recorder',
    add(n: number) { for (let i = 0; i < n; i++) s.events.push({ seq: s.events.length + 1 }); for (const fn of s.listeners) fn(); },
    venue(gameId: string, list: unknown[], sender: string) {
      s.took.push([gameId, list.length, sender]);
      if (s.refuse || gameId !== GAME) return { ok: false as const, reason: s.refuse || 'not-followed' as const };
      s.add(list.length);
      return { ok: true as const, throughSeq: s.events.length, taken: list.length };
    },
    since(gameId: string, after: number) {
      if (gameId !== GAME) return null;
      return { gameId, status: 'live', throughSeq: s.events.length, confirmedSeq: 0, firstSeq: 1, events: s.events.filter(e => e.seq > after), helper: [] };
    },
    onChange(fn: () => void) { s.listeners.add(fn); return () => { s.listeners.delete(fn); }; },
  };
  return s;
}

// The routes on a little server of their own, asked as `sender`.
async function serve(t: test.TestContext, stats: ReturnType<typeof standIn>, who: { sender: string }) {
  const link = venuelink.create({ stats: stats as unknown as Parameters<typeof venuelink.create>[0]['stats'] });
  const send = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req: http.IncomingMessage) => new Promise<Record<string, unknown>>((resolve, reject) => {
    let text = '';
    req.on('data', d => { text += d; });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(e); } });
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!await link.route(req, res, url, { send, readBody, sender: who.sender })) send(res, 404, { error: 'not a venue route' });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ask = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  return { ask, base };
}

test('Vantage sends events and learns how far Studio has them; anything else is told why not', async t => {
  const stats = standIn();
  const who = { sender: 'tablet-1' };
  const { ask } = await serve(t, stats, who);
  const sent = await ask('POST', VENUE, { gameId: GAME, events: [{}, {}, {}] });
  assert.deepEqual([sent.status, sent.json], [200, { throughSeq: 3, taken: 3 }]);
  assert.deepEqual(stats.took[0], [GAME, 3, 'tablet-1'], 'Studio knows which device sent them');
  // Not the game followed, or a device whose events weren't HQ's: 409 with the reason, for Vantage to show.
  const other = await ask('POST', VENUE, { gameId: '7d2e1c44-90ab-4cde-8f01-23456789abcd', events: [{}] });
  assert.deepEqual([other.status, other.json.reason], [409, 'not-followed']);
  stats.refuse = 'other-recorder';
  const stale = await ask('POST', VENUE, { gameId: GAME, events: [{}] });
  assert.deepEqual([stale.status, stale.json.reason], [409, 'other-recorder']);
  stats.refuse = '';
  // Bad requests take nothing.
  const before = stats.took.length;
  assert.equal((await ask('POST', VENUE, { gameId: 'not-a-game', events: [] })).status, 400);
  assert.equal((await ask('POST', VENUE, { gameId: GAME, events: Array.from({ length: venuelink.MAX_EVENTS + 1 }, () => ({})) })).status, 400);
  assert.equal((await ask('POST', VENUE, '{not json')).status, 400);
  // A paired browser may read FirstPass stats but never sends a game's events.
  who.sender = '';
  assert.equal((await ask('POST', VENUE, { gameId: GAME, events: [{}] })).status, 403);
  assert.equal(stats.took.length, before);
  assert.equal((await ask('DELETE', VENUE)).status, 404);
  assert.equal((await ask('GET', '/api/firstpass/venue/other')).status, 404);
});

test('Vision reads the events after a seq, at once or as soon as one arrives', async t => {
  const stats = standIn();
  const { ask } = await serve(t, stats, { sender: 'phone-1' });
  stats.add(4);
  const got = await ask('GET', `${VENUE}?game=${GAME}&after=2`);
  assert.equal(got.status, 200);
  assert.deepEqual([got.json.events.map((e: { seq: number }) => e.seq), got.json.throughSeq], [[3, 4], 4]);
  // Nothing new and no wait: answered straight away, empty.
  assert.deepEqual((await ask('GET', `${VENUE}?game=${GAME}&after=4`)).json.events, []);
  // Waiting: answered when the next event arrives, long before the wait ends.
  const started = Date.now();
  const waiting = ask('GET', `${VENUE}?game=${GAME}&after=4&wait=20`);
  setTimeout(() => stats.add(1), 150);
  const woke = await waiting;
  assert.deepEqual(woke.json.events.map((e: { seq: number }) => e.seq), [5]);
  assert.ok(Date.now() - started < 5000, 'it didn\'t wait the 20 seconds out');
  assert.equal(stats.listeners.size, 0, 'and stopped listening');
  // The wait ends with nothing new: an empty answer, not an error.
  const timed = await ask('GET', `${VENUE}?game=${GAME}&after=5&wait=0.2`);
  assert.deepEqual([timed.status, timed.json.events], [200, []]);
  // Another game, or junk: 404, with nothing about the game followed.
  const none = await ask('GET', `${VENUE}?game=7d2e1c44-90ab-4cde-8f01-23456789abcd&after=0&wait=20`);
  assert.deepEqual([none.status, none.json.reason], [404, 'not-followed']);
  assert.equal((await ask('GET', `${VENUE}?game=nonsense`)).status, 404);
});

test('in Studio: this Mac may ask, nothing is followed while signed out, and a FirstPass app pairs like any device', async t => {
  const studio = await startStudio(t, { env: { STUDIO_KEYCHAIN: '0' } });
  const sent = await studio.request('POST', VENUE, { gameId: GAME, events: [] });
  assert.deepEqual([sent.status, sent.json.reason], [409, 'not-followed']);
  assert.equal((await studio.request('GET', `${VENUE}?game=${GAME}&after=0`)).status, 404);
  assert.equal((await studio.get('/api/firstpass/status')).following, false);
  // Asking as a FirstPass app (on the Mac itself here; from another device only over the secure link).
  const asked = (await studio.request('POST', '/api/pair', { name: 'Court 1 tablet', firstpass: true })).json;
  assert.equal((await studio.get('/api/devices')).asking.stats, true);
  await studio.post(`/api/devices/requests/${asked.id}/allow`);
  const got = (await studio.request('GET', `/api/pair/${asked.id}`, undefined, { 'x-studio-pair': asked.token })).json;
  assert.equal(got.status, 'allowed');
  assert.ok(got.key);
  const listed = (await studio.get('/api/devices')).devices.find((d: { id: string }) => d.id === got.device);
  assert.equal(listed.kind, 'stats');
  // Its key presses no Stream Deck link.
  assert.equal((await fetch(`${studio.base}/k/${got.key}/deck/scores/home/+1`)).status, 403);
  // With the key in its header the venue link answers (here from this Mac, which may anyway).
  assert.equal((await studio.request('POST', VENUE, { gameId: GAME, events: [] }, { 'x-studio-key': got.key })).status, 409);
  assert.match(studio.log(), /Court 1 tablet at .* asks to use the venue link/);
  assert.match(studio.log(), /allowed to use the venue link/);
});
