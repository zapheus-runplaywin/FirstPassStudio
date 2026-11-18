// FirstPass Studio - reading the FirstPass stats of the game on the scoreboard from its club's FirstPass HQ.
//
// Signed in to a club (hqauth.ts), Studio can read the club's live and finished games that have a PlayHQ game id
// (HQ's Studio role; FirstPassHQ PR #209). Every few seconds follow(playhqGameId) is told which game the scoreboard is
// on; while it's one a signed-in club recorded:
//
//   1. It is matched by PlayHQ game id in the club's studio_games() (read again every GAMES_EVERY).
//   2. Catch-up: studio_live(game, after_seq) gives the game's header, the latest break snapshot after that seq and
//      up to 1000 events after it, oldest first, with more: true while there are more; it's called until more is
//      false. studio_lineup(game) gives each athlete's name and may_publish (shown by name with their own stats only
//      when true; team totals otherwise, which the graphics enforce).
//   3. Live: the game's private Realtime topic game:<id> sends each new primary event (as 'event'). An event that
//      follows on is kept; a gap (one missed while reconnecting) is filled by another catch-up. A catch-up also runs
//      every CATCH_UP_EVERY while following, and whenever the channel comes back, so nothing is missed for long.
//   4. The helper statistician: a game may have a second statistician whose substitutions and corrections count
//      (FirstPassHQ PR #223). They are on a stream of the helper's own (helper:<user id>), numbered from 1. Every
//      studio_live answer carries all of them as helperEvents (there are few), and the same topic sends each new one.
//      They are held beside the primary events, and firstpassfigures.ts merges the two exactly as Vantage and Vision
//      do. A helper event that doesn't follow on from the ones held of its stream is filled by another catch-up.
//
// Revocation: every catch-up first checks the Studio role again (hqauth.ts checkRole()), so a role removed or paused in
// HQ, or a member stood down or deleted, stops Studio within a minute, not at the next half-hourly refresh. Whenever HQ
// refuses one of these calls (an answer of 400 to 499 but 408 and 429), Studio stops following the game at once, drops
// what it held of it from memory and from the store, and checks the role: when the role is gone the club is signed out
// and all its stats deleted; when only the game is refused (no longer a live or finished PlayHQ game) just that game
// goes. When HQ can't be reached nothing is dropped and the next look tries again.
//
// What is kept goes in firstpass.ts's store (this Mac only, deleted 30 days after the game or at sign-out): { game,
// snapshot, events, lineup }. Nothing here is logged but club codes, ids and counts. Nothing goes into the board, the
// scene or a game story: the graphics will ask for only the figures they show (private routes, /api/firstpass/...).
//
// create(deps). deps:
//   log, store          the debug log, firstpass.ts's store
//   hq                  hqauth.ts: club(code), list(), accessToken(code), checkRole(code)
//   fetch               for tests
//   subscribe           opens the Realtime channel (realtimeSubscribe(), or a stand-in for tests)

import { RealtimeClient } from '@supabase/realtime-js';
import { isHelperStream } from '@firstpass/engine';
import { HELPER_EVENT_TYPES } from '@firstpass/schema';
import { errorMessage } from './errors';
import { arr, obj, str } from './check';
import { privateLog, validGame } from './firstpass';
import type { Store } from './firstpass';
import type { Club, HqAuth } from './hqauth';
import type { Log } from './types';

const GAMES_EVERY = 60 * 1000;
const CATCH_UP_EVERY = 60 * 1000;
const MAX_PAGES = 50; // 50,000 events: far more than any game, so a bad answer can't loop for ever

interface HqEvent { id: string; gameId: string; stream: string; seq: number; type: string; payload: unknown; recordedAt: string }
interface HqGame { id: string; playhqGameId: string; status: string; teamName: string; config: unknown; finishedAt: string | null }
interface Athlete { profileId: string; name: string; selection: string; mayPublish: boolean }
interface Snapshot { throughSeq: number; engineVersion: string; state: unknown; createdAt: string }
interface Following {
  club: string; game: HqGame; snapshot: Snapshot | null; events: HqEvent[]; helper: HqEvent[]; lineup: Athlete[];
  live: boolean; lastCatchUp: number; catchingUp: Promise<void> | null;
}
// Opens game:<id> for a club: calls onEvent for each event and onStatus(true|false) as the channel joins or drops.
// Gives back a function that closes it and one that hands it a fresh access token.
type Subscribe = (club: Club, gameId: string, token: string, onEvent: (e: unknown) => void, onStatus: (live: boolean) => void)
  => { close: () => void; setToken: (token: string) => void };

const toEvent = (v: unknown): HqEvent | null => {
  const o = obj(v);
  const seq = Number(o.seq);
  if (!Number.isInteger(seq) || seq < 1 || o.stream !== 'primary') return null;
  return { id: str(o.id), gameId: str(o.gameId), stream: 'primary', seq, type: str(o.type), payload: o.payload ?? null, recordedAt: str(o.recordedAt) };
};
// A helper statistician's event: on a helper stream, and only what a helper may record (substitutions and corrections).
const helperTypes: readonly string[] = HELPER_EVENT_TYPES;
const toHelperEvent = (v: unknown): HqEvent | null => {
  const o = obj(v);
  const seq = Number(o.seq), stream = str(o.stream), type = str(o.type);
  if (!Number.isInteger(seq) || seq < 1 || !isHelperStream(stream) || !helperTypes.includes(type)) return null;
  if (!str(o.id) || Number.isNaN(Date.parse(str(o.recordedAt)))) return null;
  return { id: str(o.id), gameId: str(o.gameId), stream, seq, type, payload: o.payload ?? null, recordedAt: str(o.recordedAt) };
};
const toGame = (v: unknown): HqGame | null => {
  const o = obj(v);
  if (!validGame(o.id)) return null;
  return { id: str(o.id), playhqGameId: str(o.playhq_game_id).trim(), status: str(o.status), teamName: str(o.team_name), config: o.config ?? null, finishedAt: typeof o.finished_at === 'string' ? o.finished_at : null };
};

// The real channel, through Supabase's Realtime client: a private broadcast channel, so HQ's row level security on
// realtime.messages decides (the Studio role, live and final PlayHQ games only).
const realtimeSubscribe: Subscribe = (club, gameId, token, onEvent, onStatus) => {
  const client = new RealtimeClient(`${club.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: club.anonKey } });
  client.setAuth(token);
  const channel = client.channel(`game:${gameId}`, { config: { private: true } });
  channel.on('broadcast', { event: 'event' }, (msg: { payload?: unknown }) => onEvent(msg.payload));
  channel.subscribe(status => onStatus(status === 'SUBSCRIBED'));
  return {
    close: () => { channel.unsubscribe().catch(() => {}); client.disconnect(); },
    setToken: t => { client.setAuth(t); },
  };
};

function create({ log: rawLog, store, hq, fetch = globalThis.fetch, subscribe = realtimeSubscribe, now = () => Date.now() }: {
  log: Log; store: Pick<Store, 'save' | 'forgetGame'>; hq: Pick<HqAuth, 'club' | 'list' | 'accessToken' | 'checkRole'>;
  fetch?: typeof globalThis.fetch; subscribe?: Subscribe; now?: () => number;
}) {
  const log = privateLog(rawLog);
  const gameLists = new Map<string, { at: number; games: HqGame[] }>();
  let following: Following | null = null;
  let wanted: string | null = null;
  let channel: ReturnType<Subscribe> | null = null;

  // A call to one of HQ's functions as the signed-in person: { json }, or { refused } with HQ's answer when HQ said no
  // (400 to 499 but 408 and 429, as hqauth.ts counts them), or null (not signed in, or HQ couldn't be reached).
  type Got = { json: unknown } | { refused: number } | null;
  async function rpc(club: Club, name: string, args: Record<string, unknown>): Promise<Got> {
    const token = await hq.accessToken(club.code);
    if (!token) return null;
    try {
      const res = await fetch(`${club.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', body: JSON.stringify(args), signal: AbortSignal.timeout(20000),
        headers: { apikey: club.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
      if (!res.ok) {
        log('warn', 'hq', `${club.code}: ${name} answered ${res.status}`);
        return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 ? { refused: res.status } : null;
      }
      return { json: await res.json() };
    } catch (err) {
      log('warn', 'hq', `${club.code}: ${name} failed (${errorMessage(err)})`);
      return null;
    }
  }
  const refusal = (got: Got): number => (got && 'refused' in got ? got.refused : 0);

  // A signed-in club's games Studio can read, read again every GAMES_EVERY.
  async function games(club: Club): Promise<HqGame[]> {
    const had = gameLists.get(club.code);
    if (had && now() - had.at < GAMES_EVERY) return had.games;
    const got = await rpc(club, 'studio_games', {});
    // Refused: nothing from the old list is used, and the role is checked (hqauth.ts signs the club out if it's gone).
    if (refusal(got)) { gameLists.delete(club.code); await hq.checkRole(club.code); return []; }
    if (!got || !('json' in got)) return had ? had.games : [];
    const list = arr(got.json).map(toGame).filter((g): g is HqGame => !!g && !!g.playhqGameId);
    gameLists.set(club.code, { at: now(), games: list });
    return list;
  }

  // The signed-in club and its game for a PlayHQ game id, or null.
  async function match(playhqGameId: string): Promise<{ club: Club; game: HqGame } | null> {
    for (const c of hq.list()) {
      if (c.state !== 'signed-in') continue;
      const club = hq.club(c.code);
      if (!club) continue;
      const game = (await games(club)).find(g => g.playhqGameId === playhqGameId);
      if (game) return { club, game };
    }
    return null;
  }

  const lastSeq = (f: Following) => (f.events.length ? f.events[f.events.length - 1].seq : f.snapshot?.throughSeq || 0);
  const keep = (f: Following) => store.save(f.club, f.game.id, { game: f.game, snapshot: f.snapshot, events: f.events, helper: f.helper, lineup: f.lineup }, { finishedAt: f.game.finishedAt });

  // Adds events in seq order, dropping ones already held. false when one doesn't follow on (a gap).
  function add(f: Following, list: HqEvent[]): boolean {
    let gap = false;
    for (const e of list.sort((a, b) => a.seq - b.seq)) {
      const last = lastSeq(f);
      if (e.seq <= last) continue;
      if (e.seq !== last + 1) { gap = true; break; }
      f.events.push(e);
    }
    return !gap;
  }

  // Adds helper events not already held (by stream and seq), keeping them in stream and seq order. { added } is how
  // many were new; gap: one of them doesn't follow on from the ones held of its stream (another catch-up fills it).
  function addHelper(f: Following, list: HqEvent[]): { added: number; gap: boolean } {
    const held = new Set(f.helper.map(e => `${e.stream} ${e.seq}`));
    let added = 0, gap = false;
    for (const e of list) {
      if (held.has(`${e.stream} ${e.seq}`)) continue;
      held.add(`${e.stream} ${e.seq}`);
      f.helper.push(e);
      added++;
    }
    if (added) {
      f.helper.sort((a, b) => (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.seq - b.seq));
      gap = list.some(e => e.seq > 1 && !held.has(`${e.stream} ${e.seq - 1}`));
    }
    return { added, gap };
  }

  // HQ refused Studio the game f follows (status), or the role is gone: stop following it at once, so nothing held is
  // served, delete it from the store, and check the role (hqauth.ts signs the club out and deletes all its stats when
  // the role is gone). roleGone: the role check already said so.
  async function drop(f: Following, why: string, roleGone = false) {
    if (following === f) stop();
    gameLists.delete(f.club);
    f.events = []; f.helper = []; f.snapshot = null; f.lineup = [];
    store.forgetGame(f.club, f.game.id, why);
    log('info', 'hq', `${f.club}: ${why}; stopped following game ${f.game.id} and dropped its FirstPass stats`);
    if (!roleGone) await hq.checkRole(f.club);
  }

  // Checks the role, then reads everything after what is held, page by page, and the line-up.
  function catchUp(f: Following): Promise<void> {
    if (f.catchingUp) return f.catchingUp;
    f.catchingUp = (async () => {
      const club = hq.club(f.club);
      if (!club) return;
      // The role first, every time: once it's gone nothing more is read or kept, and what is held goes.
      if (await hq.checkRole(f.club) === 'gone') { await drop(f, 'the Studio role is gone in HQ', true); return; }
      if (following !== f) return;
      let pages = 0, got = 0, helped = 0;
      while (pages++ < MAX_PAGES && following === f) {
        const answer = await rpc(club, 'studio_live', { p_game_id: f.game.id, p_after_seq: lastSeq(f) });
        if (refusal(answer)) { await drop(f, `HQ refused studio_live (${refusal(answer)})`); return; }
        const live = obj(answer && 'json' in answer ? answer.json : null);
        if (!live.game && !live.events) return;
        const header = toGame(live.game);
        if (header) f.game = { ...header, playhqGameId: header.playhqGameId || f.game.playhqGameId };
        const snap = obj(live.snapshot);
        if (Number(snap.throughSeq) > lastSeq(f)) {
          // A newer snapshot covers every event before it; the events after it follow in this answer.
          f.snapshot = { throughSeq: Number(snap.throughSeq), engineVersion: str(snap.engineVersion), state: snap.state ?? null, createdAt: str(snap.createdAt) };
          f.events = [];
        }
        const list = arr(live.events).map(toEvent).filter((e): e is HqEvent => !!e);
        got += list.length;
        add(f, list);
        // Every helper event so far comes with each answer (an HQ from before the helper sends none).
        helped += addHelper(f, arr(live.helperEvents).map(toHelperEvent).filter((e): e is HqEvent => !!e)).added;
        if (live.more !== true) break;
      }
      if (following !== f) return;
      const lineup = await rpc(club, 'studio_lineup', { p_game_id: f.game.id });
      if (refusal(lineup)) { await drop(f, `HQ refused studio_lineup (${refusal(lineup)})`); return; }
      if (lineup && 'json' in lineup) {
        f.lineup = arr(lineup.json).map(a => { const o = obj(a); return { profileId: str(o.profile_id), name: str(o.name), selection: str(o.selection), mayPublish: o.may_publish === true }; });
      }
      f.lastCatchUp = now();
      if (following === f) keep(f);
      log('info', 'hq', `${f.club} game ${f.game.id}: caught up to seq ${lastSeq(f)} (${got} new event(s), ${helped ? `${helped} new from a helper, ` : ''}${f.lineup.length} in the line-up)`);
    })().catch(err => log('error', 'hq', `${f.club}: catching up failed: ${errorMessage(err)}`)).finally(() => { f.catchingUp = null; });
    return f.catchingUp;
  }

  function stop() {
    if (channel) channel.close();
    channel = null;
    following = null;
  }

  // The game on the scoreboard (its PlayHQ game id, or null). Called every few seconds; cheap when nothing changed.
  async function follow(playhqGameId: string | null): Promise<void> {
    wanted = playhqGameId || null;
    const f = following;
    // Still the same game and still signed in: catch up now and then, and keep the channel's token fresh.
    if (f && wanted === f.game.playhqGameId) {
      const token = await hq.accessToken(f.club);
      if (!token) { log('info', 'hq', `${f.club}: no longer signed in; stopped following game ${f.game.id}`); stop(); return; }
      if (channel) channel.setToken(token);
      if (now() - f.lastCatchUp >= CATCH_UP_EVERY) await catchUp(f);
      return;
    }
    if (f) stop();
    if (!wanted) return;
    const found = await match(wanted);
    if (!found || wanted !== playhqGameId || following) return;
    const nf: Following = { club: found.club.code, game: found.game, snapshot: null, events: [], helper: [], lineup: [], live: false, lastCatchUp: 0, catchingUp: null };
    following = nf;
    log('info', 'hq', `${nf.club}: following game ${nf.game.id} (PlayHQ ${wanted})`);
    await catchUp(nf);
    if (following !== nf) return;
    const token = await hq.accessToken(nf.club);
    if (!token) { stop(); return; }
    channel = subscribe(found.club, nf.game.id, token,
      e => {
        if (following !== nf) return;
        const ev = toEvent(e);
        if (ev) { if (add(nf, [ev])) keep(nf); else catchUp(nf); return; }
        const help = toHelperEvent(e);
        if (!help) return;
        const { added, gap } = addHelper(nf, [help]);
        if (added) keep(nf);
        if (gap) catchUp(nf);
      },
      live => {
        if (following !== nf) return;
        const was = nf.live;
        nf.live = live;
        if (live && !was) catchUp(nf); // back after a drop: fill anything missed meanwhile
        if (was !== live) log(live ? 'info' : 'warn', 'hq', `${nf.club} game ${nf.game.id}: live channel ${live ? 'joined' : 'dropped'}`);
      });
  }

  // What is being followed, for the status board: counts and ids only.
  function status() {
    const f = following;
    if (!f) return { following: false as const };
    return { following: true as const, club: f.club, gameId: f.game.id, playhqGameId: f.game.playhqGameId, status: f.game.status, live: f.live,
      events: f.events.length, helperEvents: f.helper.length, throughSeq: lastSeq(f), snapshot: !!f.snapshot, lineup: f.lineup.length };
  }

  // What is held for the game being followed (the private routes and the graphics use it), or null.
  function current() {
    const f = following;
    return f ? { club: f.club, game: f.game, snapshot: f.snapshot, events: f.events, helper: f.helper, lineup: f.lineup } : null;
  }

  // A club signed out: stop following its game at once.
  function signedOut(code: string) { if (following && following.club === code) stop(); gameLists.delete(code); }

  return { follow, status, current, signedOut, stop };
}

type HqStats = ReturnType<typeof create>;
export type { HqEvent, HqGame, Athlete, Snapshot, Subscribe, HqStats };
export { create, realtimeSubscribe, GAMES_EVERY, CATCH_UP_EVERY };
