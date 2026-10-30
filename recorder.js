// FirstPass Studio - game recordings: what PlayHQ said and what went to air, timed, for each PlayHQ game on air.
//
// Each PlayHQ game the scoreboard has on is one recording, while Studio is on air: a file in the Recordings folder
// of the local data folder (it stays on this Mac when the settings are in iCloud Drive), named after when it
// started and the game ("2026-10-30 1905 Stormz v Semi Pro.jsonl.gz"). It starts when the game is due on the board
// (as many minutes before its scheduled start as the competition setup page's automatic game selection says, 10 by
// default) and stops a set time after PlayHQ says it's finished (afterMinutes, 10 by default), when the board
// moves on to another game, or when Studio goes off air. Being on air with no PlayHQ game due records nothing.
// So each recording stands on its own, it starts with the last of everything already known (what PlayHQ said, the
// scene, the board, the graphics' reads). Each line is one thing that happened, as JSON, with t (ms since 1970)
// and k (its kind):
//   start     the recording's start: Studio's version, the competition, the time zone
//   game      the game it's of (id, teams, division, round, court)
//   playhq    a PlayHQ answer (playhq.js gql): op, vars, tenant, data
//   live      an answer from PlayHQ's live scoring (fetchLive): id, and data or errors
//   action    a scoreboard action (board.js applyAction): from the control page, the Stream Deck or Studio itself
//   scene     the scene the pages were sent (scene.js notify), when it changed
//   board     the board the pages were sent (scene.js publishBoard), when it changed (not the clock reading)
//   api       an answer a graphic fetched (GET /api/...), when it changed: p (the path and query) and body
//   practice  a practice game started (on: true) or stopped (practice.js); nothing is recorded in between
//   end       the recording stopped: why (full time, next game, off air, recording off, too long)
// The first two layers (playhq, live, action) are what came in, for practice games and tests; the rest (scene,
// board, api) is what went to air, for replaying the graphics at 4K. Nothing secret is recorded: no keys,
// cookies, devices or private answers (access.PRIVATE, /api/setup...), and only what graphics asked for, not the
// Studio pages.
//
// Lines are kept in memory and written every few seconds as a gzip member of their own, so a recording is always
// readable up to its last write, even if Studio stopped suddenly. A recording with no game in it (made before
// recordings followed the game) is removed when Studio next starts, and one older than KEEP_DAYS days too.
// Recording can be turned off, and the minutes after full time set, on the Recordings page (recordings.json in the
// local data folder, as the recordings are this Mac's: { record, afterMinutes }).

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KEEP_DAYS = 60;
const FLUSH_MS = 5000;
const CHECK_MS = 5000;          // how often it checks whether a game is due or done
const AFTER_MIN = 10;           // minutes recorded after full time, unless another is set (0 to 60)
const LONGEST_MS = 4 * 3600000; // a game PlayHQ never says is finished (scored by hand) stops this long after its start
const LATEST_MAX = 2000;        // the last of everything kept for a new recording's start, at most this many
// "2026-10-30 1905.jsonl.gz" (before recordings followed the game) or "2026-10-30 1905 Stormz v Semi Pro.jsonl.gz".
const NAME = /^\d{4}-\d{2}-\d{2} \d{4}(?: [^/\\]{1,80}?)?(?:-\d+)?\.jsonl\.gz$/;
const FINISHED = /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i;

let log = () => {};
let dir = '', settingsFile = '', file = '', name = '';
let record = true;
let afterMinutes = AFTER_MIN;
let pending = [];
let timer = null, checker = null;
let startLine = () => ({});
let leadMs = () => 10 * 60000;
const last = new Map();   // what was last recorded for a key, so only a change is
const latest = new Map(); // key -> { k, data, same }: the last of everything, recorded or not, for a recording's start
let gameId = null;        // the game being recorded
let onBoard = null;       // the board as last sent: its game, scheduled time and PlayHQ status
let finishedAt = 0;       // when PlayHQ first said the game being recorded was finished
const done = new Set();   // games whose recording has stopped (full time, too long), not started again
let paused = false; // a practice game is running (practice.js): only its start and end are recorded
const listed = new Map(); // name -> { mtimeMs, size, summary }

const two = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;

// dir: the Recordings folder; settings: recordings.json; start: what the start line says ({ version, competition }),
// or a function giving it; lead: how long before a game's scheduled start it's due (games.js leadMs).
function init(logger, { dir: recordingsDir, settings, start = {}, lead } = {}) {
  log = logger || log;
  dir = recordingsDir;
  settingsFile = settings;
  startLine = typeof start === 'function' ? start : () => start;
  if (lead) leadMs = lead;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch { /* none yet */ }
  record = saved.record !== false;
  afterMinutes = minutes(saved.afterMinutes);
  fs.mkdirSync(dir, { recursive: true });
  tidy();
  clearInterval(checker);
  checker = setInterval(check, CHECK_MS);
  checker.unref();
}

const lead = () => { try { return Number(leadMs()) || 0; } catch { return 10 * 60000; } };
const minutes = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(60, Math.max(0, Math.round(Number(v)))) : AFTER_MIN);
// The game's scheduled start ("2026-10-30" and "19:05"), in ms, or null when the board doesn't say.
function startOf(b) {
  const m = String(b.time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!b.date || !m) return null;
  const ms = new Date(`${b.date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}
const teams = b => `${(b.home || {}).name || 'Home'} v ${(b.away || {}).name || 'Away'}`;
const fileLabel = b => teams(b).replace(/[^\p{L}\p{N} '&().,-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();

// Whether the board's game should be recording now, else why not: { due, from, why }.
function dueOf(b, now = Date.now()) {
  if (!b || !b.gameId) return { due: false, why: 'no PlayHQ game on the scoreboard' };
  if (done.has(b.gameId)) return { due: false, why: 'its recording has stopped' };
  const start = startOf(b);
  const from = start === null ? null : start - lead();
  if (from !== null && now < from) return { due: false, from, why: 'not due yet' };
  if (start !== null && now > start + LONGEST_MS) return { due: false, why: 'it was too long ago' };
  if (gameId !== b.gameId && FINISHED.test(b.playhqStatus || '')) return { due: false, why: 'PlayHQ says it\'s finished' };
  return { due: true, from };
}

// Starts, stops or changes the recording to match the board's game.
function check(now = Date.now()) {
  if (!record || paused) return;
  const b = onBoard;
  if (file && (!b || b.gameId !== gameId)) close('next game');
  if (file && b) {
    if (!finishedAt && FINISHED.test(b.playhqStatus || '')) finishedAt = now;
    const start = startOf(b);
    if (finishedAt && now >= finishedAt + afterMinutes * 60000) { done.add(gameId); close('full time'); }
    else if (start !== null && now > start + LONGEST_MS) { done.add(gameId); close('too long'); }
  }
  if (!file && dueOf(b, now).due) begin(b);
}

function begin(b) {
  const base = `${stamp(new Date())} ${fileLabel(b)}`.trim();
  name = `${base}.jsonl.gz`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.jsonl.gz`;
  file = path.join(dir, name);
  last.clear();
  gameId = b.gameId;
  finishedAt = 0;
  const start = startLine() || {};
  note('start', { version: start.version || '', competition: start.competition || '', zone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  note('game', { id: b.gameId, home: (b.home || {}).name || '', away: (b.away || {}).name || '', division: b.division || '',
    round: b.round || '', court: b.court || '', competition: b.competition || '' });
  // The last of everything already known, so the recording has the fixture, the scene and the board from its start.
  for (const [key, l] of latest) { last.set(key, l.same); note(l.k, l.data); }
  flush();
  log('info', 'recorder', `Recording ${teams(b)} to Recordings/${name}`);
  clearInterval(timer);
  timer = setInterval(flush, FLUSH_MS);
  timer.unref();
}

function note(k, data) {
  if (!file || (paused && k !== 'practice' && k !== 'end')) return;
  pending.push(JSON.stringify({ t: Date.now(), k, ...data }));
}

// Records data under key only when it isn't what was last recorded there, and keeps it for the next recording's start.
function changed(k, key, data, same = JSON.stringify(data)) {
  if (paused) return;
  latest.delete(key);
  latest.set(key, { k, data, same });
  if (latest.size > LATEST_MAX) latest.delete(latest.keys().next().value);
  if (!file || last.get(key) === same) return;
  last.set(key, same);
  note(k, data);
}

function flush() {
  if (!file || !pending.length) return;
  const lines = pending.join('\n') + '\n';
  pending = [];
  try { fs.appendFileSync(file, zlib.gzipSync(lines)); }
  catch (err) { log('warn', 'recorder', `Could not write the recording: ${err.message}`); }
}

// A practice game started (on) or stopped: nothing it does is recorded, and after it everything is recorded afresh.
function pause(on) {
  note('practice', { on: !!on });
  paused = !!on;
  last.clear();
  if (!paused) setImmediate(check);
}

// The recording stops (why: full time, next game, off air, recording off, too long): the end line, written straight away.
function close(why = 'off air') {
  if (!file) return;
  note('end', { why });
  flush();
  clearInterval(timer);
  log('info', 'recorder', `Recording stopped (${why}): Recordings/${name}`);
  file = '';
  gameId = null;
}

// ─── What's recorded ────────────────────────────────────────────────────────
function playhq(op, vars, tenant, data) { changed('playhq', `playhq ${op} ${tenant} ${JSON.stringify(vars)}`, { op, vars, tenant, data }); }
function live(id, json) { changed('live', `live ${id}`, { id, ...(json.errors && json.errors.length ? { errors: json.errors } : { data: json.data }) }); }
function action(a) { if (a && typeof a === 'object') note('action', { action: a }); }
function scene(state, text) { changed('scene', 'scene', { scene: state }, text); }
function board(json) {
  if (!json || paused) return;
  onBoard = json;
  if (file && json.gameId !== gameId) close('next game'); // before the next game's board is recorded
  changed('board', 'board', { board: json }, sameness(json));
  check();
}
// An answer Studio sent (server.js send): kept when it's a graphic's GET /api/... read (isGraphic) that worked.
function answer(req, status, body, type, isGraphic) {
  if (!file || !req || req.method !== 'GET' || status !== 200 || (type && !/json/.test(type))) return;
  const u = new URL(req.url, 'http://localhost');
  if (!u.pathname.startsWith('/api/') || !isGraphic(u.pathname, req.headers)) return;
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body);
  let parsed;
  try { parsed = JSON.parse(text); } catch { return; }
  const p = u.pathname + u.search;
  changed('api', `api ${p}`, { p, body: parsed }, sameness(parsed, text));
}
// What says whether an answer changed: not the clock reading (serverNow, clockElapsedMs), which changes every time
// and is worked out again from the clock's start on replay.
function sameness(json, text) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !('serverNow' in json || 'clockElapsedMs' in json)) return text ?? JSON.stringify(json);
  const { serverNow, clockElapsedMs, ...rest } = json;
  return JSON.stringify(rest);
}

// ─── Reading recordings ─────────────────────────────────────────────────────
// Every line of a recording (read up to its last whole write).
function read(recording) {
  const f = path.join(dir, recording);
  if (f === file) flush();
  const text = zlib.gunzipSync(fs.readFileSync(f), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a line cut off */ }
  }
  return out;
}

// { name, started, ended, size, recording (this one is being written), games: [{ id, home, away, division, round, court, at }] }
function summary(recording) {
  const f = path.join(dir, recording);
  if (f === file) flush();
  const st = fs.statSync(f);
  const k = listed.get(recording);
  let s = k && k.mtimeMs === st.mtimeMs && k.size === st.size ? k.summary : null;
  if (!s) {
    const lines = read(recording);
    const start = lines.find(l => l.k === 'start') || lines[0] || {};
    s = { started: start.t || st.mtimeMs, ended: lines.length ? lines[lines.length - 1].t : st.mtimeMs, competition: start.competition || '',
      games: lines.filter(l => l.k === 'game').map(({ t, k: kind, ...g }) => ({ ...g, at: t })), lines: lines.length };
    listed.set(recording, { mtimeMs: st.mtimeMs, size: st.size, summary: s });
  }
  return { name: recording, size: st.size, recording: path.join(dir, recording) === file, ...s };
}

function names() {
  try { return fs.readdirSync(dir).filter(n => NAME.test(n)).sort().reverse(); } catch { return []; }
}

function list() {
  const out = [];
  for (const n of names()) {
    try { out.push(summary(n)); } catch (err) { log('warn', 'recorder', `Could not read Recordings/${n}: ${err.message}`); }
  }
  return out;
}

// Removes recordings older than KEEP_DAYS days, and ones with no game in them (made before recordings followed the game).
function tidy(now = Date.now()) {
  for (const n of names()) {
    const f = path.join(dir, n);
    if (f === file) continue;
    try {
      const old = now - fs.statSync(f).mtimeMs > KEEP_DAYS * 86400000;
      if (old || !summary(n).games.length) { fs.unlinkSync(f); listed.delete(n); log('info', 'recorder', `Removed Recordings/${n} (${old ? `older than ${KEEP_DAYS} days` : 'no game in it'})`); }
    } catch (err) { log('warn', 'recorder', `Could not tidy Recordings/${n}: ${err.message}`); }
  }
}

function remove(recording) {
  if (!NAME.test(recording) || !names().includes(recording)) return `There's no recording ${recording}.`;
  if (path.join(dir, recording) === file) return 'That recording is still being made. It can be removed once it stops, after the game.';
  fs.unlinkSync(path.join(dir, recording));
  listed.delete(recording);
  log('info', 'recorder', `Removed Recordings/${recording}`);
  return null;
}

function save() {
  try { fs.writeFileSync(settingsFile, JSON.stringify({ record, afterMinutes })); } catch (err) { log('warn', 'recorder', `Could not save recordings.json: ${err.message}`); }
}

// Turning recording off stops the one being made; on again starts one when a game is due.
function setRecord(on) {
  record = !!on;
  save();
  if (!record && file) { close('recording off'); log('info', 'recorder', 'Recording turned off'); }
  if (record) check();
}

// The minutes recorded after full time (0 to 60).
function setAfter(m) {
  afterMinutes = minutes(m);
  save();
  check();
}

// waiting: the board's game when it isn't recording yet ({ game, from (ms, when it's due), why }).
function state() {
  const w = !file && record && onBoard && onBoard.gameId ? dueOf(onBoard) : null;
  return { record, recording: file ? name : '', keepDays: KEEP_DAYS, afterMinutes, leadMinutes: Math.round(lead() / 60000),
    waiting: w && !w.due ? { game: teams(onBoard), from: w.from || null, why: w.why } : null, recordings: list() };
}

const fileOf = recording => (NAME.test(recording) && names().includes(recording) ? path.join(dir, recording) : null);

// /api/recordings: GET the list and whether Studio records, POST { record } to turn it on or off and
// { afterMinutes } to set the minutes after full time; DELETE /api/recordings/<name> removes one;
// GET /api/recordings/<name>/file downloads it (to keep, or to send in as test data).
async function route(req, res, url, { send: reply, readBody }) {
  if (url.pathname === '/api/recordings') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const after = body.afterMinutes;
      if (typeof body.record !== 'boolean' && (after === undefined || !Number.isFinite(Number(after)))) {
        reply(res, 400, { error: 'Send { record: true } or { record: false }, or { afterMinutes: 0 to 60 }.' }); return true;
      }
      if (typeof body.record === 'boolean') setRecord(body.record);
      if (after !== undefined && Number.isFinite(Number(after))) setAfter(after);
    }
    reply(res, 200, state());
    return true;
  }
  const m = /^\/api\/recordings\/([^/]+)(\/file)?$/.exec(url.pathname);
  if (!m) return false;
  let recording;
  try { recording = decodeURIComponent(m[1]); } catch { recording = ''; }
  if (m[2] && req.method === 'GET') {
    const f = fileOf(recording);
    if (!f) { reply(res, 404, { error: `There's no recording ${recording}.` }); return true; }
    if (f === file) flush();
    reply(res, 200, fs.readFileSync(f), 'application/gzip', { 'content-disposition': `attachment; filename="${recording}"` });
    return true;
  }
  if (!m[2] && req.method === 'DELETE') {
    const error = remove(recording);
    reply(res, error ? 400 : 200, error ? { error, ...state() } : state());
    return true;
  }
  return false;
}

module.exports = { route, init, close, flush, pause, playhq, live, action, scene, board, answer, read, list, tidy, remove, setRecord, setAfter, state, check, fileOf, KEEP_DAYS };
