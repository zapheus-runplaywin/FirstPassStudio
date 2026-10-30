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
// A demo game is a practice game wearing the client's competition (the one in use): a historic game of theirs is
// picked, and only its teams and athletes are taken from it. Everything else, the score, clock, quarters, moments
// and timing, comes from the recording. Under the hood the recorded game's two teams become the historic game's
// (Swap puts them the other way round, so the client's team can be the winner), the recorded division's other teams
// become the client's division's others (so the ladder and fixtures are theirs), and the recorded athletes become
// the historic game's by position (a recorded GS's goals are the client's GS's); one with no match is left unnamed,
// so their goals go to the team. The division's PlayHQ id is translated to the recorded one, and anything the
// recording doesn't have (the client's competition, seasons and divisions) is asked of PlayHQ as usual.
//
// hooks (init): read(recording) the recording's lines, reset() forget what was read from PlayHQ, snapshot() and
// restore(s) the scoreboard, select(game) pick the game on the scoreboard, paused(on) pause the night's recording,
// choices(gradeId) the client's divisions and a division's finished games, for picking one,
// demo(gameId, gradeId) the client's historic game ({ division, gradeId, teams, home, away }, each side { name,
// players: [{ name, playhqId, position, gender, private }] }), positionOf(player) a PlayHQ line up entry's position.

'use strict';

const LEAD_MIN = 5; // Start: this many minutes before the game's scheduled start, unless another is picked (0 to 60)
const leadMs = m => Math.max(0, Math.min(60, Number.isFinite(Number(m)) && m !== '' && m !== null ? Number(m) : LEAD_MIN)) * 60000;
const PERIODS = { FIRST_QTR: 'Q1', SECOND_QTR: 'Q2', THIRD_QTR: 'Q3', FOURTH_QTR: 'Q4', FIRST_HALF: '1st half', SECOND_HALF: '2nd half' };

let log = () => {};
let hooks = { read: () => [], reset() {}, snapshot: () => null, restore() {}, select() {}, paused() {}, demo: async () => { throw new Error('Demo games need Studio.'); }, choices: async () => ({ divisions: [], games: [] }), positionOf: p => (p.playerPosition && p.playerPosition.shortName) || '' };
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
// The GraphQL answer's data. When the recording never asked that: an error, or, in a demo game, undefined, and
// PlayHQ is asked (the client's competition, seasons and divisions).
function answer(op, vars) {
  const d = run.demo;
  const asked = d ? Object.fromEntries(Object.entries(vars || {}).map(([k, v]) => [k, d.ids.get(v) || v])) : vars;
  const list = run.answers.get(`${op} ${JSON.stringify(asked || {})}`);
  if (!list) {
    if (d) return undefined;
    throw new Error(`The practice game's recording has no answer for ${op}.`);
  }
  const data = shift(at(list).data, gap());
  return d ? wear(data, d) : data;
}
// The live scoring answer ({ data } or { errors }), as PlayHQ sent it.
function live(gameId) {
  const list = run.live.get(gameId);
  if (!list) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  return shift(at(list).json, gap());
}

// ─── Demo games ─────────────────────────────────────────────────────────────
// The recorded game's line ups (its last discoverGame answer), the recorded division's teams (its ladder, else the
// night's fixtures) and its PlayHQ id.
function recorded(loaded) {
  const last = list => (list && list.length ? list[list.length - 1].data : null);
  const game = last(loaded.answers.get(`discoverGame ${JSON.stringify({ gameID: loaded.game.id })}`));
  const names = [loaded.game.home.name, loaded.game.away.name];
  let gradeId = '', teams = [];
  for (const [key, list] of loaded.answers) {
    if (!key.startsWith('gradeLadder ')) continue;
    const standings = (((last(list) || {}).discoverGrade || {}).ladder || []).flatMap(l => l.standings || []);
    const ladder = standings.map(s => (s.team && s.team.name) || '').filter(Boolean);
    if (names.some(n => ladder.includes(n))) { gradeId = JSON.parse(key.slice(12)).gradeID || ''; teams = ladder; break; }
  }
  if (!gradeId) {
    for (const [key, list] of loaded.answers) {
      if (!key.startsWith('gradeRounds ')) continue;
      const rounds = (((last(list) || {}).discoverGrade || {}).rounds || []);
      if (rounds.some(r => r.id === loaded.game.roundId)) { gradeId = JSON.parse(key.slice(12)).gradeID || ''; break; }
    }
  }
  if (!teams.length) {
    for (const [key, list] of loaded.answers) {
      if (!key.startsWith('discoverFixtureByRound ')) continue;
      const games = (((last(list) || {}).discoverFixtureByRound || {}).games || []);
      if (!games.some(g => names.includes(g.home && g.home.name))) continue;
      for (const g of games) for (const s of [g.home, g.away]) if (s && s.name && !teams.includes(s.name)) teams.push(s.name);
    }
  }
  return { game: game && game.discoverGame, gradeId, teams };
}

// What the demo game wears: { teams: recorded name -> client's, players: recorded PlayHQ id -> client's athlete (or
// null: unnamed), ids: client's PlayHQ ids -> recorded, home, away, division, swap }.
async function dress(loaded, { game: clientGame, division: clientGrade, swap } = {}) {
  const client = await hooks.demo(clientGame, clientGrade);
  const rec = recorded(loaded);
  const side = { home: swap ? 'away' : 'home', away: swap ? 'home' : 'away' };
  const teams = new Map([[loaded.game.home.name, client[side.home].name], [loaded.game.away.name, client[side.away].name]]);
  const others = (client.teams || []).filter(n => ![...teams.values()].includes(n));
  for (const n of rec.teams) if (!teams.has(n) && others.length) teams.set(n, others.shift());
  const players = new Map();
  for (const k of ['home', 'away']) {
    const pool = [...(client[side[k]].players || [])];
    const recPlayers = (((rec.game || {}).statistics || {})[k] || {}).players || [];
    const unmatched = [];
    for (const p of recPlayers) {
      const id = p.player && p.player.id;
      if (!id) continue;
      const pos = hooks.positionOf(p);
      const i = pos ? pool.findIndex(c => c.position === pos) : -1;
      if (i >= 0) players.set(id, pool.splice(i, 1)[0]);
      else unmatched.push(id);
    }
    // Recorded athletes with no position match take the historic game's others (the bench) in order.
    for (const id of unmatched) players.set(id, pool.shift() || null);
  }
  const ids = new Map();
  if (client.gradeId && rec.gradeId) ids.set(client.gradeId, rec.gradeId);
  return { teams, players, ids, swap: !!swap, division: client.division || '', game: clientGame,
    home: client[side.home].name, away: client[side.away].name,
    athletes: [...players.values()].filter(Boolean).length };
}

// A recorded answer in the client's names: team names swapped by name, and athletes by their PlayHQ id.
function wear(value, d) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      const who = v.player && v.player.id;
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
// historic game and its division's PlayHQ id, for a demo game.
async function start({ recording, game: gameId, from = 'start', lead, demo } = {}) {
  if (run) stop();
  const loaded = load(recording, gameId, lead);
  if (demo) loaded.demo = await dress(loaded, demo);
  const jump = loaded.jumps.find(j => j.id === from) || loaded.jumps[0];
  const snap = hooks.snapshot();
  hooks.paused(true);
  run = { ...loaded, snap, from: jump.at, startedAt: Date.now(), pausedAt: null };
  hooks.reset();
  pick();
  log('info', 'practice', `${loaded.demo ? `Demo game ${loaded.demo.home} v ${loaded.demo.away} (${loaded.demo.athletes} athletes matched), playing` : 'Practice game'} ${loaded.game.home.name} v ${loaded.game.away.name} from ${recording}, at ${jump.label}`);
  return null;
}

// Picks the game on the scoreboard, with its date and time moved to now.
function pick() {
  const g = run.demo ? { ...run.game, division: run.demo.division || run.game.division, home: { name: run.demo.teams.get(run.game.home.name) }, away: { name: run.demo.teams.get(run.game.away.name) } } : run.game;
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
  const d = run.demo;
  return { active: true, recording: run.recording, game: d ? { ...run.game, division: d.division || run.game.division, home: { name: d.home }, away: { name: d.away } } : run.game,
    demo: d ? { recorded: { home: run.game.home.name, away: run.game.away.name }, swap: d.swap, athletes: d.athletes, game: d.game } : null,
    paused: run.pausedAt !== null, position: p, recordedOn: run.started,
    jumps: run.jumps.map(({ id, label, at: t }) => ({ id, label, at: t })) };
}

// /api/practice: GET where it is (/api/practice/games: the demo game picker's choices); POST { start: { recording, game, from, lead, demo } } | { pause: true|false } | { jump, lead } | { stop: true }.
async function route(req, res, url, { send: reply, readBody }) {
  // The client's divisions, and a division's finished games (?division=<PlayHQ id>), to pick a demo game's.
  if (url.pathname === '/api/practice/games') {
    try { reply(res, 200, await hooks.choices(url.searchParams.get('division') || '')); }
    catch (err) { reply(res, 502, { error: `Couldn't read your competition's games from PlayHQ: ${err.message}`, divisions: [], games: [] }); }
    return true;
  }
  if (url.pathname !== '/api/practice') return false;
  if (req.method === 'POST') {
    const body = await readBody(req);
    let error = null;
    try {
      if (body.start) error = await start(body.start);
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
