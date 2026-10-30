// FirstPass Studio - practice games: a recorded game (recorder.js) played back as if it were live.
//
// While a practice game runs, PlayHQ isn't asked anything: playhq.js asks this module instead (answer() for the
// GraphQL API, live() for live scoring), which gives what PlayHQ said at the same point of the recorded night.
// Everything else in Studio runs as on a real night (the scoreboard follows the score and clock, sequences and
// game triggers fire, the outputs can be on), so it's for rehearsing a night, trying a change and showing
// Studio to someone. The recording is played in real time from a point picked on the Recordings tab (Start, a few
// minutes before the game's scheduled start, as many as Starts in says, each quarter or full time), and can be paused.
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
// hooks (init): read(recording) the recording's lines, reset() forget what was read from PlayHQ, snapshot() and
// restore(s) the scoreboard, select(game) pick the game on the scoreboard, paused(on) pause the night's recording.

'use strict';

const LEAD_MIN = 5; // Start: this many minutes before the game's scheduled start, unless another is picked (0 to 60)
const leadMs = m => Math.max(0, Math.min(60, Number.isFinite(Number(m)) && m !== '' && m !== null ? Number(m) : LEAD_MIN)) * 60000;
const PERIODS = { FIRST_QTR: 'Q1', SECOND_QTR: 'Q2', THIRD_QTR: 'Q3', FOURTH_QTR: 'Q4', FIRST_HALF: '1st half', SECOND_HALF: '2nd half' };

let log = () => {};
let hooks = { read: () => [], reset() {}, snapshot: () => null, restore() {}, select() {}, paused() {} };
let run = null; // the practice game running: see start()

function init(logger, h = {}) {
  log = logger || log;
  hooks = { ...hooks, ...h };
}

const active = () => !!run;

// Where the recording is now (ms since 1970 on the recorded night), and the gap to now.
const position = () => (run.pausedAt !== null ? run.pausedAt : run.from + (Date.now() - run.startedAt));
const gap = () => Date.now() - position();

// ─── Reading a recording ────────────────────────────────────────────────────
const localMs = (date, time) => {
  const t = /^\d{1,2}:\d{2}(:\d{2})?$/.test(time || '') ? (time.length <= 5 ? `${time.padStart(5, '0')}:00` : time.padStart(8, '0')) : '12:00:00';
  const ms = new Date(`${date}T${t}`).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const two = n => String(n).padStart(2, '0');
const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const timeOf = (ms, like) => { const d = new Date(ms); const hm = `${two(d.getHours())}:${two(d.getMinutes())}`; return /^\d{1,2}:\d{2}:\d{2}$/.test(like) ? `${hm}:${two(d.getSeconds())}` : hm; };
const periodOf = g => (g && ((g.clock && (g.clock.periodValue || g.clock.period)) || (g.result && g.result.currentPeriod && g.result.currentPeriod.value))) || '';
const finished = s => /FINAL|COMPLETE|RESULT|FINISH|ENDED/i.test(String((s && s.value) || s || ''));

// A recording's game, ready to play: its answers by question, its live answers, and where it can be played from.
function load(recording, gameId, lead) {
  const lines = hooks.read(recording);
  const chapter = lines.find(l => l.k === 'game' && l.id === gameId);
  if (!chapter) throw new Error(`The recording has no game ${gameId}.`);
  const answers = new Map(); // "op vars" -> [{ t, data }]
  const live = new Map();    // game id -> [{ t, json }]
  for (const l of lines) {
    if (l.k === 'playhq') {
      const key = `${l.op} ${JSON.stringify(l.vars || {})}`;
      (answers.get(key) || answers.set(key, []).get(key)).push({ t: l.t, data: l.data });
    } else if (l.k === 'live') {
      (live.get(l.id) || live.set(l.id, []).get(l.id)).push({ t: l.t, json: l.errors ? { errors: l.errors } : { data: l.data } });
    }
  }
  const b = (lines.find(l => l.k === 'board' && l.board && l.board.gameId === gameId) || {}).board || {};
  const game = { id: gameId, roundId: b.roundId || '', division: chapter.division || b.division || '', court: chapter.court || b.court || '',
    round: chapter.round || b.round || '', date: b.date || '', time: b.time || '', venue: b.venue || '',
    home: { name: chapter.home || (b.home || {}).name || 'Home' }, away: { name: chapter.away || (b.away || {}).name || 'Away' } };
  const scheduled = (game.date && localMs(game.date, game.time)) || chapter.t;
  // Where it can be played from: Start, each period as the scorer started it, and full time.
  const jumps = [{ id: 'start', label: 'Start', at: scheduled - leadMs(lead) }];
  const seen = new Set();
  for (const a of live.get(gameId) || []) {
    const g = a.json.data && a.json.data.game;
    if (!g) continue;
    const p = periodOf(g);
    if (p && !seen.has(p)) { seen.add(p); jumps.push({ id: p, label: PERIODS[p] || p, at: a.t }); }
    if (finished(g.status)) { jumps.push({ id: 'end', label: 'Full time', at: a.t }); break; }
  }
  return { recording, game, chapter, answers, live, jumps, scheduled, started: lines.length ? lines[0].t : chapter.t };
}

// ─── Moving the recorded night to now ───────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A copy of a recorded answer with every date and time moved by ms.
function shift(value, ms) {
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map(x => walk(x, key));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      // A game's date with its time beside it (or in its allocation): moved together, as one moment.
      if (typeof v.date === 'string' && DATE.test(v.date)) {
        const holder = typeof v.time === 'string' ? o : v.allocation && typeof v.allocation.time === 'string' ? o.allocation : null;
        const at = localMs(v.date, holder ? holder.time : '12:00');
        if (at !== null) {
          const moved = at + ms;
          o.date = dateOf(moved);
          if (holder) holder.time = timeOf(moved, holder.time);
          if (Array.isArray(v.dates)) o.dates = v.dates.map(d => (d === v.date ? o.date : d));
        }
      }
      return o;
    }
    if (typeof v === 'string' && ISO.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + ms).toISOString() : v; }
    if (/At$/.test(key || '') && /^\d{13}$/.test(String(v))) return typeof v === 'number' ? v + ms : String(Number(v) + ms);
    return v;
  };
  return walk(value, '');
}

// The answer recorded for a question at this point of the night: the last one before it, or the first one there is.
function at(list) {
  const now = position();
  let pick = list[0];
  for (const a of list) { if (a.t <= now) pick = a; else break; }
  return pick;
}

// ─── What playhq.js asks while a practice game runs ─────────────────────────
// The GraphQL answer's data, or an error when the recording never asked that.
function answer(op, vars) {
  const list = run.answers.get(`${op} ${JSON.stringify(vars || {})}`);
  if (!list) throw new Error(`The practice game's recording has no answer for ${op}.`);
  return shift(at(list).data, gap());
}
// The live scoring answer ({ data } or { errors }), as PlayHQ sent it.
function live(gameId) {
  const list = run.live.get(gameId);
  if (!list) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  return shift(at(list).json, gap());
}

// ─── Running one ────────────────────────────────────────────────────────────
// lead: Start's minutes before the scheduled start (0 to 60, else 5).
function start({ recording, game: gameId, from = 'start', lead } = {}) {
  if (run) stop();
  const loaded = load(recording, gameId, lead);
  const jump = loaded.jumps.find(j => j.id === from) || loaded.jumps[0];
  const snap = hooks.snapshot();
  hooks.paused(true);
  run = { ...loaded, snap, from: jump.at, startedAt: Date.now(), pausedAt: null };
  hooks.reset();
  pick();
  log('info', 'practice', `Practice game ${loaded.game.home.name} v ${loaded.game.away.name} from ${recording}, at ${jump.label}`);
  return null;
}

// Picks the game on the scoreboard, with its date and time moved to now.
function pick() {
  const g = run.game;
  const at0 = g.date ? localMs(g.date, g.time) : null;
  const moved = at0 === null ? {} : { date: dateOf(at0 + gap()), time: g.time ? timeOf(at0 + gap(), g.time) : '' };
  hooks.select({ ...g, ...moved });
}

// lead (with Start): the minutes before the scheduled start to start from this time.
function jump(id, lead) {
  if (id === 'start' && lead !== undefined) run.jumps[0].at = run.scheduled - leadMs(lead);
  const j = run.jumps.find(x => x.id === id);
  if (!j) return `There's no ${id} in this game.`;
  run.from = j.at;
  run.startedAt = Date.now();
  if (run.pausedAt !== null) run.pausedAt = j.at;
  hooks.reset();
  pick();
  log('info', 'practice', `Practice game moved to ${j.label}`);
  return null;
}

function pause(on) {
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
  if (!run) return { active: false };
  const p = position();
  return { active: true, recording: run.recording, game: run.game, paused: run.pausedAt !== null, position: p, recordedOn: run.started,
    jumps: run.jumps.map(({ id, label, at: t }) => ({ id, label, at: t })) };
}

// /api/practice: GET where it is; POST { start: { recording, game, from, lead } } | { pause: true|false } | { jump, lead } | { stop: true }.
async function route(req, res, url, { send: reply, readBody }) {
  if (url.pathname !== '/api/practice') return false;
  if (req.method === 'POST') {
    const body = await readBody(req);
    let error = null;
    try {
      if (body.start) error = start(body.start);
      else if (!run) error = 'No practice game is running.';
      else if (body.stop) error = stop();
      else if (typeof body.pause === 'boolean') error = pause(body.pause);
      else if (body.jump) error = jump(String(body.jump), body.lead);
      else error = 'Send { start }, { pause }, { jump } or { stop }.';
    } catch (err) { error = err.message; }
    if (error) { reply(res, 400, { error, ...state() }); return true; }
  }
  reply(res, 200, state());
  return true;
}

module.exports = { init, active, answer, live, start, stop, pause, jump, state, route, shift, load };
