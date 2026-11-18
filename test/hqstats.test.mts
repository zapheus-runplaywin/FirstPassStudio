// Reading the FirstPass stats of the game on the scoreboard from its club's HQ (hqstats.ts): matched by PlayHQ game id,
// caught up page by page with studio_live, the line-up with may_publish from studio_lineup, then followed on the game's
// Realtime channel, a gap or a dropped channel filled by another catch-up; kept in firstpass.ts's store only, and
// dropped when the club is signed out. The role is checked on every catch-up, and anything HQ refuses (the role gone,
// or the game no longer one Studio may read) stops Studio serving what it held at once. A stand-in HQ answers the
// calls; the channel is a stand-in too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hqstats from '../out/hqstats.js';
import * as firstpass from '../out/firstpass.js';
import { startStudio, type Json } from './support/studio.mts';
import type { TestContext } from 'node:test';

const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const OTHER = '7d2e1c44-90ab-4cde-8f01-23456789abcd';
const CLUB = { code: 'THUNDER', name: 'West Coast Thunder', supabaseUrl: 'https://hq.example', anonKey: 'anon' };
const event = (seq: number, extra = {}) => ({ id: `e${seq}`, gameId: GAME, stream: 'primary', seq, type: 'goal', payload: { athleteId: 'a1' }, recordedAt: '2026-11-13T09:00:00Z', ...extra });

// The club's HQ: games, events (1..n), an optional snapshot, and the line-up. calls lists each function called.
function standIn() {
  const hq = {
    signedIn: true, events: [] as ReturnType<typeof event>[], calls: [] as string[], status: 'live',
    // The helper statistician's events (every one comes with each studio_live answer); undefined: an HQ from before the helper.
    helper: [] as Json[] | undefined,
    // What hqauth's checkRole() answers, how often it was asked, and HQ's answer to a function it refuses (403, as
    // HQ's studio_live and studio_lineup answer with errcode 42501).
    role: 'yes' as 'yes' | 'gone' | 'unreachable', roleChecks: 0, refuse: {} as Record<string, number>, down: false,
    // What checkRole() did when the role was gone: hqauth signs the club out, which calls signedOut on hqstats.
    onGone: () => {},
    snapshot: null as { throughSeq: number; engineVersion: string; state: unknown; createdAt: string } | null,
    // The Realtime channel: send(e) delivers an event, setLive(true|false) joins or drops it.
    channels: [] as Json[],
    games: [{ id: GAME, playhq_game_id: '123456', status: 'live', team_id: 't', team_name: 'Thunder 17U', config: {}, created_at: '', finished_at: null },
      { id: OTHER, playhq_game_id: '', status: 'live', team_name: 'Scratch', finished_at: null }],
    lineup: [{ profile_id: 'a1', name: 'Ava Smith', selection: 'final', may_publish: true }, { profile_id: 'a2', name: 'Junior Jones', selection: 'final', may_publish: false }],
  };
  const add = (n: number) => { for (let i = 0; i < n; i++) hq.events.push(event(hq.events.length + 1)); };
  const fetch = async (url: string, init: Json) => {
    const name = url.split('/rpc/')[1];
    const args = JSON.parse(init.body);
    assert.equal(init.headers.authorization, 'Bearer access-token');
    hq.calls.push(name === 'studio_live' ? `${name}(${args.p_after_seq})` : name);
    if (hq.down) throw new Error('fetch failed');
    if (hq.refuse[name]) return { ok: false, status: hq.refuse[name], json: async () => ({ code: '42501', message: 'Studio can only read live and finished PlayHQ games' }) };
    const json = (j: Json) => ({ ok: true, status: 200, json: async () => j });
    if (name === 'studio_games') return json(hq.games);
    if (name === 'studio_lineup') return json(hq.lineup);
    if (name === 'studio_live') {
      let from = args.p_after_seq;
      const snap = hq.snapshot && hq.snapshot.throughSeq > from ? hq.snapshot : null;
      if (snap) from = snap.throughSeq;
      const after = hq.events.filter(e => e.seq > from);
      return json({ game: { ...hq.games[0], status: hq.status }, snapshot: snap, events: after.slice(0, 1000), ...(hq.helper ? { helperEvents: hq.helper } : {}), more: after.length > 1000 });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const auth = {
    list: () => [{ code: 'THUNDER', state: hq.signedIn ? 'signed-in' : 'signed-out' }],
    club: (code: Json) => (code === 'THUNDER' ? CLUB : null),
    accessToken: async () => (hq.signedIn ? 'access-token' : ''),
    checkRole: async () => {
      hq.roleChecks++;
      if (hq.role === 'gone' && hq.signedIn) { hq.signedIn = false; hq.onGone(); }
      return hq.role;
    },
  };
  const subscribe = (club: Json, gameId: string, token: string, onEvent: Json, onStatus: Json) => {
    const ch = { club, gameId, token, onEvent, onStatus, closed: false, tokens: [token] };
    hq.channels.push(ch);
    return { close: () => { ch.closed = true; }, setToken: (t: string) => ch.tokens.push(t) };
  };
  // fetch and auth: as much of the browser's fetch and of hqauth as hqstats reads.
  return Object.assign(hq, { add, fetch: fetch as unknown as typeof globalThis.fetch, auth: auth as unknown as Parameters<typeof hqstats.create>[0]['hq'], subscribe });
}

function setup(t: TestContext, hq = standIn()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-stats-'));
  const lines: string[] = [];
  const log = (...a: unknown[]) => lines.push(a.join(' '));
  const store = firstpass.create({ log, dir });
  const clock = { t: Date.parse('2026-11-13T09:00:00Z') };
  const stats = hqstats.create({ log, store, hq: hq.auth, fetch: hq.fetch, subscribe: hq.subscribe, now: () => clock.t });
  t.after(() => stats.stop());
  // As hqauth.ts does when checkRole() finds the role gone: the club is signed out, its stats deleted, and hqstats told.
  hq.onGone = () => { store.forget('THUNDER', 'role gone'); stats.signedOut('THUNDER'); };
  const settle = () => new Promise(r => setTimeout(r, 30));
  return { hq, dir, lines, store, stats, clock, settle };
}

test('the scoreboard\'s game is matched by PlayHQ game id, caught up page by page, and its line-up read', async t => {
  const { hq, store, stats, lines } = setup(t);
  hq.add(1500);
  await stats.follow('123456');
  assert.deepEqual(hq.calls, ['studio_games', 'studio_live(0)', 'studio_live(1000)', 'studio_lineup']);
  const s = stats.status();
  assert.equal(s.following, true);
  assert.equal(s.gameId, GAME);
  assert.equal(s.events, 1500);
  assert.equal(s.throughSeq, 1500);
  assert.equal(s.lineup, 2);
  const kept = store.read('THUNDER', GAME)! as { data: Json };
  assert.equal(kept.data.events.length, 1500);
  assert.deepEqual(kept.data.lineup.map((a: Json) => [a.name, a.mayPublish]), [['Ava Smith', true], ['Junior Jones', false]]);
  assert.equal(hq.channels.length, 1);
  assert.equal(hq.channels[0].gameId, GAME);
  // Counts and ids only in the log: never a name or an event's contents.
  assert.doesNotMatch(lines.join('\n'), /Ava Smith|Junior|athleteId|access-token/);
  assert.match(lines.join('\n'), /caught up to seq 1500 \(1500 new event\(s\), 2 in the line-up\)/);
});

test('a newer break snapshot covers the events before it', async t => {
  const { hq, stats } = setup(t);
  hq.add(40);
  hq.snapshot = { throughSeq: 30, engineVersion: '1.2.0', state: { home: 12 }, createdAt: '2026-11-13T09:20:00Z' };
  await stats.follow('123456');
  const c = stats.current()!;
  assert.equal(c.snapshot!.throughSeq, 30);
  assert.deepEqual(c.events.map(e => e.seq), [31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
  assert.equal(stats.status().throughSeq, 40);
});

test('live events follow on; a gap, or the channel coming back, is filled by another catch-up', async t => {
  const { hq, stats, settle } = setup(t);
  hq.add(5);
  await stats.follow('123456');
  const ch = hq.channels[0];
  ch.onStatus(true);
  await settle();
  hq.add(1);
  ch.onEvent(hq.events[5]);
  assert.equal(stats.status().throughSeq, 6);
  // Shadow events and junk are ignored.
  ch.onEvent({ ...event(7), stream: 'shadow' });
  ch.onEvent({ nonsense: true });
  assert.equal(stats.status().throughSeq, 6);
  // 7 was missed: 8 arrives, so Studio catches up from 6.
  hq.add(2);
  hq.calls.length = 0;
  ch.onEvent(hq.events[7]);
  await settle();
  assert.ok(hq.calls.includes('studio_live(6)'));
  assert.equal(stats.status().throughSeq, 8);
  // An event already held is dropped.
  ch.onEvent(hq.events[3]);
  assert.equal(stats.current()!.events.length, 8);
  // The channel drops and comes back: anything recorded meanwhile is read.
  ch.onStatus(false);
  assert.equal(stats.status().live, false);
  hq.add(3);
  hq.calls.length = 0;
  ch.onStatus(true);
  await settle();
  assert.ok(hq.calls.includes('studio_live(8)'));
  assert.equal(stats.status().throughSeq, 11);
  assert.equal(stats.status().live, true);
});

const HELPER = 'helper:5f0c1f0e-1111-4222-8333-444455556666';
const help = (seq: number, extra = {}) => ({ id: `h${seq}`, gameId: GAME, stream: HELPER, seq, type: 'lineup_change', payload: { team: 'us', lineup: { GS: 'Ava Smith' } }, recordedAt: `2026-11-13T09:0${seq}:00Z`, ...extra });

test('a helper statistician\'s substitutions and corrections are held beside the primary events, caught up and live', async t => {
  const { hq, store, stats, lines, settle } = setup(t);
  hq.add(5);
  // What HQ holds of the helper so far, with things Studio must never count: another kind of event on the helper's
  // stream, a shadow statistician's event, one with no time, and junk.
  hq.helper = [help(1), help(2, { type: 'correction', payload: { target: 'e3', op: 'delete' } }),
    help(3, { type: 'action' }), { ...help(1), id: 's1', stream: 'shadow:5f0c1f0e-1111-4222-8333-444455556666' }, help(4, { recordedAt: 'never' }), { nonsense: true }];
  await stats.follow('123456');
  assert.deepEqual(stats.current()!.helper.map(e => [e.stream, e.seq, e.type]), [[HELPER, 1, 'lineup_change'], [HELPER, 2, 'correction']]);
  assert.equal(stats.status().helperEvents, 2);
  assert.equal(stats.status().events, 5, 'the primary events are counted on their own');
  assert.equal((store.read('THUNDER', GAME)! as { data: Json }).data.helper.length, 2);
  assert.match(lines.join('\n'), /caught up to seq 5 \(5 new event\(s\), 2 new from a helper, 2 in the line-up\)/);
  assert.doesNotMatch(lines.join('\n'), /Ava Smith/);

  // Live: the next helper event follows on and is kept at once; one already held, a shadow event and another kind are dropped.
  const ch = hq.channels[0];
  ch.onStatus(true);
  await settle();
  hq.calls.length = 0;
  ch.onEvent(help(3));
  ch.onEvent(help(2, { type: 'correction' }));
  ch.onEvent({ ...help(4), stream: 'shadow:5f0c1f0e-1111-4222-8333-444455556666' });
  ch.onEvent(help(4, { type: 'action' }));
  assert.deepEqual(stats.current()!.helper.map(e => e.seq), [1, 2, 3]);
  assert.equal((store.read('THUNDER', GAME)! as { data: Json }).data.helper.length, 3);
  assert.equal(hq.calls.length, 0, 'nothing was missed, so HQ isn\'t asked');
  assert.equal(stats.status().throughSeq, 5, 'a helper event never moves the primary count');

  // 4 was missed: 5 arrives, so Studio catches up and gets both.
  hq.helper = [help(1), help(2, { type: 'correction' }), help(3), help(4), help(5)];
  ch.onEvent(help(5));
  await settle();
  assert.ok(hq.calls.includes('studio_live(5)'));
  assert.deepEqual(stats.current()!.helper.map(e => e.seq), [1, 2, 3, 4, 5]);

  // A second helper stream (another helper took over) is held from its own seq 1, with no catch-up needed.
  hq.calls.length = 0;
  ch.onEvent({ ...help(1), id: 'k1', stream: 'helper:other' });
  await settle();
  assert.equal(hq.calls.length, 0);
  assert.equal(stats.status().helperEvents, 6);
});

test('an HQ from before the helper statistician answers no helper events, and Studio carries on', async t => {
  const { hq, stats } = setup(t);
  hq.add(3);
  hq.helper = undefined;
  await stats.follow('123456');
  assert.deepEqual(stats.current()!.helper, []);
  assert.equal(stats.status().events, 3);
});

test('when HQ refuses the game, the helper\'s events go with the rest', async t => {
  const { hq, stats, clock, store } = setup(t);
  hq.add(2);
  hq.helper = [help(1)];
  await stats.follow('123456');
  assert.equal(stats.status().helperEvents, 1);
  hq.refuse.studio_live = 403;
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current(), null);
  assert.equal(store.read('THUNDER', GAME), null);
});

test('following the same game: a catch-up every minute, and the channel keeps a fresh token', async t => {
  const { hq, stats, clock } = setup(t);
  hq.add(2);
  await stats.follow('123456');
  hq.calls.length = 0;
  await stats.follow('123456');
  assert.deepEqual(hq.calls, [], 'nothing to do 5 seconds on');
  assert.equal(hq.channels[0].tokens.length, 2, 'the token is handed on');
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.deepEqual(hq.calls, ['studio_live(2)', 'studio_lineup']);
});

test('a game no signed-in club recorded, scratch games, and no game at all: nothing is followed', async t => {
  const { hq, stats } = setup(t);
  await stats.follow('999999');
  assert.equal(stats.status().following, false);
  await stats.follow('');
  await stats.follow(null);
  assert.equal(stats.status().following, false);
  assert.equal(hq.calls.filter(c => c === 'studio_games').length, 1, 'the games list is read once a minute, not every look');
  assert.equal(hq.channels.length, 0);
});

test('another game on the scoreboard closes the first one\'s channel; signing out stops at once', async t => {
  const { hq, stats } = setup(t);
  hq.add(3);
  await stats.follow('123456');
  await stats.follow('999999');
  assert.equal(hq.channels[0].closed, true);
  assert.equal(stats.status().following, false);
  await stats.follow('123456');
  assert.equal(hq.channels.length, 2);
  stats.signedOut('THUNDER');
  assert.equal(hq.channels[1].closed, true);
  assert.equal(stats.current(), null);
  // Signed out at HQ's end (the token is gone): the next look stops too.
  await stats.follow('123456');
  hq.signedIn = false;
  await stats.follow('123456');
  assert.equal(stats.status().following, false);
});

test('the role is checked again on every catch-up, once a minute, not only at the half-hourly refresh', async t => {
  const { hq, stats, clock } = setup(t);
  hq.add(2);
  await stats.follow('123456');
  assert.equal(hq.roleChecks, 1, 'checked before the first catch-up');
  await stats.follow('123456');
  assert.equal(hq.roleChecks, 1, 'not on every look, 5 seconds apart');
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(hq.roleChecks, 2);
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(hq.roleChecks, 3);
});

test('the role gone in HQ: the next catch-up stops serving the game at once and deletes what was held', async t => {
  const { hq, stats, store, clock, dir } = setup(t);
  hq.add(3);
  await stats.follow('123456');
  assert.ok(store.read('THUNDER', GAME));
  assert.equal(stats.current()!.events.length, 3);
  // Removed, paused or stood down in HQ: Studio learns it at the next catch-up, within a minute.
  hq.role = 'gone';
  hq.calls.length = 0;
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current(), null, 'nothing is served');
  assert.equal(stats.status().following, false);
  assert.equal(hq.channels[0].closed, true);
  assert.equal(store.read('THUNDER', GAME), null);
  assert.equal(fs.existsSync(path.join(dir, 'THUNDER')), false);
  assert.deepEqual(hq.calls, [], 'nothing more is read from HQ once the role is gone');
  // And nothing comes back on the next looks.
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current(), null);
});

for (const name of ['studio_live', 'studio_lineup']) {
  test(`HQ refusing ${name} with the role gone: Studio drops the game at once, checks the role, and the club is signed out`, async t => {
    const { hq, stats, store, clock, lines } = setup(t);
    hq.add(3);
    await stats.follow('123456');
    // HQ's answer reaches Studio before the role check would say so (the role check passed a moment earlier).
    hq.refuse[name] = 403;
    const checks = hq.roleChecks;
    let roleAsked = false;
    hq.onGone = () => { roleAsked = true; store.forget('THUNDER', 'role gone'); stats.signedOut('THUNDER'); };
    const check = hq.auth.checkRole;
    let first = true;
    hq.auth.checkRole = async (code: string) => { if (first) { first = false; hq.roleChecks++; return 'yes'; } hq.role = 'gone'; return check(code); };
    clock.t += hqstats.CATCH_UP_EVERY;
    await stats.follow('123456');
    assert.equal(stats.current(), null);
    assert.equal(store.read('THUNDER', GAME), null);
    assert.equal(hq.roleChecks, checks + 2, 'the role is checked again after the refusal');
    assert.equal(roleAsked, true, 'the role gone signs the club out');
    assert.equal(hq.channels[0].closed, true);
    assert.match(lines.join('\n'), new RegExp(`HQ refused ${name} \\(403\\)`));
  });
}

test('HQ refusing a game while the role is still there: only that game is dropped, and the club stays signed in', async t => {
  const { hq, stats, store, clock } = setup(t);
  hq.add(3);
  await stats.follow('123456');
  store.save('THUNDER', OTHER, { other: true });
  // The game is no longer a live or finished PlayHQ game (its PlayHQ id taken off, or set back to draft).
  hq.refuse.studio_live = 403;
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current(), null);
  assert.equal(store.read('THUNDER', GAME), null);
  assert.ok(store.read('THUNDER', OTHER), 'the club\'s other games stay');
  assert.equal(hq.signedIn, true);
  // The old games list isn't used again: HQ is asked afresh, and the game is followed again once HQ allows it.
  delete hq.refuse.studio_live;
  hq.calls.length = 0;
  await stats.follow('123456');
  assert.equal(hq.calls[0], 'studio_games');
  assert.equal(stats.current()!.events.length, 3);
});

test('HQ refusing the games list checks the role and doesn\'t use the old list', async t => {
  const { hq, stats, clock } = setup(t);
  await stats.follow('999999');
  hq.refuse.studio_games = 401;
  hq.role = 'gone';
  clock.t += hqstats.GAMES_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current(), null);
  assert.equal(hq.roleChecks, 1);
  assert.equal(hq.signedIn, false);
});

test('HQ out of reach, for the role check or a catch-up, keeps what is held and tries again', async t => {
  const { hq, stats, store, clock } = setup(t);
  hq.add(3);
  await stats.follow('123456');
  hq.role = 'unreachable';
  hq.down = true;
  clock.t += hqstats.CATCH_UP_EVERY;
  await stats.follow('123456');
  assert.equal(stats.current()!.events.length, 3);
  assert.ok(store.read('THUNDER', GAME));
  // A 500 or a 429 isn't a refusal either.
  hq.down = false;
  for (const status of [500, 429, 408]) {
    hq.refuse.studio_live = status;
    await stats.follow('123456');
    assert.equal(stats.current()!.events.length, 3, `${status} keeps what is held`);
  }
  delete hq.refuse.studio_live;
  hq.role = 'yes';
  hq.add(1);
  await stats.follow('123456');
  assert.equal(stats.current()!.events.length, 4);
});

test('not signed in to any club: HQ is never asked', async t => {
  const hq = standIn();
  hq.signedIn = false;
  const { stats } = setup(t, hq);
  await stats.follow('123456');
  assert.deepEqual(hq.calls, []);
});

test('Studio answers which game\'s FirstPass stats it follows on this Mac, and nothing while signed out', async t => {
  const studio = await startStudio(t, { env: { STUDIO_KEYCHAIN: '0' } });
  assert.deepEqual(await studio.get('/api/firstpass/status'), { following: false });
});
