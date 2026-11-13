// FirstPass Studio - the FirstPass stats Studio keeps on this Mac, and the rules that keep them private.
//
// Signed in to a club's FirstPass HQ (the architecture doc's "Studio access" tab), Studio reads the club's stats for
// the games it streams: figures about athletes, many of them under 18, that PlayHQ never publishes. They are a class
// of private data of their own (security review re-check, 13 November 2026):
//
//   - Who may read them: this Mac, and browsers allowed in Devices… over the secure link only (access.firstpass(),
//     access.firstpassRefusal()), whatever "Only this Mac can change things" says.
//   - Where they are kept: firstpass/<club code>/<game id>.json in the local data folder (datalocation.ts LOCAL_ONLY),
//     so never in iCloud Drive, a settings backup or a scene export. They never go into the board, the scene, a game
//     story or anything else read openly or shared with the other Studio Macs.
//   - How long: a game's stats are deleted KEEP_DAYS after it finished (or was last saved, while it has no finish),
//     since HQ keeps the record, and all of a club's at once when the club is signed out or its sign-in stops working
//     (forget()).
//   - The log: nothing from HQ is logged but counts and ids. scrub() takes tokens, sign-in codes and secrets out of a
//     line before it is written, and privateLog() wraps the debug log so everything logged through it is scrubbed.
//
// create(deps) gives the store. deps:
//   log(level, source, message, extra?)   the debug log (wrapped with privateLog())
//   dir                                   the folder to keep stats in (datadir.local('firstpass'))
//   now()                                 the time, for tests

import fs from 'node:fs';
import path from 'node:path';
import * as savefile from './savefile';
import { errorMessage } from './errors';
import { obj, str } from './check';
import type { Log } from './types';

const KEEP_DAYS = 30;
const DAY = 24 * 3600 * 1000;
// How often the store looks for games past KEEP_DAYS while Studio runs.
const SWEEP_EVERY = 6 * 3600 * 1000;

// A club code as HQ has them: capitals and digits. A game id: HQ's uuid.
const CLUB = /^[A-Z0-9]{1,20}$/;
const GAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validClub = (club: unknown): club is string => typeof club === 'string' && CLUB.test(club);
const validGame = (id: unknown): id is string => typeof id === 'string' && GAME.test(id);

// One game's stats as kept: what HQ answered (data) and when.
interface Kept { club: string; gameId: string; savedAt: string; finishedAt: string | null; data: unknown }

// A log line with anything secret taken out: JSON web tokens (HQ's access tokens), Bearer values, and the values of
// token, code, key, secret and password parameters or fields, in query strings, JSON or plain text.
const SECRET_NAMES = 'access_token|refresh_token|provider_token|provider_refresh_token|id_token|token|code_verifier|code_challenge|code|apikey|api_key|key|secret|password|authorization';
const SECRET_PARAM = new RegExp(`((?:^|[?&\\s,{;])"?(?:${SECRET_NAMES})"?\\s*[=:]\\s*"?)([^&\\s",;}]+)`, 'gi');
function scrub(text: unknown): string {
  return String(text ?? '')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[hidden]')
    .replace(/\b(Bearer)\s+[\w.~+/=-]+/gi, '$1 [hidden]')
    .replace(SECRET_PARAM, '$1[hidden]');
}

// The debug log, with every message and detail scrubbed: what the HQ client and this store log through.
function privateLog(log: Log): Log {
  return (level, source, message, extra) => log(level, source, scrub(message),
    extra === undefined ? undefined : scrub(typeof extra === 'string' ? extra : JSON.stringify(extra)));
}

function create({ log: rawLog, dir, now = () => Date.now() }: { log: Log; dir: string; now?: () => number }) {
  const log = privateLog(rawLog);
  let timer: NodeJS.Timeout | undefined;
  const clubDir = (club: string) => path.join(dir, club);
  const gameFile = (club: string, gameId: string) => path.join(clubDir(club), `${gameId}.json`);

  // Keeps a game's stats. false for a club code or game id that isn't one.
  function save(club: string, gameId: string, data: unknown, { finishedAt = null }: { finishedAt?: string | null } = {}): boolean {
    if (!validClub(club) || !validGame(gameId)) return false;
    const kept: Kept = { club, gameId, savedAt: new Date(now()).toISOString(), finishedAt, data };
    try {
      fs.mkdirSync(clubDir(club), { recursive: true });
      savefile.writeJsonSync(gameFile(club, gameId), kept);
      return true;
    } catch (err) {
      log('error', 'firstpass', `Couldn't keep ${club} game ${gameId}: ${errorMessage(err)}`);
      return false;
    }
  }

  // A game's kept stats, or null.
  function read(club: string, gameId: string): Kept | null {
    if (!validClub(club) || !validGame(gameId)) return null;
    const got = obj(savefile.readJson<unknown>(gameFile(club, gameId), null));
    if (!got.gameId) return null;
    return { club, gameId, savedAt: str(got.savedAt), finishedAt: typeof got.finishedAt === 'string' ? got.finishedAt : null, data: got.data };
  }

  // The games kept for a club, by id.
  function games(club: string): string[] {
    if (!validClub(club)) return [];
    try { return fs.readdirSync(clubDir(club)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).filter(validGame).sort(); } catch { return []; }
  }

  // The clubs with stats kept.
  function clubs(): string[] {
    try { return fs.readdirSync(dir).filter(validClub).sort(); } catch { return []; }
  }

  // Deletes everything kept for a club: signed out, or its sign-in stopped working. Returns how many games went.
  function forget(club: string, why = 'signed out'): number {
    if (!validClub(club)) return 0;
    const n = games(club).length;
    try { fs.rmSync(clubDir(club), { recursive: true, force: true }); } catch (err) {
      log('error', 'firstpass', `Couldn't delete ${club}'s FirstPass stats: ${errorMessage(err)}`);
      return 0;
    }
    if (n) log('info', 'firstpass', `Deleted ${n} game(s) of ${club}'s FirstPass stats (${why})`);
    return n;
  }

  // Deletes every game finished (or, unfinished, last saved) more than KEEP_DAYS ago. Returns how many went.
  function sweep(): number {
    const before = now() - KEEP_DAYS * DAY;
    let gone = 0;
    for (const club of clubs()) {
      for (const id of games(club)) {
        const kept = read(club, id);
        const at = Date.parse(kept?.finishedAt || kept?.savedAt || '');
        if (kept && Number.isFinite(at) && at >= before) continue;
        try { fs.rmSync(gameFile(club, id), { force: true }); gone++; } catch (err) {
          log('error', 'firstpass', `Couldn't delete ${club} game ${id}: ${errorMessage(err)}`);
        }
      }
      if (!games(club).length) try { fs.rmSync(clubDir(club), { recursive: true, force: true }); } catch { /* next sweep */ }
    }
    if (gone) log('info', 'firstpass', `Deleted ${gone} game(s) of FirstPass stats more than ${KEEP_DAYS} days old`);
    return gone;
  }

  // Sweeps now and every SWEEP_EVERY while Studio runs.
  function start() {
    sweep();
    if (!timer) { timer = setInterval(sweep, SWEEP_EVERY); timer.unref(); }
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }

  return { save, read, games, clubs, forget, sweep, start, stop, log };
}

type Store = ReturnType<typeof create>;
export type { Kept, Store };
export { create, scrub, privateLog, validClub, validGame, KEEP_DAYS };
