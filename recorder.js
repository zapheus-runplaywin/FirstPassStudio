// FirstPass Studio - game recordings: what PlayHQ said and what went to air, timed, for every night on air.
//
// While Studio is on air (the helper running, from Open Studio until off air) it writes one recording: a file in
// the Recordings folder of the local data folder (it stays on this Mac when the settings are in iCloud Drive),
// named after when it started ("2026-10-30 1915.jsonl.gz"). Each line is one thing that happened, as JSON, with
// t (ms since 1970) and k (its kind):
//   start     the recording's start: Studio's version, the competition, the time zone
//   game      a game picked on the board: a chapter (id, teams, division, round, court)
//   playhq    a PlayHQ answer (playhq.js gql): op, vars, tenant, data
//   live      an answer from PlayHQ's live scoring (fetchLive): id, and data or errors
//   action    a scoreboard action (board.js applyAction): from the control page, the Stream Deck or Studio itself
//   scene     the scene the pages were sent (scene.js notify), when it changed
//   board     the board the pages were sent (scene.js publishBoard), when it changed (not the clock reading)
//   api       an answer a graphic fetched (GET /api/...), when it changed: p (the path and query) and body
//   end       Studio went off air
// The first two layers (playhq, live, action) are what came in, for practice games and tests; the rest (scene,
// board, api) is what went to air, for replaying the graphics at 4K. Nothing secret is recorded: no keys,
// cookies, devices or private answers (access.PRIVATE, /api/setup...), and only what graphics asked for, not the
// Studio pages.
//
// Lines are kept in memory and written every few seconds as a gzip member of their own, so a recording is always
// readable up to its last write, even if Studio stopped suddenly. A recording with no game in it is removed when
// Studio next starts, and one older than KEEP_DAYS days too. Recording can be turned off on the Recordings page
// (recordings.json in the local data folder, as the recordings are this Mac's: { record }).

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KEEP_DAYS = 60;
const FLUSH_MS = 5000;
const NAME = /^\d{4}-\d{2}-\d{2} \d{4}(?:-\d+)?\.jsonl\.gz$/;

let log = () => {};
let dir = '', settingsFile = '', file = '', name = '';
let record = true;
let pending = [];
let timer = null;
const last = new Map(); // what was last recorded for a key, so only a change is
let gameId = null;
const listed = new Map(); // name -> { mtimeMs, size, summary }

const two = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;

// dir: the Recordings folder; settings: recordings.json; start: what the start line says ({ version, competition }).
function init(logger, { dir: recordingsDir, settings, start = {} } = {}) {
  log = logger || log;
  dir = recordingsDir;
  settingsFile = settings;
  try { record = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).record !== false; } catch { record = true; }
  fs.mkdirSync(dir, { recursive: true });
  tidy();
  if (record) begin(start);
}

function begin(start) {
  const base = stamp(new Date());
  name = `${base}.jsonl.gz`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.jsonl.gz`;
  file = path.join(dir, name);
  last.clear();
  gameId = null;
  note('start', { version: start.version || '', competition: start.competition || '', zone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  flush();
  log('info', 'recorder', `Recording to Recordings/${name}`);
  timer = setInterval(flush, FLUSH_MS);
  timer.unref();
}

function note(k, data) {
  if (!file) return;
  pending.push(JSON.stringify({ t: Date.now(), k, ...data }));
}

// Records data under key only when it isn't what was last recorded there.
function changed(k, key, data, same = JSON.stringify(data)) {
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

// Off air: the end line, written straight away.
function close() {
  if (!file) return;
  note('end', {});
  flush();
  clearInterval(timer);
  file = '';
}

// ─── What's recorded ────────────────────────────────────────────────────────
function playhq(op, vars, tenant, data) { changed('playhq', `playhq ${op} ${tenant} ${JSON.stringify(vars)}`, { op, vars, tenant, data }); }
function live(id, json) { changed('live', `live ${id}`, { id, ...(json.errors && json.errors.length ? { errors: json.errors } : { data: json.data }) }); }
function action(a) { if (a && typeof a === 'object') note('action', { action: a }); }
function scene(state, text) { changed('scene', 'scene', { scene: state }, text); }
function board(json) {
  if (!json) return;
  if (json.gameId && json.gameId !== gameId) {
    gameId = json.gameId;
    note('game', { id: json.gameId, home: (json.home || {}).name || '', away: (json.away || {}).name || '', division: json.division || '',
      round: json.round || '', court: json.court || '', competition: json.competition || '' });
  }
  changed('board', 'board', { board: json }, sameness(json));
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

// Removes recordings older than KEEP_DAYS days, and ones with no game in them (Studio opened to set things up).
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
  if (path.join(dir, recording) === file) return 'That recording is still being made. It can be removed once Studio is off air.';
  fs.unlinkSync(path.join(dir, recording));
  listed.delete(recording);
  log('info', 'recorder', `Removed Recordings/${recording}`);
  return null;
}

// Turning recording off stops the one being made; on again starts a new one.
function setRecord(on, start) {
  record = !!on;
  try { fs.writeFileSync(settingsFile, JSON.stringify({ record })); } catch (err) { log('warn', 'recorder', `Could not save recordings.json: ${err.message}`); }
  if (!record && file) { close(); log('info', 'recorder', 'Recording turned off'); }
  if (record && !file) begin(start);
}

function state() {
  return { record, recording: file ? name : '', keepDays: KEEP_DAYS, recordings: list() };
}

const fileOf = recording => (NAME.test(recording) && names().includes(recording) ? path.join(dir, recording) : null);

// /api/recordings: GET the list and whether Studio records, POST { record } to turn it on or off;
// DELETE /api/recordings/<name> removes one; GET /api/recordings/<name>/file downloads it (to keep, or to send in
// as test data). start(): the start line for a recording begun by turning recording on.
async function route(req, res, url, { send: reply, readBody, start = () => ({}) }) {
  if (url.pathname === '/api/recordings') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.record !== 'boolean') { reply(res, 400, { error: 'Send { record: true } or { record: false }.' }); return true; }
      setRecord(body.record, start());
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

module.exports = { route, init, close, flush, playhq, live, action, scene, board, answer, read, list, tidy, remove, setRecord, state, fileOf, KEEP_DAYS };
