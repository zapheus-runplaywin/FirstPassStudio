// FirstPass Studio - each game's story, and sharing the stories between Studio Macs.
//
// The board (board.js) keeps the story of the game on Output 1's scoreboard, and of each of the night's other games it
// follows in the background: its Game stats, Score worm and moments, in game-stories/<game id>.json in the local
// folder. The Socials tab's Game stats, Game story, Score worm, Moments of the game and "of the night" pictures are
// drawn from them. A Mac that was off air for part of the night, or had following the other games turned off, lacks
// some, so the stories are shared, two ways:
//
//   1. On the same network: every Studio announces itself with Bonjour (macOS's dns-sd, SERVICE) and looks for the
//      others. Every SYNC_EVERY it asks each one it finds for its finished stories (GET /api/stories, then
//      GET /api/stories/<game id> for each one it doesn't have or has a worse copy of) and keeps a copy. Asking is
//      a plain read: nothing on the other Mac changes, so no pairing is needed (access.js lets reads through).
//   2. iCloud Drive, for the nights the Macs never saw each other: each finished story is also written to
//      iCloud Drive/FirstPass Studio/game-stories/ (CLOUD_FOLDER) when iCloud Drive is on, whether or not the settings
//      are kept there, and every SYNC_EVERY the stories other Macs put there are copied in.
//      A story finished some other way (Studio quit part way through a game, so it is finished DONE_AFTER later) or
//      whose write failed is put there at the next look (toCloud).
//
// A copy carries from: { studio, via: 'network'|'icloud' }, and every story says which Studio kept it (studio, studioId).
// A Studio keeps a story of the game it streams, and of the night's other games it follows in the background (marked
// followed: true), so two Macs can each have one of the same game. Both read the same PlayHQ feed, so they differ only
// where one missed something (a gap: its internet or PlayHQ dropped, or the scoreboard picked the game part way
// through) or the stream scored goals by hand that PlayHQ never had. So the better one is kept (better()): the one
// with fewer gaps; on the same gaps the streamed one; then, for two copies, the one saved later. A copy replaces this
// Mac's own story only when it is better than it without counting when it was saved, and this Mac doesn't write its
// own over a better copy (nor a story it only followed over a better one it streamed: a game it left part way through
// by hand), so it doesn't matter which way a story arrives first. Where one story has a gap the other saw goal by goal,
// the two are made into one (combined(), with board.js mergeStories given through useMerge): the better one with that gap
// filled, kept as this Mac's own (filled: the Studios whose stories filled it), so it is shared on and the other Mac takes
// it too. A Mac whose story has gaps asks for the other's story of the game even when it isn't better, once for each
// save of it. Only finished stories are shared: the game ended, or the scoreboard moved
// on to another game (DONE_AFTER without a new save covers a Studio quit mid-game). Stories go back SHARE_DAYS.
//
// create(deps) gives the store. deps:
//   log(level, source, message)  the debug log
//   dir                          the local game-stories folder
//   savefile                     atomic writes
//   studio                       this Mac's name (datalocation.computerName()), shown on the Socials tab beside copies
//   studioId                     this Mac's random id (datalocation.computerId()), which tells its own stories from copies
//   port                         Studio's port, announced with Bonjour
//   cloudDir                     the shared iCloud folder, or '' when there is none (FIRSTPASS_STORIES_CLOUD for tests)
//   peers                        extra Studios to ask, as http://host:port (FIRSTPASS_OTHER_STUDIOS for tests)
//   bonjour                      false turns the announcing and looking off (anywhere but a Mac it is off anyway)
//   firstSync                    ms after start up before the first look (FIRST_SYNC; FIRSTPASS_STORIES_FIRST_SYNC_MS for tests)
//
// Routes (server.js hands /api/stories here):
//   GET /api/stories             this Mac's own finished stories of the last SHARE_DAYS: { studio, studioId, stories: [{ gameId, savedAt, gaps, followed }] }
//   GET /api/stories/<game id>   one of them, as kept (404 when it isn't this Mac's own and finished; ?live=1 gives one
//                                still being played too, for a Mac that picked the game up part way)


import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { errorMessage } from './errors';
import { obj } from './check';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as Savefile from './savefile';
import type { Log, Send } from './types';

type Via = 'network' | 'icloud';
// A game's story as kept (board.js gameStory() makes it): what this module reads of it, the rest kept as it is.
interface Story {
  gameId: string; savedAt: number; followed?: boolean; ended?: boolean; final?: boolean;
  studio?: string; studioId?: string; from?: { studio: string; via: Via }; filled?: string[];
  worm?: { gaps?: unknown[] }; stats?: { gapInHistory?: unknown }; moments?: unknown[]; goalOrder?: unknown;
  [key: string]: unknown;
}
// board.js mergeStories: the better story with its gaps filled from the other (how many in filledGaps), or null.
type Merge = (better: Story, other: Story) => (Partial<Story> & { filledGaps?: number }) | null;
// What gapsOf() and better() read of a story (a listing's entry stands in for one).
type Rated = Pick<Story, 'worm' | 'stats' | 'followed'> & { savedAt?: number };

const SERVICE = '_firstpass-studio._tcp';
const DNS_SD = '/usr/bin/dns-sd';
const SYNC_EVERY = 3 * 60 * 1000;
const FIRST_SYNC = 20 * 1000; // after start up, once Bonjour has had time to hear the others
const DONE_AFTER = 30 * 60 * 1000;
const SHARE_DAYS = 30;
const ASK_TIMEOUT = 5000;
const MAX_STORY = 2 * 1024 * 1024; // a story is tens of KB; anything this big isn't one
const CLOUD_FOLDER = ['FirstPass Studio', 'game-stories'];

// How many gaps a story has: the score worm's (each a stretch Studio wasn't watching), else 1 when its stats say there was one.
const gapsOf = (s: Rated | null | undefined): number => (s && s.worm && Array.isArray(s.worm.gaps) ? s.worm.gaps.length : s && s.stats && s.stats.gapInHistory ? 1 : 0);
// Whether story a is better than story b (b may be null): fewer gaps, then streamed over followed, then (byTime) saved later.
function better(a: Rated, b: Rated | null | undefined, { byTime = true } = {}): boolean {
  if (!b) return true;
  const ga = gapsOf(a), gb = gapsOf(b);
  if (ga !== gb) return ga < gb;
  if (!a.followed !== !b.followed) return !a.followed;
  return byTime && (a.savedAt ?? 0) > (b.savedAt ?? 0);
}
const fileName = (id: unknown) => `${String(id).replace(/[^\w.-]/g, '_')}.json`;
const isStory = (v: unknown): v is Story => {
  const s = obj(v);
  return typeof s.gameId === 'string' && !!s.gameId && Number.isFinite(s.savedAt)
    && !!s.stats && typeof s.stats === 'object' && (!s.moments || Array.isArray(s.moments));
};

// One line of dns-sd -B: a Studio announced (add) or gone, by its name, or null for the other lines. For example
//   12:00:01.123  Add        2   4 local.               _firstpass-studio._tcp. Court-2-MacBook
function browsed(line: string): { add: boolean; name: string } | null {
  const m = /\s(Add|Rmv)\s+\d+\s+\d+\s+\S+\s+_firstpass-studio\._tcp\.\s+(.+?)\s*$/.exec(line);
  return m ? { add: m[1] === 'Add', name: m[2] } : null;
}
// dns-sd -L's answer as http://host:port, or null: "Court-2-MacBook._firstpass-studio._tcp.local. can be reached at
// Court-2-MacBook.local.:8080 (interface 4)".
function reached(out: string): string | null {
  const m = /can be reached at (\S+?)\.?:(\d+)/.exec(out);
  return m ? `http://${m[1]}:${m[2]}` : null;
}

function create({ log = () => {}, dir, savefile, studio = 'This Mac', studioId = studio, port = 8080, cloudDir = '', peers = [], bonjour = true, firstSync = FIRST_SYNC }: {
  log?: Log; dir: string; savefile: typeof Savefile; studio?: string; studioId?: string; port?: number; cloudDir?: string; peers?: string[];
  bonjour?: boolean; firstSync?: number;
}) {
  const fileOf = (id: string) => path.join(dir, fileName(id));
  // A story file: this Mac's own, or a copy; checked with isStory() where it matters.
  const readFile = (file: string): Story | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const read = (id: string | null | undefined) => (id ? readFile(fileOf(id)) : null);
  const done = (s: Story | null) => !!s && !!(s.ended || s.final || Date.now() - s.savedAt > DONE_AFTER);
  const recent = (s: Story) => Date.now() - s.savedAt < SHARE_DAYS * 86400000;

  // Filling gaps (board.js mergeStories, handed over with useMerge): the better of two stories of a game with its gaps
  // filled from the other, as this Mac's own (so it is shared on, and the other Mac takes it too: it has fewer gaps),
  // saying whose stories filled it (filled: [studio names]); or null when no gap could be filled.
  let merge: Merge | null = null;
  const useMerge = (fn: Merge) => { merge = fn; };
  function combined(a: Story | null, b: Story | null): Story | null {
    if (!merge || !a || !b || !a.goalOrder || !b.goalOrder) return null;
    // From the better one first; the other way round too (this Mac's story going on after a better one filled before).
    const fill = merge;
    const pairs = better(a, b, { byTime: false }) ? [[a, b], [b, a]] : [[b, a], [a, b]];
    let base: Story | undefined, m: ReturnType<Merge> | undefined;
    for (const [x, y] of pairs) {
      let got: ReturnType<Merge>;
      try { got = fill(x, y); } catch (err) { log('warn', 'stories', `Gaps in a game's story weren't filled: ${errorMessage(err)}`); return null; }
      const made = got && { ...x, ...got };
      if (made && !better(a, made, { byTime: false }) && !better(b, made, { byTime: false })) { base = x; m = got; break; }
    }
    if (!m || !base) return null;
    const whose = (x: Story) => (x.from ? [x.from.studio] : x.studioId && x.studioId !== studioId ? [x.studio ?? ''] : []);
    const filled = [...new Set([...(a.filled || []), ...(b.filled || []), ...whose(a), ...whose(b)])];
    const { filledGaps, ...made } = m;
    const s: Story = { ...base, ...made, studio, studioId, savedAt: Math.max(a.savedAt || 0, b.savedAt || 0), ended: !!(a.ended || b.ended), filled: filled.length ? filled : undefined };
    delete s.from;
    if (gapsOf(s) < Math.min(gapsOf(a), gapsOf(b))) log('info', 'stories', `Filled ${filledGaps} gap${filledGaps === 1 ? '' : 's'} in game ${s.gameId}'s story from ${filled.join(' and ') || 'this Mac\'s other story of it'}`);
    return s;
  }
  function write(s: Story, toCloud: boolean) {
    fs.mkdirSync(dir, { recursive: true });
    savefile.writeFileSync(fileOf(s.gameId), JSON.stringify(s)); // at once, so an older write can't land after a newer one
    if (toCloud && cloudDir) {
      try {
        fs.mkdirSync(cloudDir, { recursive: true });
        savefile.writeFileSync(path.join(cloudDir, fileName(s.gameId)), JSON.stringify(s));
      } catch (err) { log('warn', 'stories', `The game's story wasn't put in iCloud Drive: ${errorMessage(err)}`); }
    }
  }

  // The board keeping this Mac's own story. final: the game ended or the scoreboard moved on, so it goes to iCloud too.
  function keep(story: Story, { final = false } = {}): void {
    let s: Story = { ...story, studio, studioId, final: final || undefined };
    const have = read(s.gameId);
    const m = have && have.gameId === s.gameId ? combined(s, have) : null;
    if (m) s = { ...m, final: final || undefined }; // gaps filled from what this Mac had (another Mac's story, or one filled before)
    // Another Studio's copy of this game, or this Mac's streamed story of it, that is better than one only followed here.
    else if (have && (have.from || (!have.followed && s.followed)) && better(have, s, { byTime: false })) return;
    write(s, final);
  }

  // Whether a story from another Studio should replace what this Mac has (see better()).
  const wanted = (s: Rated, have: Story | null) => better(s, have, { byTime: !!(have && have.from) });
  // A story from another Studio: kept when this Mac has none, or it is better than what this Mac has; or, when one fills
  // the other's gaps, the two made into one. Answers true when anything was kept.
  function accept(s: unknown, via: Via): boolean {
    if (!isStory(s) || !done(s) || !s.studio || !s.studioId || s.studioId === studioId) return false;
    const rest = { ...s };
    delete rest.from; // a copy says only where this Mac got it
    const copy = { ...rest, from: { studio: s.studio, via } };
    const have = read(s.gameId);
    const m = combined(copy, have);
    if (m) { write({ ...m, final: done(have) || undefined }, done(have)); return true; }
    if (!wanted(s, have)) return false;
    write(copy, false);
    return true;
  }

  // This Mac's own finished stories, for the other Studios.
  function own(): Story[] {
    let names: string[]; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return []; }
    return names.map(n => readFile(path.join(dir, n))).filter((s): s is Story => isStory(s) && !s.from && done(s) && recent(s));
  }

  // Where the night's stories came from, for the Socials tab: the copies, by Studio and way. [{ studio, via, games }]
  function sources(ids: string[]): { studio: string; via: Via | 'filled'; games: number }[] {
    const by = new Map<string, { studio: string; via: Via | 'filled'; games: number }>();
    const add = (who: string, via: Via | 'filled') => {
      const k = `${who}\n${via}`;
      by.set(k, { studio: who, via, games: (by.get(k)?.games || 0) + 1 });
    };
    for (const id of ids) {
      const s = read(id);
      if (s?.from) add(s.from.studio, s.from.via);
      else for (const who of s?.filled || []) add(who, 'filled');
    }
    return [...by.values()];
  }

  // ── Bonjour: announce this Studio and keep the list of the others (dns-sd -R and -B, which run until killed) ──
  const found = new Map<string, boolean>(); // instance name -> true while announced
  const kids: ChildProcess[] = [];
  const canBonjour = bonjour && process.platform === 'darwin' && fs.existsSync(DNS_SD);
  function startBonjour() {
    if (!canBonjour) return;
    const run = (args: string[]) => {
      const p = spawn(DNS_SD, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      p.on('error', err => log('warn', 'stories', `Bonjour (dns-sd ${args[0]}) didn't start: ${errorMessage(err)}`));
      kids.push(p);
      return p;
    };
    run(['-R', studio, SERVICE, 'local', String(port)]);
    let rest = '';
    run(['-B', SERVICE, 'local']).stdout.on('data', chunk => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const seen = browsed(line);
        if (!seen || seen.name === studio) continue;
        if (seen.add) found.set(seen.name, true); else found.delete(seen.name);
      }
    });
  }
  // Where a Studio found with Bonjour answers: http://host:port, or null.
  function resolve(name: string): Promise<string | null> {
    return new Promise(done => {
      const p = spawn(DNS_SD, ['-L', name, SERVICE, 'local'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const end = (v: string | null) => { clearTimeout(t); p.kill(); done(v); };
      const t = setTimeout(() => end(null), ASK_TIMEOUT);
      p.on('error', () => end(null));
      p.stdout.on('data', chunk => {
        out += chunk;
        const at = reached(out);
        if (at) end(at);
      });
    });
  }

  // Another Studio's answer, unchecked.
  async function ask(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(ASK_TIMEOUT), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    if (text.length > MAX_STORY) throw new Error('too big');
    return JSON.parse(text);
  }

  // Copies a Studio's finished stories that this Mac doesn't have (or has older). Answers how many were copied.
  const tried = new Set<string>(); // game id, Studio id and save time of the stories already asked for to fill gaps
  async function fromStudio(base: string): Promise<number> {
    const list = obj(await ask(`${base}/api/stories`));
    if (list.studioId === studioId || !Array.isArray(list.stories)) return 0;
    let copied = 0;
    for (const entry of list.stories) {
      const { gameId, savedAt, gaps = 0, followed } = obj(entry);
      if (typeof gameId !== 'string' || !gameId) continue;
      const have = read(gameId);
      // Asked for when it's better than this Mac's, or this Mac's has gaps it might fill (once for each save of it).
      const tryFill = !!merge && gapsOf(have) > 0 && !tried.has(`${gameId}\n${list.studioId}\n${savedAt}`);
      if (!tryFill && !wanted({ savedAt: Number(savedAt), followed: !!followed, worm: { gaps: Array(Math.max(0, Number(gaps) || 0)).fill(null) } }, have)) continue;
      try {
        const got = await ask(`${base}/api/stories/${encodeURIComponent(gameId)}`);
        tried.add(`${gameId}\n${list.studioId}\n${savedAt}`);
        if (accept(got, 'network')) copied++;
      } catch { /* asked again next time */ }
    }
    if (copied) log('info', 'stories', `Copied ${copied} game stor${copied === 1 ? 'y' : 'ies'} from ${list.studio}'s Studio`);
    return copied;
  }

  // Copies the stories other Macs put in iCloud Drive, and asks iCloud to download the ones only listed so far.
  let cloudSeen = 0;
  function fromCloud(): number {
    if (!cloudDir) return 0;
    let list: string[]; try { list = fs.readdirSync(cloudDir); } catch { return 0; }
    const since = cloudSeen;
    cloudSeen = Date.now();
    let copied = 0;
    for (const n of list) {
      const file = path.join(cloudDir, n);
      if (/^\..+\.json\.icloud$/.test(n)) {
        if (process.platform === 'darwin') spawn('/usr/bin/brctl', ['download', file], { stdio: 'ignore' }).on('error', () => {});
        cloudSeen = Math.min(cloudSeen, since); // look at every file again once it's downloaded
        continue;
      }
      if (!n.endsWith('.json')) continue;
      try { if (fs.statSync(file).mtimeMs < since - 60000) continue; } catch { continue; }
      if (accept(readFile(file), 'icloud')) copied++;
    }
    if (copied) log('info', 'stories', `Copied ${copied} game stor${copied === 1 ? 'y' : 'ies'} from iCloud Drive`);
    return copied;
  }

  // Puts in iCloud Drive this Mac's finished stories that aren't there yet, or are there older: a game is put there at
  // once when it ends or the scoreboard moves on (keep, final), but one left part way when Studio was quit only becomes
  // finished DONE_AFTER later, and a write may have failed. pushed: game id -> the savedAt already there.
  const pushed = new Map<string, number>();
  function toCloud(): number {
    if (!cloudDir) return 0;
    let n = 0;
    for (const s of own()) {
      if (pushed.get(s.gameId) === s.savedAt) continue;
      const there = readFile(path.join(cloudDir, fileName(s.gameId)));
      if (!there || (there.studioId === studioId ? there.savedAt < s.savedAt : better(s, there, { byTime: false }))) { // never over another Mac's better story
        try {
          fs.mkdirSync(cloudDir, { recursive: true });
          savefile.writeFileSync(path.join(cloudDir, fileName(s.gameId)), JSON.stringify(s));
          n++;
        } catch (err) { log('warn', 'stories', `The game's story wasn't put in iCloud Drive: ${errorMessage(err)}`); continue; }
      }
      pushed.set(s.gameId, s.savedAt);
    }
    if (n) log('info', 'stories', `Put ${n} finished game stor${n === 1 ? 'y' : 'ies'} in iCloud Drive`);
    return n;
  }

  // A Mac that picked a game up part way (board.js fillFromPeers): the other Studios' stories of it so far, game still
  // being played or not, from the Studios the last look found. [story]
  let seenAt: string[] = [];
  async function liveFrom(gameId: string): Promise<Story[]> {
    const out: Story[] = [];
    for (const base of new Set([...peers, ...seenAt])) {
      try {
        const s = await ask(`${base}/api/stories/${encodeURIComponent(gameId)}?live=1`);
        if (isStory(s) && s.gameId === gameId && s.studioId !== studioId && s.goalOrder) out.push(s);
      } catch { /* not there, or it has no story of the game */ }
    }
    return out;
  }

  let busy = false;
  async function sync() {
    if (busy) return 0;
    busy = true;
    let copied = 0;
    try {
      const bases = [...peers];
      for (const name of found.keys()) { const b = await resolve(name); if (b) bases.push(b); }
      seenAt = bases;
      for (const base of bases) {
        try { copied += await fromStudio(base); } catch (err) { log('debug', 'stories', `${base} didn't share its game stories: ${errorMessage(err)}`); }
      }
      toCloud();
      copied += fromCloud();
    } finally { busy = false; }
    return copied;
  }

  let timers: NodeJS.Timeout[] = [];
  function start() {
    startBonjour();
    timers = [setTimeout(sync, firstSync), setInterval(sync, SYNC_EVERY)];
    for (const t of timers) t.unref?.();
  }
  function stop() {
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    for (const p of kids.splice(0)) p.kill();
  }

  // GET /api/stories and /api/stories/<game id>. Answers true when it was one of them.
  function route(req: IncomingMessage, res: ServerResponse, url: URL, { send }: { send: Send }): boolean {
    if (url.pathname !== '/api/stories' && !url.pathname.startsWith('/api/stories/')) return false;
    if (req.method !== 'GET') return send(res, 405, { error: 'Only GET' }), true;
    if (url.pathname === '/api/stories') return send(res, 200, { studio, studioId, stories: own().map(s => ({ gameId: s.gameId, savedAt: s.savedAt, gaps: gapsOf(s), followed: s.followed || undefined })) }), true;
    const s = read(decodeURIComponent(url.pathname.slice('/api/stories/'.length)));
    // ?live=1: a game still being played too (liveFrom on a Mac that picked it up part way).
    if (!isStory(s) || s.from || (!done(s) && url.searchParams.get('live') !== '1')) return send(res, 404, { error: 'No finished story of that game on this Mac' }), true;
    return send(res, 200, { studio, studioId, ...s }), true; // stories kept before sharing came in don't say whose they are
  }

  return { dir, keep, read, accept, own, sources, sync, start, stop, route, useMerge, liveFrom, found: () => [...found.keys()] };
}

export type { Story, Merge, Via };
export { create, browsed, reached, better, gapsOf, SERVICE, CLOUD_FOLDER, SYNC_EVERY };
