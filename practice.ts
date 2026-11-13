// FirstPass Studio - practice games: a recorded game (recorder.js) played back as if it were live.
//
// While a practice game runs, PlayHQ isn't asked anything (but see a followed game below): playhq.js asks this module instead (answer() for the
// GraphQL API, live() for live scoring), which gives what PlayHQ said at the same point of the recorded night.
// Everything else in Studio runs as on a real night (the scoreboard follows the score and clock, sequences and
// game triggers fire, afresh each start and jump with Run game-timed sequences again, the outputs can be on), so
// it's for rehearsing a night, trying a change and showing Studio to someone. The recording is played in real time from a point picked on the Recordings tab (Start, a few
// minutes before the game's scheduled start, as many as Starts in says, each quarter or full time), and can be paused
// and nudged (+ or - ms).
//
// A game Studio followed in the background (another court's: recorder.js records it as "... (followed)") plays the
// same way, which is how graphics are put over someone else's video of that game: jump to the quarter the video is
// on and Pause, cue the video on that quarter's first centre pass, press Play on both together, and nudge until the
// score changes with the goals. Its recording has only what Studio asked PlayHQ that night, so anything else the
// graphics ask is asked of PlayHQ (the one exception to the line above).
//
// The recorded night's times are moved to now: every time in an answer (a fixture's date and time, the clock's
// lastUpdatedAt, any other date and time) gets the gap between now and that point in the recording added, so the
// game starts a few minutes from now (or is in its third quarter now). Paused, the gap grows with the pause, so
// the clock stands still.
//
// Starting one keeps the scoreboard as it was and picks the recorded game by hand; stopping puts the scoreboard
// back. Nothing a practice game does counts: sponsor exposure isn't kept (exposure.js held), and the night's
// recording is paused (recorder.js) so a practice isn't recorded as a night of its own.
//
// A demo game is a practice game wearing the client's competition (the one in use): a historic game of theirs is
// picked, and only its teams and athletes are taken from it. Everything else, the score, clock, quarters, moments
// and timing, comes from the recording. Under the hood the recorded game's two teams become the historic game's
// (Swap puts them the other way round, so the client's team can be the winner), the recorded division's other teams
// become the client's division's others (so the ladder and fixtures are theirs), and the recorded athletes become
// the historic game's by position (a recorded GS's goals are the client's GS's); one with no match is left unnamed,
// so their goals go to the team. A side the recording has no line up for (PlayHQ sometimes has only one) plays with
// the client's team's own line up, goals to the team. The division's PlayHQ id is translated to the recorded one, and anything the
// recording doesn't have (the client's competition, seasons and divisions) is asked of PlayHQ as usual.
//
// hooks (init): read(recording) the recording's lines, reset() forget what was read from PlayHQ, snapshot() and
// restore(s) the scoreboard, select(game) pick the game on the scoreboard, rearm() the game's moments fire again from
// now (sequences.js), paused(on) pause the night's recording,
// choices(gradeId) the client's divisions and a division's finished games, for picking one,
// competition() the competition in use's id, readJson(file) and writeJson(file, value) for the saved demos,
// demo(gameId, gradeId) the client's historic game ({ division, gradeId, teams, home, away }, each side { name,
// players: [{ name, playhqId, position, gender, private }] }), positionOf(player) a PlayHQ line up entry's position.

import { errorMessage } from './errors';
import { obj, str, arr, isObj } from './check';
import type { Log, Body, Send, ReadBody } from './types';
import type { Line } from './recorder';
import type { Board } from './board';

type SideKey = 'home' | 'away';
const SIDE_KEYS: SideKey[] = ['home', 'away'];
// The client's historic game for a demo (hooks.demo): its division, teams and each side's athletes.
interface ClientAthlete { name: string; playhqId: string; position: string; gender: string; private: boolean }
interface ClientSide { name: string; players: ClientAthlete[] }
interface ClientGame { division: string; gradeId: string; teams: string[]; home: ClientSide; away: ClientSide }
// The recorded game as the scoreboard picks it.
interface PGame { id: string; roundId: string; division: string; court: string; round: string; date: string; time: string; venue: string; home: { name: string }; away: { name: string } }
interface Jump { id: string; label: string; at: number }
interface Answer { t: number; data: unknown }
interface LiveAnswer { t: number; json: { errors?: unknown; data?: unknown } }
// A recorded athlete in the pairing table.
interface RecAthlete { id: string; name: string; position: string }
// What a demo game wears (dress()).
interface Dressed {
  teams: Map<string, string>; players: Map<string, ClientAthlete | null>; ids: Map<string, string>;
  sides: Record<SideKey, { recorded: RecAthlete[]; client: ClientAthlete[]; missing: boolean }>;
  swap: boolean; division: string; gradeId: string; game: string; home: string; away: string;
}
// The demo's choices as the page or a saved demo sends them.
interface DemoOpts { game?: string; division?: string; swap?: boolean; pairs?: Record<string, string> }
interface Loaded {
  recording: string; game: PGame; chapter: Line; answers: Map<string, Answer[]>; live: Map<string, LiveAnswer[]>; jumps: Jump[];
  scheduled: number; started: number; followed: boolean; demo?: Dressed;
}
interface Run extends Loaded { snap: Board | null; lead: unknown; rerun: boolean; from: number; startedAt: number; pausedAt: number | null }
interface Hooks {
  read(recording: string): Line[]; reset(): void; snapshot(): Board | null; restore(s: Board | null): void; select(game: PGame): void; rearm(): void; paused(on: boolean): void;
  demo(gameId: string, gradeId: string): Promise<ClientGame>; choices(gradeId: string): Promise<unknown>; competition(): string;
  readJson(file: string): unknown; writeJson(file: string, value: unknown): void; positionOf(p: unknown): string; demos?: string;
}

const LEAD_MIN = 5; // Start: this many minutes before the game's scheduled start, unless another is picked (0 to 60)
const leadMs = (m: unknown) => Math.max(0, Math.min(60, Number.isFinite(Number(m)) && m !== '' && m !== null ? Number(m) : LEAD_MIN)) * 60000;
const PERIODS: Record<string, string> = { FIRST_QTR: 'Q1', SECOND_QTR: 'Q2', THIRD_QTR: 'Q3', FOURTH_QTR: 'Q4', FIRST_HALF: '1st half', SECOND_HALF: '2nd half' };

let log: Log = () => {};
let hooks: Hooks = { read: () => [], reset() {}, snapshot: () => null, restore() {}, select() {}, rearm() {}, paused() {}, demo: async () => { throw new Error('Demo games need Studio.'); }, choices: async () => ({ divisions: [], games: [] }), competition: () => '', readJson: () => ({}), writeJson() {}, positionOf: p => str(obj(obj(p).playerPosition).shortName) };
let run: Run | null = null; // the practice game running: see start()
// The practice game running, for the calls that need one (route() and deck() check first).
function cur(): Run { if (!run) throw new Error('No practice game is running.'); return run; }

// h.demos: the saved demos' file.
function init(logger: Log | null, h: Partial<Hooks> = {}) {
  log = logger || log;
  hooks = { ...hooks, ...h };
  if (h.demos) demosFile = h.demos;
}

const active = () => !!run;

// Where the recording is now (ms since 1970 on the recorded night), and the gap to now.
const position = () => { const r = cur(); return r.pausedAt !== null ? r.pausedAt : r.from + (Date.now() - r.startedAt); };
const gap = () => Date.now() - position();

// ─── Reading a recording ────────────────────────────────────────────────────
const localMs = (date: string, time: string) => {
  const t = /^\d{1,2}:\d{2}(:\d{2})?$/.test(time || '') ? (time.length <= 5 ? `${time.padStart(5, '0')}:00` : time.padStart(8, '0')) : '12:00:00';
  const ms = new Date(`${date}T${t}`).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const two = (n: number) => String(n).padStart(2, '0');
const dateOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const timeOf = (ms: number, like: string) => { const d = new Date(ms); const hm = `${two(d.getHours())}:${two(d.getMinutes())}`; return /^\d{1,2}:\d{2}:\d{2}$/.test(like) ? `${hm}:${two(d.getSeconds())}` : hm; };
const periodOf = (g: Body) => { const c = obj(g.clock); return str(c.periodValue || c.period) || str(obj(obj(g.result).currentPeriod).value); };
const RUNNING = /^(RESUME|RESUMED|START|STARTED|RUNNING)$/i;
const finished = (s: unknown) => /FINAL|COMPLETE|RESULT|FINISH|ENDED/i.test(String((isObj(s) && s.value) || s || ''));

// A recording's game, ready to play: its answers by question, its live answers, and where it can be played from.
function load(recording: string, gameId: string, lead?: unknown): Loaded {
  const lines = hooks.read(recording);
  const chapter = lines.find(l => l.k === 'game' && l.id === gameId);
  if (!chapter) throw new Error(`The recording has no game ${gameId}.`);
  const answers = new Map<string, Answer[]>(); // "op vars" -> [{ t, data }]
  const live = new Map<string, LiveAnswer[]>();    // game id -> [{ t, json }]
  const add = <T>(m: Map<string, T[]>, key: string, v: T) => { const l = m.get(key); if (l) l.push(v); else m.set(key, [v]); };
  for (const l of lines) {
    if (l.k === 'playhq') add(answers, `${str(l.op)} ${JSON.stringify(l.vars || {})}`, { t: l.t, data: l.data });
    else if (l.k === 'live') add(live, str(l.id), { t: l.t, json: l.errors ? { errors: l.errors } : { data: l.data } });
  }
  const b = obj(obj(lines.find(l => l.k === 'board' && obj(l.board).gameId === gameId)).board);
  const c = chapter;
  const game: PGame = { id: gameId, roundId: str(b.roundId), division: str(c.division) || str(b.division), court: str(c.court) || str(b.court),
    round: str(c.round) || str(b.round), date: str(b.date) || str(c.date), time: str(b.time) || str(c.time), venue: str(b.venue),
    home: { name: str(c.home) || str(obj(b.home).name) || 'Home' }, away: { name: str(c.away) || str(obj(b.away).name) || 'Away' } };
  const scheduled = (game.date && localMs(game.date, game.time)) || chapter.t;
  // Where it can be played from: Start, each period as the scorer started it, and full time. A period's jump is the
  // moment its play started: when the scorer first ran its clock (the clock's lastUpdatedAt, when PlayHQ says, as Studio
  // read it up to a few seconds later), else when PlayHQ first said it was on. So a video cued on that quarter's first
  // centre pass lines up with Play.
  const jumps: Jump[] = [{ id: 'start', label: 'Start', at: scheduled - leadMs(lead) }];
  const seen = new Set<string>(), ran = new Set<string>();
  for (const a of live.get(gameId) || []) {
    const g = obj(a.json.data).game;
    if (!isObj(g)) continue;
    const p = periodOf(g);
    if (p && !seen.has(p)) { seen.add(p); jumps.push({ id: p, label: PERIODS[p] || p, at: a.t }); }
    const clock = obj(g.clock);
    if (p && !ran.has(p) && isObj(g.clock) && RUNNING.test(str(clock.status)) && !g.break) {
      ran.add(p);
      const u = Number(clock.lastUpdatedAt) || Date.parse(str(clock.lastUpdatedAt)) || 0;
      const j = jumps.find(x => x.id === p);
      if (j) j.at = u && u <= a.t && a.t - u < 30000 ? u : a.t;
    }
    if (finished(g.status)) { jumps.push({ id: 'end', label: 'Full time', at: a.t }); break; }
  }
  return { recording, game, chapter, answers, live, jumps, scheduled, started: lines.length ? lines[0].t : chapter.t, followed: !!chapter.followed };
}

// ─── Moving the recorded night to now ───────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A copy of a recorded answer with every date and time moved by ms. The copy has the same shape as what was given.
function shift<T>(value: T, ms: number): T {
  const walk = (v: unknown, key: string): unknown => {
    if (Array.isArray(v)) return v.map(x => walk(x, key));
    if (isObj(v)) {
      const o: Body = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      // A game's date with its time beside it (or in its allocation): moved together, as one moment.
      if (typeof v.date === 'string' && DATE.test(v.date)) {
        const holder = typeof v.time === 'string' ? o : typeof obj(v.allocation).time === 'string' ? obj(o.allocation) : null;
        const at = localMs(v.date, holder ? str(holder.time) : '12:00');
        if (at !== null) {
          const moved = at + ms;
          o.date = dateOf(moved);
          if (holder) holder.time = timeOf(moved, str(holder.time));
          if (Array.isArray(v.dates)) o.dates = v.dates.map(d => (d === v.date ? o.date : d));
        }
      }
      return o;
    }
    if (typeof v === 'string' && ISO.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + ms).toISOString() : v; }
    if (/At$/.test(key || '') && /^\d{13}$/.test(String(v))) return typeof v === 'number' ? v + ms : String(Number(v) + ms);
    return v;
  };
  return walk(value, '') as T; // walk() copies every object and list as it is, only moving the times in it
}

// The answer recorded for a question at this point of the night: the last one before it, or the first one there is.
function at<A extends { t: number }>(list: A[]): A {
  const now = position();
  let pick = list[0];
  for (const a of list) { if (a.t <= now) pick = a; else break; }
  return pick;
}

// ─── What playhq.js asks while a practice game runs ─────────────────────────
// The GraphQL answer's data. When the recording never asked that: an error, or, in a demo game, undefined, and
// PlayHQ is asked (the client's competition, seasons and divisions). A followed game's recording (recorder.js: a game
// Studio followed in the background) has only what Studio asked PlayHQ that night, not what the graphics would have,
// so for it too anything else is asked of PlayHQ (as it is now: a finished game's line ups have its final numbers).
function answer(op: string, vars: unknown) {
  const r = cur();
  const d = r.demo;
  const asked = d ? Object.fromEntries(Object.entries(obj(vars)).map(([k, v]) => [k, (typeof v === 'string' && d.ids.get(v)) || v])) : obj(vars);
  const list = r.answers.get(`${op} ${JSON.stringify(asked || {})}`);
  if (!list) {
    if (d || r.followed) return undefined;
    throw new Error(`The practice game's recording has no answer for ${op}.`);
  }
  const data = shift(at(list).data, gap());
  if (!d) return data;
  const worn = wear(data, d);
  return op === 'discoverGame' && asked.gameID === r.game.id ? fillLineUps(worn, d) : worn;
}
// The live scoring answer ({ data } or { errors }), as PlayHQ sent it.
function live(gameId: string) {
  const list = cur().live.get(gameId);
  if (!list) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  return shift(at(list).json, gap());
}

// ─── Demo games ─────────────────────────────────────────────────────────────
// The recorded game's line ups (its last discoverGame answer), the recorded division's teams (its ladder, else the
// night's fixtures) and its PlayHQ id.
function recorded(loaded: Loaded) {
  const last = (list: Answer[] | undefined) => obj(list && list.length ? list[list.length - 1].data : null);
  const game = last(loaded.answers.get(`discoverGame ${JSON.stringify({ gameID: loaded.game.id })}`));
  const names = [loaded.game.home.name, loaded.game.away.name];
  const gradeOf = (key: string, skip: number) => str(obj(JSON.parse(key.slice(skip))).gradeID);
  let gradeId = '', teams: string[] = [];
  for (const [key, list] of loaded.answers) {
    if (!key.startsWith('gradeLadder ')) continue;
    const standings = arr(obj(last(list).discoverGrade).ladder).flatMap(l => arr(obj(l).standings));
    const ladder = standings.map(s => str(obj(obj(s).team).name)).filter(Boolean);
    if (names.some(n => ladder.includes(n))) { gradeId = gradeOf(key, 12); teams = ladder; break; }
  }
  if (!gradeId) {
    for (const [key, list] of loaded.answers) {
      if (!key.startsWith('gradeRounds ')) continue;
      const rounds = arr(obj(last(list).discoverGrade).rounds);
      if (rounds.some(r => obj(r).id === loaded.game.roundId)) { gradeId = gradeOf(key, 12); break; }
    }
  }
  if (!teams.length) {
    for (const [key, list] of loaded.answers) {
      if (!key.startsWith('discoverFixtureByRound ')) continue;
      const games = arr(obj(last(list).discoverFixtureByRound).games).map(obj);
      if (!games.some(g => names.includes(str(obj(g.home).name)))) continue;
      for (const g of games) for (const s of [g.home, g.away]) { const n = str(obj(s).name); if (n && !teams.includes(n)) teams.push(n); }
    }
  }
  return { game: obj(game.discoverGame), gradeId, teams };
}

// What the demo game wears: { teams: recorded name -> client's, players: recorded PlayHQ id -> client's athlete (or
// null: unnamed), ids: client's PlayHQ ids -> recorded, sides: per side the recorded athletes and the client's to pick
// from, home, away, division, swap }. pairs: { recorded PlayHQ id: client athlete's name, or '' for unnamed } picked
// by hand (the pairing table, or a saved demo), over the match by position.
async function dress(loaded: Loaded, { game: clientGame = '', division: clientGrade = '', swap, pairs = {} }: DemoOpts = {}): Promise<Dressed> {
  const client = await hooks.demo(clientGame, clientGrade);
  const rec = recorded(loaded);
  const side: Record<SideKey, SideKey> = { home: swap ? 'away' : 'home', away: swap ? 'home' : 'away' };
  const teams = new Map([[loaded.game.home.name, client[side.home].name], [loaded.game.away.name, client[side.away].name]]);
  const others = (client.teams || []).filter(n => ![...teams.values()].includes(n));
  for (const n of rec.teams) if (!teams.has(n)) { const o = others.shift(); if (o) teams.set(n, o); }
  const players = new Map<string, ClientAthlete | null>();
  const sides = {} as Dressed['sides']; // both sides are set in the loop below
  for (const k of SIDE_KEYS) {
    const all = client[side[k]].players || [];
    const pool = [...all];
    const recPlayers = arr(obj(obj(rec.game.statistics)[k]).players).map(obj);
    const list: RecAthlete[] = [];
    const unmatched: string[] = [];
    for (const p of recPlayers) {
      const pl = obj(p.player);
      const id = str(pl.id);
      if (!id) continue;
      const prof = obj(pl.profile);
      // A fill-in player has a name and no profile.
      list.push({ id, name: `${str(prof.firstName)} ${str(prof.lastName)}`.trim() || str(pl.name) || 'Private player', position: hooks.positionOf(p) });
      const pos = hooks.positionOf(p);
      const i = pos ? pool.findIndex(c => c.position === pos) : -1;
      if (i >= 0) players.set(id, pool.splice(i, 1)[0]);
      else unmatched.push(id);
    }
    // Recorded athletes with no position match take the historic game's others (the bench, then the season's
    // squad) in order.
    for (const id of unmatched) players.set(id, pool.shift() || null);
    // Pairs picked by hand win.
    for (const r of list) {
      if (!(r.id in pairs)) continue;
      players.set(r.id, pairs[r.id] ? all.find(c => c.name === pairs[r.id]) || null : null);
    }
    // A side PlayHQ had no line up for (it happens): the client's team plays with its own line up, goals to the team.
    sides[k] = { recorded: list, client: all, missing: !list.length };
  }
  const ids = new Map();
  if (client.gradeId && rec.gradeId) ids.set(client.gradeId, rec.gradeId);
  return { teams, players, ids, sides, swap: !!swap, division: client.division || '', gradeId: clientGrade, game: clientGame,
    home: client[side.home].name, away: client[side.away].name };
}
const matched = (d: Dressed) => [...d.players.values()].filter(Boolean).length;

// The recorded game's line ups, worn: a side the recording has no line up for gets the client's team's own (their
// historic game's, or season squad), with no stats, so the team lists, positions and lower thirds have their names
// while that side's goals stay with the team. Only once the recording has line ups at all (PlayHQ sends none before
// the game is scored).
function fillLineUps(data: unknown, d: Dressed) {
  const g = obj(obj(data).discoverGame);
  if (!isObj(g.statistics)) return data;
  const statistics = { ...g.statistics };
  for (const k of SIDE_KEYS) {
    if (!d.sides[k].missing) continue;
    const st = obj(statistics[k]);
    if (arr(st.players).length) continue;
    statistics[k] = { ...st, players: d.sides[k].client.map((c, i) => {
      const [firstName, ...rest] = c.name.split(' ');
      return { playerNumber: '', statistics: [], playerPosition: c.position ? { shortName: c.position } : null, captain: null,
        player: { __typename: 'DiscoverParticipant', id: c.playhqId || `demo-${k}-${i}`, profile: { firstName, lastName: rest.join(' '), gender: c.gender ? c.gender.toUpperCase() : null } } };
    }) };
  }
  return { ...obj(data), discoverGame: { ...g, statistics } };
}

// The pairing table: a recorded athlete (PlayHQ id) shown as one of the client's (by name), or unnamed ('').
function pair(id: string, name: string) {
  const d = run && run.demo;
  if (!d) return 'Pairs are for a demo game.';
  const k = SIDE_KEYS.find(x => d.sides[x].recorded.some(r => r.id === id));
  if (!k) return 'That athlete isn\'t in the recorded game.';
  const c = name ? d.sides[k].client.find(x => x.name === name) || null : null;
  if (name && !c) return `${name} isn't in the team.`;
  d.players.set(id, c);
  hooks.reset(); // the line ups are read again, with the new pair
  return null;
}

// ─── Saved demos ────────────────────────────────────────────────────────────
// A demo game set up once and run again: demos.json in the data folder, { <name>: { recording, game, demo: { game,
// division, swap, pairs }, lead, competition, what } }.
interface SavedDemo { recording: string; game: string; lead?: unknown; competition?: string; what?: string; demo?: DemoOpts }
let demosFile = '';
// demos.json as read: each demo with what it needs to run, the rest left out.
function savedDemos(): Record<string, SavedDemo> {
  const out: Record<string, SavedDemo> = {};
  for (const [name, v] of Object.entries(obj(demosFile ? hooks.readJson(demosFile) : null))) {
    const s = obj(v), d = obj(s.demo);
    out[name] = { recording: str(s.recording), game: str(s.game), lead: s.lead, competition: str(s.competition), what: str(s.what),
      ...(isObj(s.demo) ? { demo: { game: str(d.game), division: str(d.division), swap: !!d.swap,
        pairs: Object.fromEntries(Object.entries(obj(d.pairs)).map(([k, p]) => [k, str(p)])) } } : {}) };
  }
  return out;
}
function save(name: unknown) {
  const r = cur();
  const d = r.demo;
  if (!d) return 'Only a demo game can be saved.';
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return 'Give the demo a name.';
  const pairs: Record<string, string> = {};
  for (const k of SIDE_KEYS) for (const r of d.sides[k].recorded) { const c = d.players.get(r.id); pairs[r.id] = c ? c.name : ''; }
  const all = savedDemos();
  all[n] = { recording: r.recording, game: r.game.id, lead: r.lead, competition: hooks.competition(),
    what: `${d.home} v ${d.away}, playing ${r.game.home.name} v ${r.game.away.name}`,
    demo: { game: d.game, division: d.gradeId, swap: d.swap, pairs } };
  hooks.writeJson(demosFile, all);
  log('info', 'practice', `Demo saved as ${n}`);
  return null;
}
function forget(name: string) {
  const all = savedDemos();
  if (!all[name]) return `There's no demo ${name}.`;
  delete all[name];
  hooks.writeJson(demosFile, all);
  return null;
}
const savedList = () => Object.entries(savedDemos()).map(([name, s]) => ({ name, what: s.what || '', recording: s.recording, competition: s.competition || '' }));

// A recorded answer in the client's names: team names swapped by name, and athletes by their PlayHQ id.
function wear(value: unknown, d: Dressed) {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      const o: Body = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      const who = str(obj(v.player).id);
      if (who && d.players.has(who)) {
        const c = d.players.get(who);
        const [firstName, ...rest] = String((c && c.name) || '').split(' ');
        o.player = c && !c.private && c.name
          ? { __typename: 'DiscoverParticipant', id: c.playhqId || `demo-${who}`, profile: { firstName, lastName: rest.join(' '), gender: c.gender ? c.gender.toUpperCase() : null } }
          : { __typename: 'DiscoverAnonymousParticipant', id: `demo-${who}` };
      }
      return o;
    }
    if (typeof v === 'string' && d.teams.has(v)) return d.teams.get(v);
    return v;
  };
  return walk(value);
}

// ─── Running one ────────────────────────────────────────────────────────────
// lead: Start's minutes before the scheduled start (0 to 60, else 5). demo: { game, division, swap }, the client's
// historic game and its division's PlayHQ id, for a demo game. rerun (Run game-timed sequences again, on unless false):
// the start and each jump forget the game's moments that have fired (hooks.rearm()), so its pre-game, break and full
// time sequences fire again, even for a game practised before or played live tonight.
async function start(given: unknown) {
  let opts = obj(given);
  if (opts.saved) {
    const s = savedDemos()[str(opts.saved)];
    if (!s) return `There's no demo ${str(opts.saved)}.`;
    if (s.competition && s.competition !== hooks.competition()) return `That demo is for another competition (${s.competition}). Switch to it on Competitions setup first.`;
    opts = { recording: s.recording, game: s.game, lead: opts.lead ?? s.lead, demo: s.demo, rerun: opts.rerun };
  }
  const { recording: rec, game: gameId, from = 'start', lead, demo, rerun = true } = opts;
  const recording = str(rec);
  if (run) stop();
  const loaded = load(recording, str(gameId), lead);
  if (isObj(demo)) {
    const pairs = Object.fromEntries(Object.entries(obj(demo.pairs)).map(([k, p]) => [k, str(p)]));
    loaded.demo = await dress(loaded, { game: str(demo.game), division: str(demo.division), swap: !!demo.swap, pairs });
  }
  const jump = loaded.jumps.find(j => j.id === from) || loaded.jumps[0];
  const snap = hooks.snapshot();
  hooks.paused(true);
  run = { ...loaded, snap, lead, rerun: rerun !== false, from: jump.at, startedAt: Date.now(), pausedAt: null };
  hooks.reset();
  if (run.rerun) hooks.rearm();
  pick();
  log('info', 'practice', `${loaded.demo ? `Demo game ${loaded.demo.home} v ${loaded.demo.away} (${matched(loaded.demo)} athletes matched), playing` : 'Practice game'} ${loaded.game.home.name} v ${loaded.game.away.name} from ${recording}, at ${jump.label}`);
  return null;
}

// Picks the game on the scoreboard, with its date and time moved to now.
function pick() {
  const r = cur(), d = r.demo;
  const g = d ? { ...r.game, division: d.division || r.game.division, home: { name: d.teams.get(r.game.home.name) || r.game.home.name }, away: { name: d.teams.get(r.game.away.name) || r.game.away.name } } : r.game;
  const at0 = g.date ? localMs(g.date, g.time) : null;
  const moved = at0 === null ? {} : { date: dateOf(at0 + gap()), time: g.time ? timeOf(at0 + gap(), g.time) : '' };
  hooks.select({ ...g, ...moved });
}

// lead (with Start): the minutes before the scheduled start to start from this time.
function jump(id: string, lead?: unknown) {
  const run = cur();
  if (id === 'start' && lead !== undefined) run.jumps[0].at = run.scheduled - leadMs(lead);
  const j = run.jumps.find(x => x.id === id);
  if (!j) return `There's no ${id} in this game.`;
  run.from = j.at;
  run.startedAt = Date.now();
  if (run.pausedAt !== null) run.pausedAt = j.at;
  hooks.reset();
  if (run.rerun) hooks.rearm();
  pick();
  log('info', 'practice', `Practice game moved to ${j.label}`);
  return null;
}

// Moves the game by ms against the clock (the nudge, while lining it up with a video): + further on, - back.
function nudge(ms: unknown) {
  const run = cur();
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n) || !n || Math.abs(n) > 3600000) return 'Nudge by a number of milliseconds, + or -.';
  if (run.pausedAt !== null) run.pausedAt += n; else run.from += n;
  return null;
}

function pause(on: boolean) {
  const run = cur();
  if (on && run.pausedAt === null) run.pausedAt = position();
  if (!on && run.pausedAt !== null) { run.from = run.pausedAt; run.startedAt = Date.now(); run.pausedAt = null; }
  return null;
}

function stop() {
  if (!run) return null;
  const { snap, game } = run;
  run = null;
  hooks.reset();
  hooks.restore(snap);
  hooks.paused(false);
  log('info', 'practice', `Practice game ${game.home.name} v ${game.away.name} stopped; the scoreboard is back as it was`);
  return null;
}

function state() {
  if (!run) return { active: false, saved: savedList() };
  const run_: Run = run;
  const p = position();
  const d = run.demo;
  return { active: true, recording: run.recording, rerun: run.rerun, followed: run.followed, game: d ? { ...run.game, division: d.division || run.game.division, home: { name: d.home }, away: { name: d.away } } : run.game,
    demo: d ? { recorded: { home: run.game.home.name, away: run.game.away.name }, swap: d.swap, athletes: matched(d), game: d.game,
      // The pairing table: each recorded athlete, who they are shown as, and who they could be.
      sides: Object.fromEntries(SIDE_KEYS.map(k => [k, {
        team: d.teams.get(run_.game[k].name),
        recordedTeam: run_.game[k].name, missing: d.sides[k].missing,
        pairs: d.sides[k].recorded.map(r => ({ id: r.id, recorded: r.name, position: r.position, shown: d.players.get(r.id)?.name || '' })),
        choices: d.sides[k].client.map(c => ({ name: c.name, position: c.position || '' })),
      }])) } : null,
    saved: savedList(),
    paused: run.pausedAt !== null, position: p, recordedOn: run.started,
    jumps: run.jumps.map(({ id, label, at: t }) => ({ id, label, at: t })) };
}

// A Stream Deck key (/deck/practice/...): play, pause, toggle, stop, next and prev (the next or previous jump: the
// start, each quarter, full time), and nudge/<ms> (+ or -). { status, body } or null when it isn't a practice link.
function deck(parts: string[]) {
  if (parts[0] !== 'practice') return null;
  const verb = parts[1];
  if (!['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'nudge'].includes(verb)) return { status: 404, body: { error: `Unknown practice link /deck/practice/${verb || ''}. Use play, pause, toggle, stop, next, prev or nudge/<ms>.` } };
  if (!run) return { status: 409, body: { error: 'No practice game is running.', ...state() } };
  let error = null;
  if (verb === 'stop') error = stop();
  else if (verb === 'nudge') error = nudge(parts[2]);
  else if (verb === 'play' || verb === 'pause' || verb === 'toggle') error = pause(verb === 'toggle' ? run.pausedAt === null : verb === 'pause');
  else {
    // Back goes to the start of the part it's in, or the one before when it's only just begun.
    const p = position();
    const j = verb === 'next' ? run.jumps.find(x => x.at > p + 1000) : [...run.jumps].reverse().find(x => x.at < p - 3000);
    error = j ? jump(j.id) : `There's nothing ${verb === 'next' ? 'further on' : 'further back'} to jump to.`;
  }
  return error ? { status: 400, body: { error, ...state() } } : { status: 200, body: state() };
}

// /api/practice: GET where it is and the saved demos (/api/practice/games: the demo game picker's choices); POST
// { start: { recording, game, from, lead, demo, rerun } | { saved, lead, rerun } } | { pair: { id, name } } | { save: name } | { forget: name } | { pause: true|false } | { jump, lead } | { nudge: ms } | { stop: true }.
async function route(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL, { send: reply, readBody }: { send: Send; readBody: ReadBody }) {
  // The client's divisions, and a division's finished games (?division=<PlayHQ id>), to pick a demo game's.
  if (url.pathname === '/api/practice/games') {
    try { reply(res, 200, await hooks.choices(url.searchParams.get('division') || '')); }
    catch (err) { reply(res, 502, { error: `Couldn't read your competition's games from PlayHQ: ${errorMessage(err)}`, divisions: [], games: [] }); }
    return true;
  }
  if (url.pathname !== '/api/practice') return false;
  if (req.method === 'POST') {
    const body = await readBody(req);
    let error: string | null = null;
    try {
      if (body.start) error = await start(body.start);
      else if (body.forget !== undefined) error = forget(String(body.forget));
      else if (!run) error = 'No practice game is running.';
      else if (body.stop) error = stop();
      else if (typeof body.pause === 'boolean') error = pause(body.pause);
      else if (body.pair) error = pair(String(obj(body.pair).id || ''), String(obj(body.pair).name || ''));

      else if (body.save !== undefined) error = save(body.save);
      else if (body.jump) error = jump(String(body.jump), body.lead);
      else if (body.nudge !== undefined) error = nudge(body.nudge);
      else error = 'Send { start }, { pause }, { jump }, { nudge } or { stop }.';
    } catch (err) { error = errorMessage(err); }
    if (error) { reply(res, 400, { error, ...state() }); return true; }
  }
  reply(res, 200, state());
  return true;
}

export { init, active, answer, live, start, stop, pause, jump, nudge, state, route, deck, shift, load };
