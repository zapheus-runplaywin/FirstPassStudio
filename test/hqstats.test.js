// Reading the FirstPass stats of the game on the scoreboard from its club's HQ (hqstats.ts): matched by PlayHQ game id,
// caught up page by page with studio_live, the line-up with may_publish from studio_lineup, then followed on the game's
// Realtime channel, a gap or a dropped channel filled by another catch-up; kept in firstpass.ts's store only, and
// dropped when the club is signed out. A stand-in HQ answers the calls; the channel is a stand-in too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hqstats = require('../out/hqstats');
const firstpass = require('../out/firstpass');
const { startStudio } = require('./support/studio.mts');

const GAME = '0b6c8f8e-3f7a-4d1e-9a51-2a7c1d9e4b10';
const OTHER = '7d2e1c44-90ab-4cde-8f01-23456789abcd';
const CLUB = { code: 'THUNDER', name: 'West Coast Thunder', supabaseUrl: 'https://hq.example', anonKey: 'anon' };
const event = (seq, extra = {}) => ({ id: `e${seq}`, gameId: GAME, stream: 'primary', seq, type: 'goal', payload: { athleteId: 'a1' }, recordedAt: '2026-11-13T09:00:00Z', ...extra });

// The club's HQ: games, events (1..n), an optional snapshot, and the line-up. calls lists each function called.
function standIn() {
  const hq = {
    signedIn: true, events: [], snapshot: null, calls: [], status: 'live',
    games: [{ id: GAME, playhq_game_id: '123456', status: 'live', team_id: 't', team_name: 'Thunder 17U', config: {}, created_at: '', finished_at: null },
      { id: OTHER, playhq_game_id: '', status: 'live', team_name: 'Scratch', finished_at: null }],
    lineup: [{ profile_id: 'a1', name: 'Ava Smith', selection: 'final', may_publish: true }, { profile_id: 'a2', name: 'Junior Jones', selection: 'final', may_publish: false }],
  };
  hq.add = n => { for (let i = 0; i < n; i++) hq.events.push(event(hq.events.length + 1)); };
  hq.fetch = async (url, init) => {
    const name = url.split('/rpc/')[1];
    const args = JSON.parse(init.body);
    assert.equal(init.headers.authorization, 'Bearer access-token');
    hq.calls.push(name === 'studio_live' ? `${name}(${args.p_after_seq})` : name);
    const json = j => ({ ok: true, status: 200, json: async () => j });
    if (name === 'studio_games') return json(hq.games);
    if (name === 'studio_lineup') return json(hq.lineup);
    if (name === 'studio_live') {
      let from = args.p_after_seq;
      const snap = hq.snapshot && hq.snapshot.throughSeq > from ? hq.snapshot : null;
      if (snap) from = snap.throughSeq;
      const after = hq.events.filter(e => e.seq > from);
      return json({ game: { ...hq.games[0], status: hq.status }, snapshot: snap, events: after.slice(0, 1000), more: after.length > 1000 });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  hq.auth = {
    list: () => [{ code: 'THUNDER', state: hq.signedIn ? 'signed-in' : 'signed-out' }],
    club: code => (code === 'THUNDER' ? CLUB : null),
    accessToken: async () => (hq.signedIn ? 'access-token' : ''),
  };
  // The Realtime channel: send(e) delivers an event, setLive(true|false) joins or drops it.
  hq.channels = [];
  hq.subscribe = (club, gameId, token, onEvent, onStatus) => {
    const ch = { club, gameId, token, onEvent, onStatus, closed: false, tokens: [token] };
    hq.channels.push(ch);
    return { close: () => { ch.closed = true; }, setToken: t => ch.tokens.push(t) };
  };
  return hq;
}

function setup(t, hq = standIn()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-stats-'));
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const store = firstpass.create({ log, dir });
  const clock = { t: Date.parse('2026-11-13T09:00:00Z') };
  const stats = hqstats.create({ log, store, hq: hq.auth, fetch: hq.fetch, subscribe: hq.subscribe, now: () => clock.t });
  t.after(() => stats.stop());
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
  const kept = store.read('THUNDER', GAME);
  assert.equal(kept.data.events.length, 1500);
  assert.deepEqual(kept.data.lineup.map(a => [a.name, a.mayPublish]), [['Ava Smith', true], ['Junior Jones', false]]);
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
  const c = stats.current();
  assert.equal(c.snapshot.throughSeq, 30);
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
  assert.equal(stats.current().events.length, 8);
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
