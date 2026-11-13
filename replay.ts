// FirstPass Studio - 4K replay: a recorded night's graphics played again, exactly as they went to air.
//
// A replay plays a recording's on-air layer (recorder.js: scene, board, api) back through Studio's own pages: the
// scene pages and every output are sent the recorded scene and scoreboard instead of the live ones, and a graphic's
// read (GET /api/...) is answered with what it was answered on the night. With the Output page's 4K on, the outputs
// send it at 2160p, so a 4K switcher or recorder can key it over the 4K camera recording of the game. Studio never
// plays the video: start both together (a sync point and the nudge get it to the frame).
//
// The recorded times are moved to now, as for a practice game (practice.js shift()), so the clock and anything timed
// carries on as it did. While a replay runs nothing live goes to the pages, the scene and scoreboard can't be
// changed (so the live setup is never touched), the night's recording is paused and no sponsor exposure is kept.
// Stop puts the live scene and scoreboard back on the pages.
//
// Controls (the Recordings tab): Play, Pause, nudge (a frame either way, or a second), and jump to anything that went
// on air (a source coming on, a quarter starting), which pauses there: pause the video on the same moment, then
// Play both.
//
// Or the replay follows the timecode of the player with the video (Follow): a HyperDeck over the network
// (hyperdeck.js), or whatever sends SDI into the UltraStudio (sditimecode.js). The timecode, as a time of day, is the
// moment of the night to show, so playing, pausing and scrubbing the player drive the graphics and they never
// drift. The two clocks (the player's timecode and this Mac's) can differ, so the offset between them is kept for
// each recording: the nudge moves it, and Jump there sets it (the video is at that moment now). Saved in replay.json
// in the local data folder: { follow: 'none' | 'hyperdeck' | 'sdi', hyperdeck (its address), offsets: { recording: ms } }.
//
// hooks (init): read(recording), shift(value, ms), scene(state or null) and board(json or null) put the replay on the
// pages (null: live again), paused(on) pause the night's recording, timecodes ({ hyperdeck, sdi }: hyperdeck.js and
// sditimecode.js, each with follow, now, state), settings (replay.json's path).


const TICK_MS = 20;
const FRAME_MS = 40; // one frame at 25 fps, the nudge's smallest step

import fs from 'node:fs';
import * as savefile from './savefile';
import { errorMessage } from './errors';
import { isObj, obj, str } from './check';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Line } from './recorder';
import type { Log, ReadBody, Send } from './types';

type Follow = 'none' | 'hyperdeck' | 'sdi';
// A timecode the replay can follow (hyperdeck.ts, sditimecode.ts): ms is the time of day the player is at.
interface Timecode {
  follow(to: unknown): void; now(): { ms: number; playing: boolean } | null; state(): unknown; parseAddress?(text: unknown): unknown;
}
interface Hooks {
  read(recording: string): Line[]; shift<T>(value: T, ms: number): T; scene(state: unknown): void; board(json: unknown): void; paused(on: boolean): void;
  timecodes: { hyperdeck?: Timecode & { parseAddress(text: unknown): unknown }; sdi?: Timecode }; settings: string;
}
// A moment of a timeline: what was on air from t.
type Entry = { t: number; value: unknown };
type Loaded = ReturnType<typeof load>;
interface Run extends Loaded { from: number; startedAt: number; pausedAt: number | null; sentScene: number; sentBoard: number }

let log: Log = () => {};
let hooks: Hooks = { read: () => [], shift: v => v, scene() {}, board() {}, paused() {}, timecodes: {}, settings: '' };
let run: Run | null = null;
let timer: NodeJS.Timeout | undefined;
let saved: { follow: Follow; hyperdeck: string; offsets: Record<string, number> } = { follow: 'none', hyperdeck: '', offsets: {} };
// The replay running: only called where one is.
function cur(): Run {
  if (!run) throw new Error('No replay is running.');
  return run;
}

function init(logger: Log | null | undefined, h: Partial<Hooks> = {}) {
  log = logger || log;
  hooks = { ...hooks, ...h };
  try {
    const s = obj(JSON.parse(fs.readFileSync(hooks.settings, 'utf8')));
    saved = { follow: s.follow === 'hyperdeck' || s.follow === 'sdi' ? s.follow : 'none', hyperdeck: str(s.hyperdeck).slice(0, 100), offsets: {} };
    for (const [k, v] of Object.entries(obj(s.offsets))) if (typeof v === 'number' && Number.isFinite(v)) saved.offsets[k] = v;
  } catch { /* none saved yet */ }
}
function save() {
  if (!hooks.settings) return;
  try { savefile.writeJsonSync(hooks.settings, saved); } catch (err) { log('warn', 'replay', `Could not save replay.json: ${errorMessage(err)}`); }
}

const active = () => !!run;
const position = () => { const r = cur(); return r.pausedAt !== null ? r.pausedAt : r.from + (Date.now() - r.startedAt); };
const gap = () => Date.now() - position();

// The entry of a timeline (sorted by t) at a time: the last one at or before it.
function indexAt(list: { t: number }[], t: number) {
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

const PERIODS: Record<string, string> = { FIRST_QTR: 'Q1', SECOND_QTR: 'Q2', THIRD_QTR: 'Q3', FOURTH_QTR: 'Q4', FIRST_HALF: '1st half', SECOND_HALF: '2nd half' };
// The sources on in a recorded scene: id -> name.
const onNow = (st: unknown) => new Map((Array.isArray(obj(st).sources) ? obj(st).sources as unknown[] : []).map(obj).filter(s => s.visible).map(s => [str(s.id), str(s.name) || 'A source']));

// A recording's on-air layer: the scene and board timelines, the graphics' reads, and what went on air.
function load(recording: string, gameId?: string) {
  const lines = hooks.read(recording);
  const scene: Entry[] = [], board: Entry[] = [], api = new Map<string, Entry[]>(), events: { t: number; label: string }[] = [];
  let game: Line | null = null;
  for (const l of lines) {
    if (l.k === 'scene') scene.push({ t: l.t, value: l.scene });
    else if (l.k === 'board') board.push({ t: l.t, value: l.board });
    else if (l.k === 'api') { const p = str(l.p), list = api.get(p); if (list) list.push({ t: l.t, value: l.body }); else api.set(p, [{ t: l.t, value: l.body }]); }
    else if (l.k === 'game') {
      events.push({ t: l.t, label: `Game: ${str(l.home)} v ${str(l.away)}` });
      if (l.id === gameId) game = l;
    }
  }
  if (!scene.length && !board.length) throw new Error('This recording has nothing that went to air.');
  // What came on (the primary output's sources), and each quarter as the board started it.
  let was = new Map();
  for (const s of scene) {
    const now = onNow(s.value);
    for (const [id, name] of now) if (!was.has(id)) events.push({ t: s.t, label: `${name} on` });
    was = now;
  }
  let period: unknown = null;
  for (const b of board) {
    const p = obj(b.value).period;
    if (p && p !== period) { period = p; events.push({ t: b.t, label: (typeof p === 'string' && PERIODS[p]) || (typeof p === 'number' ? `Q${p}` : String(p)) }); }
  }
  events.sort((a, b) => a.t - b.t);
  const first = Math.min(scene.length ? scene[0].t : Infinity, board.length ? board[0].t : Infinity);
  const last = Math.max(scene.length ? scene[scene.length - 1].t : 0, board.length ? board[board.length - 1].t : 0, ...events.map(e => e.t));
  const g: Line | null = game;
  return { recording, scene, board, api, events, first, last, start: g ? g.t : first, game: g && { id: str(g.id), home: str(g.home), away: str(g.away) } };
}

// ─── Following a HyperDeck ─────────────────────────────────────────────────
// The timecode followed (hyperdeck.js or sditimecode.js), or null.
const source = () => (saved.follow !== 'none' && hooks.timecodes[saved.follow]) || null;
const following = () => !!(run && source());
const offset = () => (run && saved.offsets[run.recording]) || 0;

// The moment of the night a timecode (ms of the day) is: on the day of the game, or the day before or after it, for
// a night that goes past midnight.
function nightOf(ms: number) {
  const { start } = cur();
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  let best = NaN;
  for (const day of [-1, 0, 1]) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day).getTime() + ms + offset();
    if (Number.isNaN(best) || Math.abs(t - start) < Math.abs(best - start)) best = t;
  }
  return best;
}

// Moves the replay to where the HyperDeck is. While it plays, the replay plays too, and only moves again if the two
// have slipped apart by more than two frames (the HyperDeck answers to the frame, a few times a second).
function followTimecode() {
  const r = cur(), n = source()?.now();
  if (!n) return; // not answering: the replay stays where it is
  const t = nightOf(n.ms);
  if (n.playing) {
    if (r.pausedAt !== null || Math.abs(position() - t) > 2 * FRAME_MS) { r.from = t; r.startedAt = Date.now(); r.pausedAt = null; r.sentBoard = -2; }
  } else if (r.pausedAt === null || Math.abs(r.pausedAt - t) >= 1) {
    r.pausedAt = t;
    r.sentBoard = -2;
  }
}

// Only the one followed is connected, and only while a replay runs.
function connectFollow() {
  const { hyperdeck, sdi } = hooks.timecodes;
  if (hyperdeck) hyperdeck.follow(run && saved.follow === 'hyperdeck' ? hyperdeck.parseAddress(saved.hyperdeck) : null);
  if (sdi) sdi.follow(run && saved.follow === 'sdi' ? { device: '' } : null);
}

// { kind: 'none' | 'hyperdeck' | 'sdi', address }: what the replay follows, kept for next time.
function setFollow(f: unknown) {
  if (!isObj(f)) return 'Send { follow: { kind, address } }.';
  if (f.kind === 'hyperdeck') {
    const address = f.address !== undefined ? String(f.address).trim() : saved.hyperdeck;
    if (!hooks.timecodes.hyperdeck || !hooks.timecodes.hyperdeck.parseAddress(address)) return "Type the HyperDeck's IP address (as on its setup page), such as 192.168.1.50.";
    saved.follow = 'hyperdeck';
    saved.hyperdeck = address;
  } else if (f.kind === 'sdi' && hooks.timecodes.sdi) saved.follow = 'sdi';
  else if (f.kind === 'none') saved.follow = 'none';
  else return 'Follow a HyperDeck (kind: hyperdeck), the SDI input (kind: sdi) or nothing (kind: none).';
  save();
  connectFollow();
  if (run) { run.sentBoard = -2; tick(); }
  return null;
}

// ─── Playing ────────────────────────────────────────────────────────────────
// Sends what was on air at the position, when it's another entry than last sent (or always, with force).
function tick(force?: boolean) {
  const r = run;
  if (!r) return;
  if (following()) followTimecode();
  const p = position();
  // Before the first recorded scene or board (the night's recording started with Studio), the first one.
  const si = r.scene.length ? Math.max(0, indexAt(r.scene, p)) : -1, bi = r.board.length ? Math.max(0, indexAt(r.board, p)) : -1;
  if (force || si !== r.sentScene) { r.sentScene = si; hooks.scene(si >= 0 ? hooks.shift(r.scene[si].value, gap()) : { sources: [], scenes: [], current: null }); }
  if (force || bi !== r.sentBoard) { r.sentBoard = bi; if (bi >= 0) hooks.board({ ...obj(hooks.shift(r.board[bi].value, gap())), serverNow: Date.now() }); }
  if (r.pausedAt === null && !following() && p > r.last + 60000) pause(true); // past the end: it stands at the last moment
}

function start(given: unknown) {
  const { recording, game, at } = obj(given);
  if (run) stop();
  const loaded = load(str(recording), str(game) || undefined);
  hooks.paused(true);
  const from = typeof at === 'number' && Number.isFinite(at) ? at : loaded.start;
  // starts paused at its point, ready to Play with the video
  run = { ...loaded, from, startedAt: Date.now(), pausedAt: from, sentScene: -2, sentBoard: -2 };
  connectFollow();
  tick(true);
  timer = setInterval(() => { try { tick(); } catch (err) { log('warn', 'replay', `Replay: ${errorMessage(err)}`); } }, TICK_MS);
  if (timer.unref) timer.unref();
  log('info', 'replay', `Replay of ${str(recording)}${loaded.game ? ` (${loaded.game.home} v ${loaded.game.away})` : ''}, paused at its start`);
  return null;
}

function pause(on: boolean) {
  if (following()) return "The player's play and stop drive the replay while it follows its timecode. Set Follow to Nothing to play it here.";
  const run = cur();
  if (on && run.pausedAt === null) run.pausedAt = position();
  if (!on && run.pausedAt !== null) { run.from = run.pausedAt; run.startedAt = Date.now(); run.pausedAt = null; }
  run.sentBoard = -2; // the clock's times move with the pause
  tick();
  return null;
}

// Moves the replay by ms (the nudge), or to a moment (a jump, which pauses there).
function nudge(ms: unknown) {
  const n = Number(ms);
  if (!Number.isFinite(n) || Math.abs(n) > 600000) return 'Nudge by up to 10 minutes either way.';
  const run = cur();
  if (following()) { saved.offsets[run.recording] = offset() + n; save(); run.sentBoard = -2; tick(); return null; } // the graphics move against the video
  if (run.pausedAt !== null) run.pausedAt += n; else run.from += n;
  run.sentBoard = -2;
  tick();
  return null;
}
function seek(t: unknown) {
  const n = Number(t);
  if (!Number.isFinite(n)) return 'Jump to a time in the recording.';
  const run = cur();
  if (following()) {
    // The video is at this moment now: the offset that makes it so.
    const tc = source()?.now();
    if (!tc) return saved.follow === 'sdi' ? 'No timecode is coming into the SDI input yet, so the replay can\'t be synced to it.' : "The HyperDeck isn't answering yet, so the replay can't be synced to it.";
    saved.offsets[run.recording] = offset() + Math.max(run.first, Math.min(run.last, n)) - nightOf(tc.ms);
    save();
    run.sentBoard = -2;
    tick();
    return null;
  }
  run.pausedAt = Math.max(run.first, Math.min(run.last, n));
  run.sentBoard = -2;
  tick();
  return null;
}

function stop() {
  if (!run) return null;
  clearInterval(timer);
  timer = undefined;
  const { recording } = run;
  run = null;
  connectFollow();
  hooks.scene(null);
  hooks.board(null);
  hooks.paused(false);
  log('info', 'replay', `Replay of ${recording} stopped; the pages are live again`);
  return null;
}

// A graphic's read during a replay: what it was answered on the night at this point (the first answer, if it was
// only read later), moved to now; undefined when the recording never had it, and it's answered live.
function answer(pathAndQuery: string) {
  if (!run) return undefined;
  const list = run.api.get(pathAndQuery);
  if (!list) return undefined;
  const i = indexAt(list, position());
  const v = hooks.shift(list[Math.max(0, i)].value, gap());
  return isObj(v) && 'serverNow' in v ? { ...v, serverNow: Date.now() } : v;
}

function followState() {
  const f = { kind: saved.follow, address: saved.hyperdeck };
  const s = run && source();
  return s ? { ...f, [f.kind]: s.state(), offset: offset() } : f;
}

function state() {
  if (!run) return { active: false, follow: followState() };
  return { active: true, recording: run.recording, game: run.game, paused: run.pausedAt !== null, position: position(),
    first: run.first, last: run.last, start: run.start, frameMs: FRAME_MS, events: run.events, follow: followState() };
}

// A Stream Deck key (/deck/replay/...): play, pause, toggle, stop, next and prev (the next or previous thing that went
// on air, which pauses there, as Jump there does), nudge/<ms>. { status, body } or null when it isn't a replay link.
function deck(parts: string[]) {
  if (parts[0] !== 'replay') return null;
  const [, verb, arg] = parts;
  const known = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'nudge'];
  if (!known.includes(verb)) return { status: 404, body: { error: `Unknown replay link /deck/replay/${verb || ''}. Use play, pause, toggle, stop, next, prev or nudge/<ms>.` } };
  if (!run) return { status: 409, body: { error: 'No 4K replay is running.', ...state() } };
  const r = run;
  let error: string | null = null;
  if (verb === 'stop') error = stop();
  else if (verb === 'play' || verb === 'pause' || verb === 'toggle') error = pause(verb === 'toggle' ? r.pausedAt === null : verb === 'pause');
  else if (verb === 'nudge') error = nudge(arg);
  else {
    // From where it stands: the next one on, or back past the one just gone (pressing again goes further back).
    const p = position();
    const ev = verb === 'next' ? r.events.find(e => e.t > p + FRAME_MS / 2) : [...r.events].reverse().find(e => e.t < p - 1000);
    error = ev ? seek(ev.t) : `There's nothing ${verb === 'next' ? 'further on' : 'further back'} to jump to.`;
  }
  return error ? { status: 400, body: { error, ...state() } } : { status: 200, body: state() };
}

// /api/replay: GET where it is; POST { start: { recording, game, at } } | { pause } | { nudge: ms } | { seek: t } | { stop }
// | { follow: { kind: 'none' | 'hyperdeck' | 'sdi', address } }.
async function route(req: IncomingMessage, res: ServerResponse, url: URL, { send: reply, readBody }: { send: Send; readBody: ReadBody }) {
  if (url.pathname !== '/api/replay') return false;
  if (req.method === 'POST') {
    const body = await readBody(req);
    let error: string | null = null;

    try {
      if (body.start) error = start(body.start);
      else if (body.follow !== undefined) error = setFollow(body.follow);
      else if (!run) error = 'No replay is running.';
      else if (body.stop) error = stop();
      else if (typeof body.pause === 'boolean') error = pause(body.pause);
      else if (body.nudge !== undefined) error = nudge(body.nudge);
      else if (body.seek !== undefined) error = seek(body.seek);
      else error = 'Send { start }, { pause }, { nudge }, { seek }, { follow } or { stop }.';
    } catch (err) { error = errorMessage(err); }
    if (error) { reply(res, 400, { error, ...state() }); return true; }
  }
  reply(res, 200, state());
  return true;
}

export { init, active, start, stop, pause, nudge, seek, answer, state, route, deck, load, FRAME_MS };
