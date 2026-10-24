// FirstPass Studio - local helper for the overlay pages.
//
// Why this exists: PlayHQ's public data (the same data www.playhq.com shows) is
// served from https://api.playhq.com/graphql. It needs no API key, but it only
// answers requests that look like they come from playhq.com and carry a guest
// session cookie. A web page loaded as an overlay can't set those, so this tiny server
// fetches the data and hands it to the pages in public/.
//
// Run:  node server.js        (Node 18 or newer, nothing to install)
// Then: http://localhost:8080/ lists the pages.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const datadir = require('./datadir');
const savefile = require('./savefile');
const datalocation = require('./datalocation');
const migrations = require('./migrations');
const competitions = require('./competitions');
const finals = require('./finals');
const fonts = require('./fonts');
const scene = require('./scene');
const sponsors = require('./sponsors');
const exposure = require('./exposure');
const viewers = require('./viewers');
const outputs = require('./outputs');
const { linkHost } = require('./linkhost');
const access = require('./access');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// Everything the helper saves goes in the data folder (datadir.js), outside the app.
const DATA = datadir.file;
// config.json holds this computer's settings (port, cache, log size): the app's config.json
// has the defaults, and a config.json in the data folder changes any of them (only the
// settings it names, so an update can add new ones). Everything about the competition lives
// in competitions/<id>/settings.json in the data folder, edited on setup.html.
// CONFIG is the two together, for the competition in use.
const readConfig = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const MACHINE = { ...readConfig(path.join(ROOT, 'config.json')), ...readConfig(DATA('config.json')) };
delete MACHINE._note;
let CONFIG = { ...MACHINE };
const PORT = Number(process.env.PORT || MACHINE.port || 8080);
// The start of every page link shown to people (Graphics page, control page, Mac app): the Mac's
// Bonjour name unless config.json linkHost says otherwise. See linkhost.js.
const LINK_BASE = `http://${linkHost(MACHINE.linkHost)}:${PORT}`;
const API_URL = process.env.PLAYHQ_API_URL || 'https://api.playhq.com/graphql';
const CACHE_MS = Math.max(15, Number(MACHINE.cacheSeconds || 60)) * 1000;
// The exit code when the port is already taken, so the Mac app says so instead of restarting the helper.
const EXIT_PORT_IN_USE = 3;

// ─── Debug log ──────────────────────────────────────────────────────────────
// logs/playhq-graphics.log in the local data folder (it stays on this computer when the settings are in iCloud Drive): helper requests, PlayHQ calls, scoreboard changes and
// errors from every page. Capped at logMaxMB (default 15): when full, the oldest
// half is dropped so the newest lines are always kept.
const LOG_DIR = datadir.local('logs');
const LOG_FILE = path.join(LOG_DIR, 'playhq-graphics.log');
const LOG_MAX = Math.max(1, Number(MACHINE.logMaxMB) || 15) * 1024 * 1024;
let logSize = 0;
try { fs.mkdirSync(LOG_DIR, { recursive: true }); logSize = fs.statSync(LOG_FILE).size; } catch { /* new log */ }
function log(level, source, message, extra) {
  const time = new Date().toISOString();
  let line = `${time} ${String(level).toUpperCase().padEnd(5)} [${source}] ${String(message).replace(/\s+/g, ' ').slice(0, 4000)}`;
  if (extra !== undefined) line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 4000);
  line += '\n';
  try {
    if (logSize + Buffer.byteLength(line) > LOG_MAX) {
      const buf = fs.readFileSync(LOG_FILE);
      let start = buf.length - Math.floor(LOG_MAX / 2);
      start = Math.max(0, buf.indexOf(10, start) + 1);
      const kept = Buffer.concat([Buffer.from(`${time} INFO  [log] Log reached ${LOG_MAX / 1048576} MB; older lines removed\n`), buf.subarray(start)]);
      fs.writeFileSync(LOG_FILE, kept);
      logSize = kept.length;
    }
    fs.appendFileSync(LOG_FILE, line);
    logSize += Buffer.byteLength(line);
  } catch (err) { console.error('Could not write the log:', err.message); }
  if (level === 'error') console.error(line.trim());
}
process.on('uncaughtException', err => { log('error', 'helper', `Crash: ${err.stack || err.message}`); process.exit(1); });
process.on('unhandledRejection', err => log('error', 'helper', `Unhandled: ${(err && err.stack) || err}`));

// Bring saved settings up to date (migrations.js) before anything reads them.
const DATA_STATE = migrations.run(log);
// Sequences belong to the competition in use, in its folder.
scene.init(log, { ffmpeg: MACHINE.ffmpegPath,
  sequencesFile: () => { const id = competitions.activeId(); return id ? path.join(competitions.DIR, id, 'sequences.json') : null; } });
// The colours the Output page checks against the chroma key colour.
const COLOUR_NAMES = { main: 'Main colour', dark: 'Dark colour', panel: 'Panels', panelAlt: 'Every second row', highlight: 'Highlight', accent: 'Accent', text: 'Text', textOnHighlight: 'Text on highlight', muted: 'Small print' };
outputs.init(log, {
  colours: () => [
    ...Object.entries(CONFIG.colours || {}).map(([k, hex]) => ({ name: COLOUR_NAMES[k] || k, hex })),
    ...Object.entries(CONFIG.clubs || {}).filter(([, c]) => c && c.colour).map(([club, c]) => ({ name: `${club}'s colour`, hex: c.colour })),
  ],
});
sponsors.init(log);
// Proof of play for the sponsors: what's on screen, and whether a video output is on.
exposure.init(log, { showing: scene.showing, onAir: () => outputs.windows().length > 0 });
// Live viewer numbers from the competition's streams, read only while on air.
viewers.init(log, { onAir: () => outputs.windows().length > 0, record: exposure.viewers });
// ─── PlayHQ ─────────────────────────────────────────────────────────────────
// Everything that talks to PlayHQ is in playhq.js; this is the client for the competition in use.
const playhq = require('./playhq').create({
  log, apiUrl: API_URL, cacheMs: CACHE_MS, linkBase: LINK_BASE,
  config: () => CONFIG, leadMs: () => AUTO_LEAD_MS, logoFor: name => logoFor(name), positionOf: p => positionOf(p),
});
const { gql, getStructure, getLadder, findGrade, pickSeason, Q_COMPETITIONS, getRounds, getRoundGames, getGame, readGame,
  eachLimited, PLAYHQ_AT_ONCE, lineup, POSITION_RANK, getLive, liveScore, scoringNotYet, PERIOD_NUMBER, lastLive } = playhq;
const { parsePlayhqUrl, isFinished, startOf, localDate } = require('./playhq');

// ─── Which round is "this round" ────────────────────────────────────────────
// By date: the round being played in the next roundLookaheadDays days (default 5,
// counting today, so a Tuesday round is picked from the Friday before), otherwise
// the last round played. The control page can pick a round by hand instead
// (kept in control.json; blank means automatic).
//
// control.json holds the control page's lasting settings on this computer (git ignores it):
// the round picked by hand, and the scoreboard's automatic game selection, its court, following
// the PlayHQ clock, how often to check PlayHQ, showing the clock and the ticker's speed, and finals
// winners entered by hand (for finals PlayHQ has no fixtures for). Without it the scoreboard
// starts from the competition setup's defaults. The game itself, scores and the clock stay
// in scoreboard-state.json.
const CONTROL_FILE = DATA('control.json');
const LASTING = ['autoSelect', 'autoCourt', 'followPlayhqClock', 'playhqRefreshSec', 'showClock', 'tickerSpeed'];
let control = savefile.readJson(CONTROL_FILE, {}, (err, movedTo) => log('warn', 'helper', `Could not read control.json, starting from the defaults: ${err.message}${movedTo ? ` (moved to ${path.basename(movedTo)})` : ''}`));
if (control.round === undefined) { // the round used to be kept in round-choice.json
  try { control.round = String(JSON.parse(fs.readFileSync(DATA('round-choice.json'), 'utf8')).round || ''); } catch { control.round = ''; }
}
let controlSaved = JSON.stringify(control);
control.boards = control.boards && control.boards['1'] ? { 1: control.boards['1'] } : {}; // one scoreboard: an old second board goes at the next save
// Write control.json only when a lasting setting changed.
function saveControl() {
  const next = JSON.stringify(control);
  if (next === controlSaved) return;
  controlSaved = next;
  savefile.writeJsonSync(CONTROL_FILE, control);
}
let roundChoice = String(control.round || '');
function setRoundChoice(value) {
  roundChoice = control.round = String(value || '').trim();
  saveControl();
  log('info', 'round', roundChoice ? `Round picked by hand: ${roundChoice}` : 'Round picked automatically by date');
}
let LOOKAHEAD_DAYS = 5;
// A round's key in the round list: its number, or its name when the number isn't unique
// (PlayHQ numbers finals rounds from 1 again, so "Grand Final" can share number 3 with Round 3).
function roundKeys(rounds) {
  const count = {};
  for (const r of rounds) if (r.number != null) count[r.number] = (count[r.number] || 0) + 1;
  return r => (r.number != null && count[r.number] === 1 ? String(r.number) : r.name);
}
const dayDiff = (date, today) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
const roundDatesCache = new Map();
// The first game date of each round in a division, and its first game's start time (kept for 30 minutes).
async function roundDates(grade) {
  const hit = roundDatesCache.get(grade.id);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.dates;
  const dates = new Map(), starts = new Map();
  for (const r of await getRounds(grade.id)) {
    const games = (await getRoundGames(r.id, 30 * 60 * 1000)).filter(g => g.date).sort(byStart);
    if (!games.length) continue;
    dates.set(r.id, games[0].date);
    const first = games.map(g => startOf(g)).find(t => t !== null);
    if (first) starts.set(r.id, first);
  }
  dates.starts = starts;
  roundDatesCache.set(grade.id, { at: Date.now(), dates });
  return dates;
}
async function pickRound(grade, choice = roundChoice) {
  const rounds = await getRounds(grade.id);
  if (!rounds.length) return null;
  if (choice) {
    const key = roundKeys(rounds);
    const hit = rounds.find(r => key(r) === choice) || rounds.find(r => r.name.toLowerCase() === choice.toLowerCase());
    if (hit) return hit;
  }
  try {
    const dates = await roundDates(grade);
    const today = localDate();
    const dated = rounds.filter(r => dates.has(r.id)).map(r => ({ r, diff: dayDiff(dates.get(r.id), today) }));
    // A carnival plays several rounds on one day: today, it's the last round that has started
    // (or is about to, autoSelectMinutesBefore ahead), else today's first round.
    const todays = dated.filter(x => x.diff === 0 && dates.starts && dates.starts.has(x.r.id)).sort((a, b) => dates.starts.get(a.r.id) - dates.starts.get(b.r.id));
    if (todays.length > 1) {
      const started = todays.filter(x => dates.starts.get(x.r.id) - AUTO_LEAD_MS <= Date.now());
      return (started.length ? started[started.length - 1] : todays[0]).r;
    }
    const soon = dated.filter(x => x.diff >= 0 && x.diff < LOOKAHEAD_DAYS).sort((a, b) => a.diff - b.diff);
    if (soon.length) return soon[0].r;
    const past = dated.filter(x => x.diff < 0).sort((a, b) => b.diff - a.diff);
    if (past.length) return past[0].r;
    const future = dated.sort((a, b) => a.diff - b.diff);
    if (future.length) return future[0].r;
  } catch (err) { log('warn', 'round', `Could not work out the round by date: ${err.message}`); }
  return rounds.find(r => r.current) || rounds[rounds.length - 1];
}
// For the control page: the round list, what's picked, and what automatic would pick.
async function getRoundInfo() {
  const st = await getStructure();
  const grade = st.grades[0];
  if (!grade) return { choice: roundChoice, auto: '', rounds: [] };
  const auto = await pickRound(grade, '');
  const dates = await roundDates(grade).catch(() => new Map());
  return { choice: roundChoice, auto: auto ? auto.name : '', lookaheadDays: LOOKAHEAD_DAYS,
    rounds: (await getRounds(grade.id)).map((r, i, all) => ({ key: roundKeys(all)(r), name: r.name, date: dates.get(r.id) || '' })) };
}

// This round in every division, for the control page's game picker.
async function getCurrentGames() {
  const st = await getStructure();
  const out = [];
  for (const grade of st.grades) {
    const round = await pickRound(grade);
    if (!round) continue;
    for (const game of await getRoundGames(round.id, 60 * 1000)) {
      out.push({ ...game, division: grade.name, round: round.name });
    }
  }
  return out;
}

// The round a page asked for with ?round=: a number or name ("6", "Round 6", "Final"),
// or one counted from this round (as the control page has it): "this", "next", "prev"
// (or "previous", "last"), "+2", "-1". Blank means this round. Rounds are counted in
// PlayHQ's order, so "next" from the last round finds nothing.
const ROUND_STEPS = { '': 0, this: 0, current: 0, now: 0, next: 1, prev: -1, previous: -1, last: -1 };
async function roundFor(grade, value) {
  const want = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const rounds = await getRounds(grade.id);
  const step = want in ROUND_STEPS ? ROUND_STEPS[want] : /^[+-]\d+$/.test(want) ? Number(want) : null;
  if (step === null) {
    const name = String(value).trim().toLowerCase();
    return rounds.find(r => String(r.number) === name || r.name.toLowerCase() === name) || null;
  }
  const now = await pickRound(grade);
  if (!now || !step) return now;
  const at = rounds.findIndex(r => r.id === now.id);
  return at < 0 ? null : rounds[at + step] || null;
}

// A whole round for the fixture page: every division (or one), sorted by time then court.
// ?round= picks the round (see roundFor); otherwise each division's current round.
async function getFixtures(q) {
  const st = await getStructure();
  const grades = q.division ? [findGrade(st, q)].filter(Boolean) : st.grades;
  const games = [], roundNames = [];
  for (const grade of grades) {
    const round = await roundFor(grade, q.round);
    if (!round) {
      log('info', 'fixtures', `${grade.name}: no round "${q.round || 'this'}"`);
      continue;
    }
    roundNames.push(round.name);
    for (const game of await getRoundGames(round.id, 60 * 1000)) {
      if (q.results && !isFinished(game)) continue;
      games.push({ ...game, division: grade.name, round: round.name,
        home: { ...game.home, logo: logoFor(game.home.name) }, away: { ...game.away, logo: logoFor(game.away.name) } });
    }
  }
  const key = x => `${x.date || ''} ${String(x.time || '').padStart(5, '0')} ${x.court || ''}`;
  games.sort((a, b) => key(a).localeCompare(key(b), 'en', { numeric: true }));
  const round = roundNames.sort((a, b) => roundNames.filter(n => n === b).length - roundNames.filter(n => n === a).length)[0] || '';
  if (q.round && !roundNames.length) return { error: `No round "${q.round}" in ${q.division ? 'that division' : 'any division'}` };
  log('info', 'fixtures', `Fixture${q.results ? ' results' : ''} for ${round || 'no round'}${q.round ? ` (asked for round=${q.round})` : ''}: ${games.length} games`);
  return { competition: st.competition, rules: rules(q.division && grades[0] ? grades[0].name : undefined), venueName: CONFIG.venueName || (games[0] && games[0].venue) || '',
    division: q.division ? (grades[0] && grades[0].name) || '' : '', round, games };
}

// The game after the one on the scoreboard: the next timeslot on the same court
// (any court if that court has nothing later). With no game picked, it assumes the
// stream is on the first timeslot and shows the game after it. With { wrap: true }, when
// there's no later game (or with { wrap: 'force' } always) it adds the end of night card's
// details as wrap (see endOfNight).
async function getUpNext({ wrap = false } = {}) {
  const b = board();
  const games = await getCurrentGames();
  const key = g => `${g.date || ''} ${String(g.time || '').padStart(5, '0')}`;
  games.sort((x, y) => key(x).localeCompare(key(y)));
  let current = games.find(g => g.id === b.gameId) || games[0];
  // A carnival day has several rounds: the next game may be in the next round, so add the rest of that day's games.
  if (current && current.date) {
    for (const grade of (await getStructure()).grades) {
      for (const g of await getSeasonGames(grade)) if (g.date === current.date && !games.some(x => x.id === g.id)) games.push(g);
    }
    games.sort((x, y) => key(x).localeCompare(key(y)));
    current = games.find(g => g.id === current.id);
  }
  if (!current) return { error: 'No games found in the current round' };
  const court = b.court || current.court;
  const later = games.filter(g => g.id !== current.id && key(g) > key(current));
  const next = later.find(g => court && g.court === court) || later[0];
  const out = { competition: competitionName(), venueName: CONFIG.venueName || current.venue || '',
    after: { home: current.home.name, away: current.away.name, court: current.court, time: current.time } };
  if (wrap && (!next || wrap === 'force')) {
    const w = await endOfNight(current);
    log('info', 'upnext', `End of night after ${current.home.name} v ${current.away.name} (${current.round}): ${w.next ? `next ${w.next.round} on ${w.next.date || 'a date not set yet'}` : w.finalsNext ? 'finals next' : 'end of the season'}`);
    return { ...out, ...(next ? { nextGame: { home: next.home.name, away: next.away.name, court: next.court, time: next.time } } : {}), wrap: w };
  }
  if (!next) return { ...out, error: 'No later game in this round' };
  return { ...out, ...next, logos: { home: logoFor(next.home.name), away: logoFor(next.away.name) } };
}

// The end of night card on Up next: the competition and organisation to thank, and when to come
// back. The next round is the first round in any division dated after tonight (its name, date,
// days away, and whether it's a finals round). Without one: finals are next when the round played
// tonight wasn't a finals round and some division has a finals format (PlayHQ often adds finals
// fixtures late), otherwise the season is over.
async function endOfNight(current) {
  const st = await getStructure();
  let next = null, undated = null;
  for (const grade of st.grades) {
    const rounds = await getRounds(grade.id);
    const dates = await roundDates(grade).catch(() => new Map());
    const at = rounds.findIndex(r => r.name === current.round);
    rounds.forEach((r, i) => {
      const date = dates.get(r.id);
      if (date && current.date && date > current.date) {
        if (!next || date < next.date) next = { round: r.name, date };
      } else if (!date && at >= 0 && i > at && !undated) undated = { round: r.name, date: '' };
    });
  }
  next = next || undated;
  const r = rules();
  const finalsNext = !next && !FINALS_ROUND.test(current.round || '') && st.grades.some(g => finalsFor(g.name));
  return { competition: st.competition || competitionName() || '', organisation: st.organisation || '', season: (st.season && st.season.name) || '',
    competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark,
    round: current.round || '', date: current.date || '', finalRound: FINALS_ROUND.test(current.round || ''),
    next: next ? { ...next, days: next.date && current.date ? dayDiff(next.date, current.date) : null, finals: FINALS_ROUND.test(next.round) } : null,
    finalsNext, seasonOver: !next && !finalsNext };
}

// The intro and outro animations (introoutro.html): the competition, this round and the teams of a division
// (?division=N, or the picked game's division; ?division=all for one team a club across the competition), and for
// the outro, when to join again (endOfNight, as on Up next's end of night card).
async function getIntroOutro(q = {}) {
  const st = await getStructure();
  const b = board();
  const games = await getCurrentGames();
  const key = g => `${g.date || ''} ${String(g.time || '').padStart(5, '0')}`;
  games.sort((x, y) => key(x).localeCompare(key(y)));
  const current = games.find(g => g.id === b.gameId) || games[0] || null;
  const all = String(q.division || '').toLowerCase() === 'all';
  const grades = all ? st.grades : [q.division ? findGrade(st, q) : st.grades.find(g => g.name === (b.division || (current && current.division))) || st.grades[0]].filter(Boolean);
  if (!grades.length) return { error: q.division ? `No division "${q.division}"` : 'This season has no divisions' };
  const seen = new Map();
  for (const grade of grades) {
    for (const g of await getSeasonGames(grade)) {
      for (const name of [g.home.name, g.away.name]) {
        if (!name || name === 'TBC' || /^bye$/i.test(name)) continue;
        const k = all ? norm(competitions.clubFor(CONFIG, name)) : norm(name);
        if (!seen.has(k)) seen.set(k, all ? competitions.clubFor(CONFIG, name) || name : name);
      }
    }
  }
  const teams = [...seen.values()].sort((a, c) => a.localeCompare(c)).map(name => ({ name, logo: logoFor(name), colour: colourFor(name) }));
  const r = rules();
  const round = current ? current.round : '';
  const out = { competition: st.competition || competitionName() || '', organisation: st.organisation || '', season: (st.season && st.season.name) || '',
    competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark,
    division: all ? '' : grades[0].name, round, date: current ? current.date || '' : '', venueName: CONFIG.venueName || (current && current.venue) || '',
    finalRound: FINALS_ROUND.test(round || ''), teams };
  if (q.type === 'outro' && current) out.wrap = await endOfNight(current);
  log('info', 'introoutro', `${q.type === 'outro' ? 'Outro' : 'Intro'} for ${out.division || 'every club'}: ${teams.length} teams${out.wrap ? `, ${out.wrap.next ? `next ${out.wrap.next.round}` : out.wrap.finalsNext ? 'finals next' : 'end of the season'}` : ''}`);
  return out;
}

// The countdown page: when the game picked on the scoreboard starts. Read from the board
// alone (no PlayHQ call), so countdown.html can ask every few seconds to notice a new game.
function getCountdown() {
  const b = board();
  if (!b.gameId) return { error: 'No game picked on the scoreboard control page' };
  const start = startOf(b);
  return { gameId: b.gameId, start, serverNow: Date.now(), date: b.date, time: b.time,
    competition: competitionName(), division: b.division, round: b.round, court: b.court, venueName: CONFIG.venueName || b.venue || '',
    home: { name: b.home.name, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
    away: { name: b.away.name, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
    ...(start === null ? { error: 'PlayHQ has no start time for the picked game' } : {}) };
}

// ─── The board (board.js): scores, clock, goals, streaks, stats and the worm ──
const theBoard = require('./board').create({
  log, datadir, savefile, machine: MACHINE, config: () => CONFIG, competitions, scene, playhq,
  control: { get: () => control, save: () => saveControl(), LASTING, exists: () => fs.existsSync(CONTROL_FILE), markUnsaved: () => { controlSaved = ''; } },
  logoFor: n => logoFor(n), colourFor: n => colourFor(n), rules: d => rules(d), competitionName: () => competitionName(), warmTeamLists: why => warmTeamLists(why),
});
const { board, newBoard, saveBoards, scoreboardJson, pushBoard, applyAction, clockElapsed, clockLeft, refreshFromPlayhq, followClock, parseClock,
  getGoals, getStats, getWorm, streak, superShot, tickerSpeed, DEFAULT_REFRESH_SEC, TICKER_SPEED } = theBoard;

// ─── Automatic game selection ───────────────────────────────────────────────
// With autoSelect on, the board shows today's game on its court (autoCourt, default
// defaultCourt in config.json): the first game of the day until the next one is due,
// then each game from autoSelectMinutesBefore (default 10) minutes before its start, when
// electronic scoring starts (the live feed isn't asked before then, see scoringNotYet).
// A finals game is kept until PlayHQ says it is finished, because of extra time.
// Picking a game by hand turns autoSelect off.
let AUTO_LEAD_MS = 10 * 60 * 1000;
const courtKey = c => String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b0+(\d)/g, '$1').trim();
function sameCourt(court, wanted) {
  const a = courtKey(court), w = courtKey(wanted);
  if (!w) return false;
  if (a === w) return true;
  // "1" or "court 1" matches "Indoor 01"
  const num = x => (x.match(/(\d+)\s*$/) || [])[1];
  const word = w.replace(/\s*\d+$/, '');
  return /^\d+$/.test(w) ? num(a) === w : !!num(a) && num(a) === num(w) && (word === 'court' || a.includes(word));
}
async function todaysGames(court) {
  const st = await getStructure();
  const today = localDate();
  // With a round picked by hand on the control page (for testing), use that round's games
  // on this court as if they were on today, so the timed switching can be tried out.
  if (roundChoice) {
    const games = (await getCurrentGames()).filter(g => sameCourt(g.court, court)).map(g => ({ ...g, date: today }));
    return games.filter(g => startOf(g) !== null).sort((a, b) => startOf(a) - startOf(b));
  }
  const out = [];
  for (const grade of st.grades) {
    for (const g of await getSeasonGames(grade)) if (g.date === today && sameCourt(g.court, court)) out.push(g);
  }
  return out.filter(g => startOf(g) !== null).sort((a, b) => startOf(a) - startOf(b));
}
const isFinalsRound = g => /final/i.test(g.round || '');
let autoBusy = false;
// Put a game on the board, following PlayHQ, at Q1 with a full clock.
function switchTo(b, pick, why) {
  log('info', 'auto', `${why} ${pick.home.name} v ${pick.away.name} (${pick.date} ${pick.time}, ${pick.court}, ${pick.division})`);
  applyAction(b, { type: 'selectGame', game: pick, auto: true });
  applyAction(b, { type: 'period', value: 1 });
  b.clock = { ...b.clock, lengthSec: b.clock.baseSec || theBoard.quarterSec(), elapsedMs: 0, running: false, startedAt: null };
  saveBoards();
}
const byStart = (x, y) => `${x.date || ''} ${String(x.time || '').padStart(8, '0')}`.localeCompare(`${y.date || ''} ${String(y.time || '').padStart(8, '0')}`);
async function autoPick() {
  const b = board();
  // Runs while automatic selection is on, and whenever the board has no game at all.
  if (autoBusy || (!b.autoSelect && b.gameId)) return;
  autoBusy = true;
  try {
    const court = b.autoCourt || CONFIG.defaultCourt || '';
    const games = court && b.autoSelect ? await todaysGames(court) : [];
    if (!games.length) {
      // Not a game day on this court, no court set, or automatic selection is off with no game picked:
      // start on this round's first game (on the court when it has games there), so a game is always on.
      const round = await getCurrentGames();
      const onCourt = court ? round.filter(g => sameCourt(g.court, court)) : [];
      const pool = (onCourt.length ? onCourt : round).slice().sort(byStart);
      if (!pool.length) { b.autoNote = 'PlayHQ has no games in this round yet.'; return; }
      if (b.autoSelect) b.autoNote = !court ? `Set a court to follow its games through the night. Showing this round's first game.`
        : `No games on ${court} today. Showing this round's first game${onCourt.length ? ` on ${court}` : ''}.`;
      if (!b.gameId || (b.autoSelect && !pool.some(g => g.id === b.gameId))) {
        switchTo(b, pool[0], !court ? 'no court set, so starting with this round\'s first game:'
          : onCourt.length ? `no games on ${court} today, so starting with its first game this round:` : `no games on ${court} this round, so starting with this round's first game:`);
      }
      return;
    }
    const now = Date.now();
    const due = games.filter(g => startOf(g) - AUTO_LEAD_MS <= now);
    const pick = due.length ? due[due.length - 1] : games[0];
    const next = games[games.indexOf(pick) + 1];
    const at = g => new Date(startOf(g) - AUTO_LEAD_MS).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    b.autoNote = next ? `Next: ${next.home.name} v ${next.away.name} (${next.time.slice(0, 5)}), switches at ${at(next)}.` : 'Last game on this court today.';
    if (pick.id === b.gameId) { b.autoHold = ''; return; }
    // Keep a final on until PlayHQ says it is over (it may go to extra time).
    const current = games.find(g => g.id === b.gameId);
    if (current && isFinalsRound(current)) {
      let status = current.status;
      try { status = (await getLive(current.id, 20000)).status || status; } catch { /* use the fixture's status */ }
      if (!isFinished({ ...current, status })) {
        const hold = `Keeping the final on until PlayHQ marks it finished. To move on sooner, pick the next game from the list, then tick this again.`;
        if (b.autoHold !== hold) log('info', 'auto', hold);
        b.autoHold = hold; b.autoNote = hold;
        return;
      }
    }
    b.autoHold = '';
    switchTo(b, pick, 'switching to');
  } catch (err) {
    b.autoNote = `Couldn't pick a game from PlayHQ: ${err.message}${/setup page/.test(err.message) ? '' : ' Check the PlayHQ link and competition on the competition setup page.'}`;
    log('error', 'auto', b.autoNote);
  } finally { autoBusy = false; }
}
setInterval(autoPick, 15000);
setTimeout(autoPick, 3000); // Studio starts with a game on, following PlayHQ

// Studio reads the live score itself, every second through the cache (so PlayHQ is asked once
// per playhqRefreshSec), whatever windows are open. Before this the reading only happened inside
// a page's request for the scoreboard, goals, stats or worm, so with the scoreboard source hidden
// (unloaded) and the control page closed the score froze, and the game triggers ("It's full time",
// quarter breaks), the super shot song, streaks and the goal order all waited on a page that
// wasn't there. The pages' requests still read through the same cache, so nothing is asked twice.
let refreshBusy = false;
async function refreshTick() {
  if (refreshBusy) return;
  refreshBusy = true;
  try { await refreshFromPlayhq(board()); }
  catch (err) { log('error', 'scoreboard', `Reading PlayHQ failed: ${err.message}`); }
  finally { refreshBusy = false; }
}
setInterval(refreshTick, 1000);


// The game, each second, for sequences that start by themselves (scene.js, sequences.js): the picked
// game's scheduled start, the quarter, the clock (PlayHQ's scorer's or the manual one) and PlayHQ's
// break flag and finished status, all from the board, so it costs no PlayHQ calls.
function gameSnapshot() {
  const b = board();
  const left = clockLeft(b);
  const following = b.source === 'playhq' && b.followPlayhqClock;
  // The super shot period: the last superShotMinutes of the quarter in a division with super shots, as the
  // scoreboard's Super shot tab shows it (public/scoreboard.js superShotTime).
  const window = (CONFIG.superShotMinutes ?? 3) * 60;
  const superShot = competitions.superShotsFor(CONFIG, b.division) && window > 0 && left > 0 && left <= window && left < b.clock.lengthSec;
  return {
    id: b.gameId || 'manual', label: `${b.home.name} v ${b.away.name}${b.court ? ` on ${b.court}` : ''}`,
    startAt: b.gameId ? startOf({ date: b.date, time: b.time }) : null,
    period: b.period, last: CONFIG.periodType === 'halves' ? 2 : 4, left, running: !!b.clock.running && left > 0, superShot,
    onBreak: following && !!b.playhqBreak, finished: b.source === 'playhq' && /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(b.playhqStatus || ''),
    breaks: { qt: CONFIG.quarterBreakMinutes, ht: CONFIG.halfTimeMinutes, '3qt': CONFIG.threeQuarterBreakMinutes },
  };
}
setInterval(() => { try { scene.game(gameSnapshot()); } catch (err) { log('error', 'sequence', `Game triggers failed: ${err.message}`); } }, 1000);
// The board to the pages following it over the scene socket: on every save (a press, a PlayHQ reading) and
// each second while the clock runs, since what the pages show of it (elapsed time) moves on its own.
scene.setBoardSource(() => scoreboardJson(board()));
setInterval(pushBoard, 1000);

// ─── Stream Deck links ──────────────────────────────────────────────────────
// Plain GET links, so a Stream Deck "Website" button (with "GET request in
// background" ticked) can press them. Full list in STREAMDECK.md.
//   /deck/home/add1  add2  minus1  minus2     (same for /deck/away/...)
//   /deck/home/supershot                      (plays supershot.html for that team, score unchanged)
//   /deck/streak/heating/home  fire  goalforgoal  lead  level  comeback  siren  backtoback   (plays streak.html, score unchanged)
//   /deck/clock/start  stop  toggle  reset
//   /deck/clock/set/12:34   /deck/clock/length/10 (minutes per quarter)
//   /deck/clock/playhq/on  off  toggle   (clock follows the PlayHQ scorer)
//   /deck/clock/adjust/10  adjust/-10  adjust/1m  adjust/-1m   (seconds, or m for minutes)
//   /deck/quarter/1 .. 4   /deck/quarter/5 (extra time)   /deck/quarter/next  prev
//   /deck/source/playhq  manual  toggle
//   /deck/scores/reset
//   /deck/auto/on  off  toggle   (pick the game from the court and the time)
//   /deck/court/Indoor%2001  or  /deck/court/1   (the court for automatic selection)
//   /deck/ticker/faster  slower  normal   /deck/ticker/speed/150   (pixels per second)
function deckAction(parts, q) {
  const [what, verb, arg] = parts;
  if (what === 'home' || what === 'away') {
    const m = String(verb || '').match(/^(add|plus|minus|sub)(\d)$/);
    if (m) return { type: 'score', side: what, delta: (m[1] === 'add' || m[1] === 'plus' ? 1 : -1) * Number(m[2]) };
    if (verb === 'supershot') return { type: 'superShot', side: what };
  }
  // /deck/streak/heating/home, /deck/streak/fire/away, /deck/streak/goalforgoal, lead, level, comeback, siren, backtoback (streak.html, score unchanged)
  if (what === 'streak') {
    const kind = { heating: 'heating', heatingup: 'heating', fire: 'fire', onfire: 'fire', goalforgoal: 'goalForGoal', lead: 'lead', front: 'lead',
      level: 'level', square: 'level', comeback: 'comeback', siren: 'siren', backtoback: 'backToBack' }[String(verb || '').toLowerCase()];
    if (kind) return { type: 'streak', kind, side: arg === 'away' ? 'away' : 'home' };
  }
  if (what === 'clock') {
    if (['start', 'stop', 'toggle', 'reset'].includes(verb)) return { type: 'clock' + verb[0].toUpperCase() + verb.slice(1) };
    if (verb === 'set') { const secs = parseClock(arg || q.time); if (secs !== null) return { type: 'clockSet', secondsLeft: secs }; }
    if (verb === 'adjust') {
      // adjust/10, adjust/-10, adjust/30s, adjust/1m, adjust/-1m, or ?minutes=1&seconds=-30
      let secs = null;
      const m = String(arg ?? '').match(/^([+-]?\d+(?:\.\d+)?)([ms]?)$/i);
      if (m) secs = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 60 : 1);
      else if (q.minutes !== undefined || q.seconds !== undefined) secs = Number(q.minutes || 0) * 60 + Number(q.seconds || 0);
      if (Number.isFinite(secs)) return { type: 'clockAdjust', deltaSec: secs };
    }
    if (verb === 'playhq' && ['on', 'off', 'toggle'].includes(arg)) return { type: 'followPlayhqClock', value: arg === 'toggle' ? 'toggle' : arg === 'on' };
    if (verb === 'length') { const mins = Number(arg ?? q.minutes); if (mins > 0) return { type: 'clockLength', value: mins * 60 }; }
  }
  if (what === 'auto' && ['on', 'off', 'toggle'].includes(verb)) return { type: 'autoSelect', value: verb === 'toggle' ? 'toggle' : verb === 'on' };
  if (what === 'ticker') {
    if (['faster', 'slower', 'normal'].includes(verb)) return { type: 'tickerSpeed', value: verb };
    if (verb === 'speed' && Number(arg ?? q.speed) > 0) return { type: 'tickerSpeed', value: Number(arg ?? q.speed) };
  }
  if (what === 'court' && verb) return { type: 'autoCourt', value: verb };
  if (what === 'source' && ['playhq', 'manual', 'toggle'].includes(verb)) return { type: 'source', value: verb };
  if (what === 'scores' && verb === 'reset') return { type: 'resetScores' };
  if ((what === 'period' || what === 'quarter') && /^([1-5]|next|prev)$/.test(verb || '')) {
    return { type: 'period', value: /^\d$/.test(verb) ? Number(verb) : verb };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

// Pages reload themselves when this changes: after a restart, or when a file in
// public/ or config.json is edited (so updated pages show on their own).
const STARTED_AT = Date.now();
// What's going on, in one answer, for the Output page's status line (and anything else that wants to
// show a light): the competition and game, whether the score and clock follow PlayHQ, how long since
// PlayHQ last answered and the last error, the video output and how many sources are on.
function health() {
  const b = board();
  const now = Date.now();
  const following = b.source === 'playhq' && !!b.gameId;
  const waiting = following ? scoringNotYet(b) : '';
  const refreshMs = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
  const finished = following && /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(b.playhqStatus || '');
  const readAgoMs = lastLive.at ? now - lastLive.at : null;
  // ok: fine or nothing to read; warn: a reading is overdue; bad: PlayHQ has been failing for a minute.
  // Overdue is measured from the later of the last answer and the switch to following PlayHQ (clockMatchedAt),
  // so the first seconds after a switch back from manual scores aren't a false alarm.
  const since = Math.max(lastLive.at, b.clockMatchedAt || 0);
  let playhqState = 'ok';
  if (following && !waiting && !finished) {
    if (lastLive.error && lastLive.errorAt > lastLive.at && now - since > 60000) playhqState = 'bad';
    else if (now - since > 2 * refreshMs + 2000) playhqState = 'warn';
  }
  const out = outputs.state();
  const sc = scene.state();
  return {
    version: pageVersion(), serverNow: now, competition: competitionName(), competitionSetup: CONFIG.name,
    game: b.gameId ? { id: b.gameId, label: `${b.home.name} v ${b.away.name}`, court: b.court || '', division: b.division || '', time: b.time || '' } : null,
    source: b.source, autoSelect: !!b.autoSelect,
    playhq: { state: playhqState, following, waiting, finished, status: b.playhqStatus || '', readAgoMs, refreshSec: refreshMs / 1000,
      error: lastLive.error && lastLive.errorAt > lastLive.at ? lastLive.error : (b.playhqError || '') },
    clock: { following: following && !!b.followPlayhqClock, running: !!b.clock.running, period: b.period, left: clockLeft(b) },
    output: { on: !!out.on && out.mode !== 'off', mode: out.on && out.mode !== 'off' ? out.mode : '', showing: (out.showing || []).length },
    sourcesOn: (sc.sources || []).filter(s => s.visible).length, sources: (sc.sources || []).length,
    scene: sc.current || null, sequence: sc.playing ? (sc.playing.name || true) : null,
  };
}

function pageVersion() {
  let latest = STARTED_AT;
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try { walk(PUBLIC_DIR); latest = Math.max(latest, fs.statSync(path.join(ROOT, 'config.json')).mtimeMs); } catch {}
  // The competition setup too: switching competition, or saving its colours or logos, reloads every page.
  try { latest = Math.max(latest, fs.statSync(competitions.ACTIVE_FILE).mtimeMs); walk(path.join(competitions.DIR, competitions.activeId())); } catch {}
  return String(Math.round(latest));
}

// ─── Competition setup (setup.html) ─────────────────────────────────────────
// Puts the competition picked on the setup page to use. A different competition (or a
// different PlayHQ link) clears everything cached from PlayHQ; switching competition also
// sets the round back to automatic and puts that competition's first game on every board.
const MACHINE_KEYS = ['port', 'cacheSeconds', 'playhqRefreshSeconds', 'logMaxMB', 'apiBaseUrl', 'gameSummaryPath', 'remoteChanges'];
function applyCompetition(why) {
  const id = competitions.activeId();
  const prev = CONFIG;
  CONFIG = { ...Object.fromEntries(MACHINE_KEYS.filter(k => MACHINE[k] !== undefined).map(k => [k, MACHINE[k]])), ...competitions.get(id), id };
  playhq.setOrganisation(CONFIG.organisationUrl);
  LOOKAHEAD_DAYS = CONFIG.roundLookaheadDays || 5;
  AUTO_LEAD_MS = (Number.isFinite(Number(CONFIG.autoSelectMinutesBefore)) ? Number(CONFIG.autoSelectMinutesBefore) : 10) * 60 * 1000;
  theBoard.setQuarterSec(Math.round((Number(CONFIG.quarterMinutes) || 10) * 60));
  const switched = prev.id && prev.id !== id;
  const sourceChanged = switched || ['organisationUrl', 'competitionName', 'seasonName'].some(k => prev[k] !== CONFIG[k]);
  if (prev.id && sourceChanged) {
    playhq.resetCaches();
    for (const cache of [roundDatesCache, summaryCache]) cache.clear();
    athleteRegister.resetCaches();
  }
  { const b = board(); // a new quarter length applies to a clock that hasn't started
    if (!b.clock.running && !b.clock.elapsedMs) b.clock.lengthSec = b.clock.baseSec = theBoard.quarterSec();
  }
  scene.competitionChanged();
  log('info', 'setup', !id ? `${why}: none yet` : `${why}: ${CONFIG.name} (${CONFIG.competitionName || 'no PlayHQ competition set'}, organisation ${playhq.organisation().orgId || 'not set'} on ${playhq.organisation().tenant})`);
  if (prev.id && sourceChanged) {
    if (roundChoice) setRoundChoice('');
    Object.assign(board(), newBoard()); autoPick();
    saveBoards();
  }
}

// What the setup page shows for one competition.
// A competition's added font files, as paths, so theme.css can measure them (fonts.js normalise).
const fontPaths = id => competitions.images(id, 'fonts').map(f => competitions.imageFile(id, 'fonts', f)).filter(Boolean);

function setupInfo(id) {
  return { id, active: id === competitions.activeId(), settings: competitions.get(id),
    logos: competitions.images(id, 'logos'), brand: competitions.images(id, 'brand'),
    fonts: competitions.images(id, 'fonts'), fontFamilies: fonts.families(competitions.images(id, 'fonts')) };
}

// The organisation's competitions and seasons on PlayHQ, to pick from on the setup page.
async function findCompetitions(organisationUrl) {
  const u = parsePlayhqUrl(organisationUrl);
  if (!u) throw new Error('That doesn\'t look like a PlayHQ organisation link. Open the organisation on playhq.com and copy the address, e.g. https://www.playhq.com/netball-australia/org/<name>/<8 characters>.');
  const data = await gql('discoverCompetitions', Q_COMPETITIONS, { organisationID: u.orgId }, false, u.tenant);
  const list = data.discoverCompetitions || [];
  return { tenant: u.tenant, organisationId: u.orgId, organisation: (list.find(c => c.organisation) || {}).organisation?.name || '',
    competitions: list.map(c => ({ name: c.name, seasons: (c.seasons || []).map(x => x.name), currentSeason: (pickSeason(c.seasons || []) || {}).name || '' })) };
}

// Every team in the competition in use, with the logo each one gets, for the setup page.
// byDivision lists a team once in every division it plays in (the athletes page); otherwise once.
async function setupTeams({ byDivision = false } = {}) {
  const st = await getStructure();
  const teams = new Map();
  const add = (name, division) => {
    const k = byDivision ? `${norm(division)}|${norm(name)}` : norm(name);
    if (name && name !== 'TBC' && !teams.has(k)) teams.set(k, { name, division });
  };
  for (const grade of st.grades) {
    try { for (const row of (await getLadder(grade.id)).pools.flat()) add(row.team, grade.name); } catch (err) { log('warn', 'setup', `Ladder for ${grade.name}: ${err.message}`); }
  }
  try { for (const g of await getCurrentGames()) { add(g.home.name, g.division); add(g.away.name, g.division); } } catch { /* the ladders are enough */ }
  return { competition: st.competition, season: st.season.name,
    teams: [...teams.values()].sort((a, b) => a.division.localeCompare(b.division, 'en', { numeric: true }) || a.name.localeCompare(b.name))
      .map(t => ({ ...t, logo: logoFor(t.name), club: competitions.clubFor(CONFIG, t.name), autoClub: competitions.clubOf(t.name), colour: colourFor(t.name) })) };
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > max) { reject(new Error(`That file is over ${Math.round(max / 1048576)} MB.`)); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function setupRoute(req, res, url, q) {
  const m = url.pathname.match(/^\/api\/setup(?:\/([a-z0-9-]+)(?:\/(activate|image|export|template|fontcss))?)?$/);
  // The fonts installed on this Mac, for the setup page's Font box (none on another computer).
  if (url.pathname === '/api/setup-fonts') return send(res, 200, { mac: await fonts.macFonts() });
  if (url.pathname === '/api/setup-find') return send(res, 200, await findCompetitions(q.url || (await readBody(req)).organisationUrl));
  if (url.pathname === '/api/setup-teams') return send(res, 200, await setupTeams());
  if (url.pathname === '/api/setup-new' && req.method === 'POST') {
    const body = await readBody(req);
    const id = competitions.create(String(body.name || 'New competition').trim() || 'New competition', body.from || null);
    log('info', 'setup', `New competition setup "${body.name}" (${id})${body.from ? ` copied from ${body.from}` : ''}`);
    return send(res, 200, setupInfo(id));
  }
  if (url.pathname === '/api/setup-template' && req.method === 'POST') {
    let tpl;
    try { tpl = JSON.parse((await readRaw(req, 100 * 1024 * 1024)).toString('utf8')); } catch { return send(res, 400, { error: "That isn't a FirstPass Studio competition template." }); }
    const hadActive = competitions.activeId();
    const id = competitions.importTemplate(tpl, q.name);
    sponsors.importFor(id, tpl.sponsors);
    log('info', 'setup', `Imported a template file as ${id}`);
    if (!hadActive) applyCompetition('First competition imported');
    return send(res, 200, setupInfo(id));
  }
  if (url.pathname === '/api/setup-import' && req.method === 'POST') {
    const body = await readBody(req);
    const hadActive = competitions.activeId();
    const id = competitions.importConfig(String(body.from || ''), body.name);
    log('info', 'setup', `Imported the ${body.from} import config as ${id}`);
    if (!hadActive) applyCompetition('First competition imported');
    return send(res, 200, setupInfo(id));
  }
  if (!m) return send(res, 404, { error: 'Unknown setup link' });
  const [, id, what] = m;
  if (!id) return send(res, 200, { active: competitions.activeId(), competitions: competitions.list(), imports: competitions.imports(),
    canSaveImports: datadir.canSaveImports(), dataDir: datadir.DATA_DIR, dataLocation: datadir.location.local ? null : { name: datadir.location.name, computer: datadir.location.computer }, readOnly: competitions.isReadOnly(),
    fonts: fonts.bundled(), defaults: competitions.DEFAULTS, finalsFormats: finals.list(), finalsMarks: finals.MARKS });
  if (what === 'export' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const importId = competitions.saveAsImport(id, body.importId, !!body.replace);
      log('info', 'setup', `Saved ${id} as the import config imports/${importId}`);
      return send(res, 200, { importId, imports: competitions.imports() });
    } catch (err) {
      if (err.exists) return send(res, 409, { error: err.message, exists: err.exists });
      throw err;
    }
  }
  if (what === 'activate' && req.method === 'POST') {
    competitions.setActive(id);
    applyCompetition('Switched competition');
    return send(res, 200, setupInfo(id));
  }
  // The CSS that loads a font for the setup page's preview, with this competition's added fonts.
  if (what === 'fontcss') {
    return send(res, 200, fonts.css(q.font, fontPaths(id), f => `/api/setup/${id}/image?kind=fonts&name=${encodeURIComponent(path.basename(f))}`,
      { mac: await fonts.macFaces(q.font), size: (Number(q.size) || 100) / 100 }), 'text/css; charset=utf-8');
  }
  if (what === 'image') {
    const kind = ['brand', 'fonts'].includes(q.kind) ? q.kind : 'logos';
    if (req.method === 'POST') {
      const name = competitions.saveImage(id, kind, q.name, await readRaw(req, 15 * 1024 * 1024));
      log('info', 'setup', `${id}: added ${{ brand: 'competition logo', fonts: 'font file' }[kind] || 'team logo'} ${name}`);
      return send(res, 200, { name, ...(kind === 'fonts' ? { family: fonts.fontFile(name).family } : {}), ...setupInfo(id) });
    }
    if (req.method === 'DELETE') {
      competitions.deleteImage(id, kind, q.name);
      log('info', 'setup', `${id}: removed ${kind} ${q.name}`);
      return send(res, 200, setupInfo(id));
    }
    const file = competitions.imageFile(id, kind, q.name || '');
    return fs.readFile(file || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'));
  }
  if (req.method === 'POST') {
    competitions.save(id, await readBody(req));
    log('info', 'setup', `Saved the ${id} competition setup`);
    if (id === competitions.activeId()) applyCompetition('Competition setup saved');
    return send(res, 200, setupInfo(id));
  }
  if (what === 'template') return send(res, 200, { ...competitions.exportTemplate(id), sponsors: sponsors.exportFor(id) });
  if (req.method === 'DELETE') {
    const wasActive = id === competitions.activeId();
    const active = competitions.remove(id);
    log('info', 'setup', `Deleted the ${id} competition setup${wasActive ? `; now using ${active || 'no competition'}` : ''}`);
    if (wasActive) applyCompetition('Competition in use deleted');
    return send(res, 200, { ok: true, active });
  }
  return send(res, 200, setupInfo(id));
}

// ─── Game Summary v2 (team lists and shooting stats) ────────────────────────
// PlayHQ's REST "Summary for the Game v2". Settings in config.json:
//   apiBaseUrl       default https://api.playhq.com
//   gameSummaryPath  default /v2/games/{id}/summary
//   apiKey           sent as x-api-key if set (PlayHQ normally issues one per association)
//   apiTenant        sent as x-phq-tenant, default the tenant from organisationUrl
// The last answer is saved to last-game-summary.json, so its layout can be checked.
const SUMMARY_BASE = (CONFIG.apiBaseUrl || 'https://api.playhq.com').replace(/\/$/, '');
const SUMMARY_PATH = CONFIG.gameSummaryPath || '/v2/games/{id}/summary';

async function fetchGameSummary(gameId) {
  // Public "Summary for the Game": x-api-key (PlayHQ's Client ID) + x-phq-tenant, no login token.
  // If the configured version isn't there, try the other one (v2 <-> v1).
  const headers = { accept: 'application/json', 'x-phq-tenant': CONFIG.apiTenant || playhq.organisation().tenant };
  if (CONFIG.apiKey) headers['x-api-key'] = CONFIG.apiKey;
  const other = /\/v2\//.test(SUMMARY_PATH) ? SUMMARY_PATH.replace('/v2/', '/v1/') : SUMMARY_PATH.replace('/v1/', '/v2/');
  let url, res;
  for (const p of [...new Set([SUMMARY_PATH, other])]) {
    url = SUMMARY_BASE + p.replace('{id}', encodeURIComponent(gameId));
    res = await fetch(url, { headers });
    log(res.ok ? 'info' : 'warn', 'summary', `Game Summary HTTP ${res.status} ${url}${CONFIG.apiKey ? ' (with apiKey)' : ' (no apiKey)'}`);
    if (res.status !== 404) break;
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error(`PlayHQ refused the Game Summary (HTTP ${res.status}).` +
      (CONFIG.apiKey ? ' Check the PlayHQ Client ID on the competition setup page.'
        : ' PlayHQ needs a Client ID for this: ask the association for it and add it on the competition setup page.'));
  }
  if (!res.ok) throw new Error(`PlayHQ Game Summary answered HTTP ${res.status} for ${url}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('PlayHQ Game Summary was not JSON'); }
  fs.writeFile(datadir.local('last-game-summary.json'), JSON.stringify(json, null, 2), () => {});
  return json;
}

// The summary's exact layout isn't known in advance, so read it loosely:
// a "team" is any object with a name/id and a list of people who have names.
const PERSON_LIST_KEYS = /^(players|participants|lineup|lineUp|lineups|appearances|members|roster|squad|teamList)$/i;
function personName(p) {
  if (!p || typeof p !== 'object') return '';
  const inner = p.profile || p.participant || p.player || p.person || {};
  const first = p.firstName || inner.firstName || '';
  const last = p.lastName || inner.lastName || '';
  return (first || last) ? `${first} ${last}`.trim() : (p.name || inner.name || p.displayName || p.fullName || '');
}
function statValue(x) {
  const v = x && (x.value ?? x.count ?? x.total ?? x.amount);
  return typeof v === 'object' && v !== null ? Number(v.value ?? v.count ?? 0) : Number(v || 0);
}
function statType(x) {
  const t = x && (x.type ?? x.statisticType ?? x.name ?? x.key ?? x.code);
  return String(typeof t === 'object' && t !== null ? (t.value || t.name || t.code || '') : t || '').toUpperCase();
}
// Collect every { type, value } statistic under a player, adding up repeats (e.g. per quarter).
function collectStats(p) {
  const out = {};
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 4 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
    const t = statType(o);
    if (t && ('value' in o || 'count' in o || 'total' in o)) { out[t] = (out[t] || 0) + statValue(o); return; }
    for (const [k, v] of Object.entries(o)) {
      if (/^(scoreSubTotal|subTotals?|periods?|quarters?)$/i.test(k)) continue; // totals are enough
      if (v && typeof v === 'object') walk(v, depth + 1);
      else if (typeof v === 'number' && /goal|attempt|miss|super|shot/i.test(k)) out[k.toUpperCase()] = (out[k.toUpperCase()] || 0) + v;
    }
  };
  walk(p.statistics || p.stats || p.scoreTotal || p.scores || p, 0);
  return out;
}
function shooting(stats) {
  let goals = 0, attempts = 0, misses = 0, superGoals = 0, superAttempts = 0, superMisses = 0, sawAttempts = false, sawSuperAttempts = false;
  for (const [t, v] of Object.entries(stats)) {
    const isSuper = /SUPER|2_?POINT|TWO_?POINT/.test(t);
    if (/AGAINST|PENALTY|CONCEDED|INTERCEPT|REBOUND/.test(t)) continue;
    if (/ATTEMPT/.test(t)) { if (isSuper) { superAttempts += v; sawSuperAttempts = true; } else { attempts += v; sawAttempts = true; } }
    else if (/MISS/.test(t)) { if (isSuper) superMisses += v; else misses += v; }
    else if (/GOAL|SHOT|SCORED/.test(t) && !/TOTAL_SCORE|POINTS/.test(t)) { if (isSuper) superGoals += v; else goals += v; }
  }
  if (!sawAttempts) attempts = goals + misses;
  if (!sawSuperAttempts) superAttempts = superGoals + superMisses;
  return { goals, attempts, superGoals, superAttempts };
}

const POSITION_ORDER = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
function positionOf(p) {
  const raw = p.playerPosition || p.position || p.positionName || (p.positions && p.positions[0]) || '';
  const v = typeof raw === 'object' ? (raw.abbreviation || raw.shortName || raw.value || raw.name || '') : raw;
  const s = String(v).toUpperCase().replace(/[^A-Z]/g, '');
  const long = { GOALSHOOTER: 'GS', GOALATTACK: 'GA', WINGATTACK: 'WA', CENTRE: 'C', CENTER: 'C', WINGDEFENCE: 'WD', WINGDEFENSE: 'WD', GOALDEFENCE: 'GD', GOALDEFENSE: 'GD', GOALKEEPER: 'GK' };
  return long[s] || (POSITION_ORDER.includes(s) ? s : String(v || ''));
}

function parseSummary(json, board) {
  const teams = [];
  const seen = new Set();
  const walk = (o, parent, depth) => {
    if (!o || typeof o !== 'object' || depth > 8 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach(x => walk(x, parent, depth + 1)); return; }
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && PERSON_LIST_KEYS.test(k) && v.some(personName)) {
        const team = { id: o.id || (o.team && o.team.id) || null, name: o.name || (o.team && o.team.name) || o.teamName || '', isHome: o.isHomeTeam ?? (o.team && o.team.isHomeTeam), raw: o, players: v };
        teams.push(team);
      } else if (v && typeof v === 'object') walk(v, o, depth + 1);
    }
  };
  walk(json, null, 0);

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (side, other) => {
    const want = norm(board[side].name);
    return teams.find(t => t.name && norm(t.name) === want)
      || teams.find(t => t.isHome === (side === 'home') && t !== other)
      || teams.filter(t => t !== other)[side === 'home' ? 0 : 0];
  };
  const home = pick('home', null);
  const away = pick('away', home);
  const build = (t, side) => {
    const name = (t && t.name) || board[side].name;
    const players = ((t && t.players) || []).map(p => {
      const stats = collectStats(p);
      const roles = JSON.stringify([p.roleType, p.role, p.roles, p.captainRole, p.isCaptain]).toUpperCase();
      return {
        name: personName(p),
        number: p.playerNumber ?? p.number ?? p.jerseyNumber ?? (p.participant && p.participant.playerNumber) ?? '',
        position: positionOf(p),
        captain: /CAPTAIN|"C"|TRUE/.test(roles) && !/VICE/.test(roles),
        viceCaptain: /VICE/.test(roles),
        nonPlaying: /COACH|MANAGER|UMPIRE|OFFICIAL|TRAINER|SCORER/.test(roles),
        stats,
        shooting: (s => ({ ...s, shots: s.attempts + s.superAttempts, points: s.goals + 2 * s.superGoals }))(shooting(stats)),
      };
    }).filter(p => p.name && !p.nonPlaying);
    const rank = p => { const i = POSITION_ORDER.indexOf(p.position); return i === -1 ? 99 : i; };
    players.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(b.name));
    return { name, logo: logoFor(name), players };
  };
  return { home: build(home, 'home'), away: build(away, 'away'), teamsFound: teams.length };
}

// ─── Team logos, athlete photos and the athlete register ────────────────────
// All in athletes.js; this is the register for the competition in use.
const athleteRegister = require('./athletes').create({
  log, config: () => CONFIG, competitions, savefile, playhq, board: () => board(),
  getSeasonGames: g => getSeasonGames(g), getTeamSheets: () => getTeamSheets(), setupTeams: o => setupTeams(o),
  norm: s => norm(s), sameTeam: (a, b) => sameTeam(a, b), send, readBody, readRaw,
});
const { logoFor, colourFor, photoFor, photoKey, genderInfo, silhouette, athleteTeams, athletes, withPhotos, withSquad, squadFor, athletesRoute } = athleteRegister;
// ─── Team list warm up ──────────────────────────────────────────────────────
// A team list needs the game's line up and, while that's incomplete, both teams' season
// squads, which means reading each of their games this season. That is done ahead, so
// teamlist.html shows straight away: when a game is picked (by hand or automatically), at
// start up for the game already on the scoreboard, and for the next game on the same court.
// Finished games are kept (game-cache.json), so after the first time this is only the
// teams' upcoming games, a handful of small requests per game picked.
let warmedFor = '';
async function warmTeamLists(why) {
  const b = board();
  if (!b.gameId || warmedFor === b.gameId) return;
  const gameId = warmedFor = b.gameId;
  const started = Date.now();
  const teams = [[b.home.name, b.division], [b.away.name, b.division]];
  try {
    await getGame(gameId, 60 * 1000);
    try {
      const next = await getUpNext();
      if (next && !next.error && next.home && next.away) teams.push([next.home.name, next.division], [next.away.name, next.division]);
    } catch (err) { log('warn', 'teams', `Warm up: next game not found: ${err.message}`); }
    const real = teams.filter(([name]) => name && name !== 'TBC' && !/^home$|^away$/i.test(name));
    await Promise.all(real.map(([name, division]) => squadFor(name, division)));
    log('info', 'teams', `Team lists ready for ${real.map(t => t[0]).join(', ')} (${why}, ${Date.now() - started}ms)`);
  } catch (err) {
    if (warmedFor === gameId) warmedFor = ''; // try again next time
    log('warn', 'teams', `Team list warm up failed (${why}): ${err.message}`);
  }
}

// The team lists must follow the scoreboard's home and away (the round fixture's).
// PlayHQ's game page data doesn't always agree with it: its teams can be listed the other
// way round, and its line-ups can sit under the other team. The teams are matched by name,
// then each line-up by its goals against the live feed's team totals (a team's players
// can't have scored more than the team).
const orientLogged = new Set();
function orientToBoard(game, b, live) {
  const note = (what) => {
    const k = `${b.gameId}|${what}`;
    if (!orientLogged.has(k)) { orientLogged.add(k); log('info', 'teams', `game ${b.gameId}: ${what}`); }
  };
  const named = (side, name) => sameTeam(side.name, name);
  if ((named(game.home, b.away.name) || named(game.away, b.home.name)) && !named(game.home, b.home.name) && !named(game.away, b.away.name)) {
    note(`PlayHQ lists ${game.home.name} as home and ${game.away.name} as away, the other way round from the fixture; swapped to match the scoreboard`);
    game = { ...game, home: game.away, away: game.home };
  }
  if (!live) return game;
  const sums = side => side.players.reduce((t, p) => ({ goals: t.goals + (p.shooting.goals || 0), superGoals: t.superGoals + (p.shooting.superGoals || 0) }), { goals: 0, superGoals: 0 });
  const h = sums(game.home), a = sums(game.away);
  if (!h.goals && !h.superGoals && !a.goals && !a.superGoals) return game;
  const over = (p, team) => (team.goals != null && p.goals > team.goals) || (team.superGoals != null && p.superGoals > team.superGoals);
  const off = (p, team) => Math.abs(p.goals - (team.goals || 0)) + Math.abs(p.superGoals - (team.superGoals || 0));
  const straightBad = over(h, live.home) || over(a, live.away);
  const swappedBad = over(a, live.home) || over(h, live.away);
  const swappedCloser = !straightBad && !swappedBad && off(a, live.home) + off(h, live.away) === 0 && off(h, live.home) + off(a, live.away) > 0;
  if ((straightBad && !swappedBad) || swappedCloser) {
    note(`PlayHQ's line-ups sit under the other team (player goals ${h.goals}+${h.superGoals} / ${a.goals}+${a.superGoals}, team goals ${live.home.goals}+${live.home.superGoals} / ${live.away.goals}+${live.away.superGoals}); swapped the players`);
    game = { ...game, home: { ...game.home, players: game.away.players }, away: { ...game.away, players: game.home.players } };
  }
  return game;
}

// Whether PlayHQ is scoring the game: 'live', 'not-started', 'finished', or '' when it can't
// be told. A finished game's status wins; otherwise the live feed's answer, then the game's status.
function scoringState(fromLiveFeed, status) {
  if (/COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(status || '')) return 'finished';
  if (fromLiveFeed) return fromLiveFeed;
  if (/PROGRESS|LIVE|STARTED/i.test(status || '')) return 'live';
  if (/UPCOMING|SCHEDULED/i.test(status || '')) return 'not-started';
  return '';
}

const summaryCache = new Map();
async function getTeamSheets() {
  const b = board();
  const base = { home: { name: b.home.name, logo: logoFor(b.home.name), players: [] }, away: { name: b.away.name, logo: logoFor(b.away.name), players: [] } };
  const meta = { division: b.division, court: b.court, period: b.period, score: { home: b.home.score, away: b.away.score }, competition: competitionName(), rules: rules(b.division) };
  if (!b.gameId) return { ...meta, ...base, error: 'No PlayHQ game picked on the control page yet.' };
  const maxAge = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
  let gqlError = '';
  try {
    // The line ups and (below) the team totals are asked for at the same time.
    const gameAsked = getGame(b.gameId, maxAge);
    gameAsked.catch(() => {}); // handled where it's awaited
    // Team totals from the live feed: PlayHQ doesn't credit every goal to a player.
    let live = null, scoring = '';
    try { live = await getLive(b.gameId, maxAge); scoring = 'live'; }
    catch (err) {
      if (err.notYet || err.notScored) scoring = 'not-started';
      else log('warn', 'teams', `Live totals failed: ${err.message}`);
    }
    const game = orientToBoard(await gameAsked, b, live);
    // PlayHQ only has line ups once the game is being scored (its game page has no statistics
    // before then), so the position match ups say whether live scoring has started.
    meta.scoring = scoringState(scoring, game.status);
    // A team without a full line up has the rest of its season squad added.
    const g = { home: await withSquad(game.home, b.division), away: await withSquad(game.away, b.division) };
    if (g.home.players.length || g.away.players.length || !CONFIG.apiKey) {
      const error = g.home.players.length || g.away.players.length ? undefined : 'PlayHQ has no line-ups for this game yet.';
      if (live) { g.home.totals = live.home; g.away.totals = live.away; }
      return { ...meta, home: g.home, away: g.away, error, updatedAt: new Date().toISOString() };
    }
  } catch (err) {
    gqlError = err.message;
    log('warn', 'teams', `Game detail failed: ${err.message}`);
    if (!CONFIG.apiKey) return { ...meta, ...base, error: err.message };
  }
  // Only with an apiKey: PlayHQ's REST "Summary for the Game".
  const hit = summaryCache.get(b.gameId);
  try {
    let json = hit && Date.now() - hit.at < maxAge ? hit.json : null;
    if (!json) { json = await fetchGameSummary(b.gameId); summaryCache.set(b.gameId, { at: Date.now(), json }); }
    const parsed = parseSummary(json, b);
    if (!parsed.teamsFound) return { ...meta, ...base, error: 'PlayHQ answered, but no team lists were found in it (see last-game-summary.json).' };
    return { ...meta, ...parsed, updatedAt: new Date().toISOString() };
  } catch (err) {
    if (hit) return { ...meta, ...parseSummary(hit.json, b), stale: true, error: err.message };
    return { ...meta, ...base, error: err.message };
  }
}

// ─── Season graphics: results, ladder bar, head to head, form, ticker, shooters ─
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameTeam = (a, b) => norm(a) && norm(a) === norm(b);

function isLive(g) { return /PROGRESS|LIVE|STARTED/i.test(g.status || ''); }
function resultFor(g, teamName) {
  const mine = sameTeam(g.home.name, teamName) ? g.home : g.away;
  const theirs = mine === g.home ? g.away : g.home;
  const o = String(mine.outcome || '').toUpperCase();
  const r = /WIN|WON/.test(o) ? 'W' : /LOS/.test(o) ? 'L' : /DRAW/.test(o) ? 'D'
    : mine.score > theirs.score ? 'W' : mine.score < theirs.score ? 'L' : 'D';
  return { result: r, opponent: theirs.name, for: mine.score, against: theirs.score };
}

// Every game of a division this season (past rounds are kept for 10 minutes).
async function getSeasonGames(grade) {
  const out = [];
  for (const r of await getRounds(grade.id)) {
    for (const g of await getRoundGames(r.id, r.current ? 60 * 1000 : 10 * 60 * 1000)) {
      out.push({ ...g, division: grade.name, round: r.name, roundNumber: r.number });
    }
  }
  const key = x => `${x.date || ''} ${String(x.time || '').padStart(5, '0')}`;
  return out.sort((a, b) => key(a).localeCompare(key(b)));
}

// The division of the game on the scoreboard (or ?division=).
async function gradeFor(b, q) {
  const st = await getStructure();
  if (q && q.division) return findGrade(st, q);
  return st.grades.find(g => g.name === b.division) || st.grades.find(g => norm(g.name) === norm(b.division)) || null;
}
function teamsOf(b) {
  return { home: { name: b.home.name, logo: logoFor(b.home.name) }, away: { name: b.away.name, logo: logoFor(b.away.name) } };
}
function competitionName() { const st = playhq.structureNow(); return (st && st.competition) || CONFIG.displayName || CONFIG.competitionName; }
// The competition's rules and look, for pages that change with them. With a division, super
// shots are that division's (a competition can play them in some divisions only).
function rules(division) {
  // Light and dark mode competition logos; when only one is set it is used for both.
  const brandUrl = f => f ? '/brand/' + encodeURIComponent(f) : null;
  const light = brandUrl(CONFIG.competitionLogo || CONFIG.competitionLogoDark), dark = brandUrl(CONFIG.competitionLogoDark || CONFIG.competitionLogo);
  return { periodType: CONFIG.periodType, periods: CONFIG.periodType === 'halves' ? 2 : 4, periodLabel: CONFIG.periodType === 'halves' ? 'H' : 'Q',
    periodMinutes: CONFIG.quarterMinutes, superShots: competitions.superShotsFor(CONFIG, division), superShotMinutes: CONFIG.superShotMinutes ?? 3, finalsPlaces: (finals.byId(CONFIG.finalsFormat) || { teams: 0 }).teams,
    competitionLogo: light, competitionLogoLight: light, competitionLogoDark: dark,
    competitionName: competitionName() || '' };
}

// ─── Finals ─────────────────────────────────────────────────────────────────
// Each division's finals format comes from the competition setup (finals.js has the formats).
// The teams come from the ladder. PlayHQ often has no finals fixtures: when it does (rounds
// with "final" or "play-off" in their name), their games, times, courts and scores are used;
// otherwise winners are entered on the control page and kept in control.json.
const FINALS_ROUND = /final|play.?off/i;
const finalsKey = (division, format) => `${division}|${format.id}`;
function finalsFor(division) { return finals.formatFor(CONFIG, division); }
function finalsGrade(st, q) { return findGrade(st, q.division ? q : { division: board().division || '1' }); }

async function getFinals(q) {
  const st = await getStructure();
  const grade = finalsGrade(st, q);
  if (!grade) throw new Error(`No division "${q.division}". This season has: ${st.grades.map(g => g.name).join(', ')}`);
  let format = finalsFor(grade.name);
  const base = { organisation: st.organisation, competition: st.competition, season: st.season.name, division: grade.name, divisionNumber: grade.division, rules: rules(grade.name) };
  if (!format) return { ...base, format: null, games: [], error: `${grade.name} has no finals format. Pick one on the competition setup page.` };
  const ladder = await getLadder(grade.id);
  const rows = ladder.pools[0] || [];
  const seeds = rows.map(r => r.team);
  format = finals.sized(format, rows.length);
  // Only the finals rounds, and the last home and away round, are asked for (not the whole season),
  // and a round PlayHQ doesn't answer for (a 504) is left out rather than failing the page.
  const real = n => n && !/^(tbc|tba|bye)$/i.test(n);
  const rounds = await getRounds(grade.id);
  const finalsRounds = rounds.filter(r => FINALS_ROUND.test(r.name || ''));
  const lastRegular = rounds.filter(r => !FINALS_ROUND.test(r.name || '')).pop();
  const gamesOf = async r => {
    try { return await getRoundGames(r.id, r.current ? 60 * 1000 : 10 * 60 * 1000); }
    catch (err) { log('warn', 'finals', `${grade.name} ${r.name}: left out, PlayHQ didn't answer (${err.message})`); return null; }
  };
  const played = [];
  for (const [i, r] of finalsRounds.entries()) {
    for (const g of (await gamesOf(r)) || []) {
      if (real(g.home.name) && real(g.away.name)) played.push({ ...g, round: r.name, week: i + 1, finished: isFinished(g) });
    }
  }
  // Until the last home and away game is finished, the finals are "if the season ended today".
  const lastGames = lastRegular && !played.length ? (await gamesOf(lastRegular)) || [] : [];
  const projected = lastGames.some(g => real(g.home.name) && real(g.away.name) && !isFinished(g));
  const manual = (control.finals || {})[finalsKey(grade.name, format)] || {};
  const r = finals.resolve(format, seeds, played, manual);
  const withLogo = t => t.name ? { ...t, logo: logoFor(t.name), colour: colourFor(t.name) } : t;
  const marks = finals.ladderMarks(format);
  log('info', 'finals', `${grade.name}: ${format.name}, ${played.length} finals game${played.length === 1 ? '' : 's'} on PlayHQ, ${Object.keys(manual).length} entered by hand${projected ? ', season not finished' : ''}`);
  return { ...base,
    format: { id: format.id, name: format.name, summary: format.summary, teams: format.teams, all: !!format.all, weeks: format.weeks, series: !!format.series },
    projected, pools: ladder.pools.length, playhqFinals: played.length, finalsRounds: finalsRounds.map(r => r.name),
    ladder: rows.slice(0, format.teams).map((row, i) => ({ position: row.position, team: row.team, logo: logoFor(row.team), points: row.points, mark: marks.marks[i] })),
    legend: marks.legend,
    games: r.games.map(g => ({ ...g, home: withLogo(g.home), away: withLogo(g.away) })),
    champion: r.champion ? { name: r.champion, logo: logoFor(r.champion), colour: colourFor(r.champion) } : null };
}

// A finals winner entered by hand (winner blank clears it).
async function setFinalsResult(body) {
  const st = await getStructure();
  const grade = finalsGrade(st, body);
  if (!grade) throw new Error(`No division "${body.division}"`);
  // A format for every team has as many games as the ladder has pairs.
  const format = finals.sized(finalsFor(grade.name), ((await getLadder(grade.id)).pools[0] || []).length);
  if (!format || !format.games.some(g => g.id === body.game)) throw new Error(`${grade.name} has no finals game ${body.game}`);
  const key = finalsKey(grade.name, format);
  control.finals = control.finals || {};
  const all = control.finals[key] = control.finals[key] || {};
  const score = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.round(Number(v))));
  if (!body.winner) delete all[body.game];
  else all[body.game] = { winner: String(body.winner), homeScore: score(body.homeScore), awayScore: score(body.awayScore) };
  if (!Object.keys(all).length) delete control.finals[key];
  saveControl();
  log('info', 'finals', `${grade.name} ${body.game}: ${body.winner ? `${body.winner} won${all[body.game].homeScore !== undefined ? ` ${all[body.game].homeScore}-${all[body.game].awayScore}` : ''}` : 'result cleared'} (entered by hand)`);
  return getFinals({ division: String(grade.division) });
}

async function getLadderBar() {
  const b = board();
  const grade = await gradeFor(b);
  if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
  const rows = (await getLadder(grade.id)).pools.flat();
  const row = name => rows.find(r => sameTeam(r.team, name)) || null;
  const t = teamsOf(b);
  return { competition: competitionName(), division: grade.name, teams: rows.length,
    home: { ...t.home, ladder: row(b.home.name) }, away: { ...t.away, ladder: row(b.away.name) } };
}

// The person lower third (lowerthird.html). An athlete is found in the athlete register by name (case,
// punctuation and word order don't matter, like the photos): their team, its club logo and their photo.
// ?team= picks the team for an athlete in more than one; otherwise one of the game's two teams if they
// play for it, else the first the register has. A guest or commentator needs nothing from here but the
// competition's logos, which every answer carries.
function getLowerThird(q) {
  const r = rules();
  const out = { competition: competitionName(), competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark };
  if (q.type === 'guest' || !String(q.name || '').trim()) return out;
  const e = athletes()[photoKey(q.name)];
  const name = (e && e.name) || String(q.name).trim();
  const teams = athleteTeams(name);
  const b = board();
  const playing = [b.home.name, b.away.name];
  const pick = (q.team && (teams.find(t => sameTeam(t.team, q.team)) || { team: String(q.team).trim(), division: '' })) ||
    teams.find(t => playing.some(n => sameTeam(n, t.team)) && (!b.division || t.division === b.division)) ||
    teams.find(t => playing.some(n => sameTeam(n, t.team))) || teams[0] || null;
  if (!e) log('info', 'lowerthird', `${name} is not in the athlete register yet (it fills as line ups are read)`);
  const g = genderInfo(name);
  out.athlete = { name, known: !!e, team: pick ? pick.team : '', division: pick ? pick.division : '', logo: pick ? logoFor(pick.team) : null,
    photo: photoFor(name), silhouette: silhouette(g.gender) };
  return out;
}

// The athletes the Output page suggests for the person lower third: only the active competition's, and
// of those only athletes seen in a division of its current PlayHQ season (an athlete left in the register
// from an earlier season isn't offered). Each has their teams, so the page can narrow them to one team or
// to the two teams in the game picked on the control page. Nothing here asks PlayHQ.
function getLowerThirdAthletes() {
  const divisions = new Set(((playhq.structureNow() || {}).grades || []).map(g => norm(g.name)));
  let list = Object.values(athletes()).map(e => ({ name: e.name, teams: athleteTeams(e.name) })).filter(a => a.teams.length);
  const current = list.filter(a => a.teams.some(t => divisions.has(norm(t.division))));
  if (current.length) list = current.map(a => ({ ...a, teams: a.teams.filter(t => divisions.has(norm(t.division))) }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const teams = [];
  for (const a of list) for (const t of a.teams) if (!teams.some(x => x.team === t.team && x.division === t.division)) teams.push(t);
  teams.sort((a, b) => a.team.localeCompare(b.team) || a.division.localeCompare(b.division, 'en', { numeric: true }));
  const b = board();
  const game = [b.home.name, b.away.name].filter(n => n && n !== 'TBC' && !/^home$|^away$/i.test(n));
  return { competition: competitionName(), game: { teams: game, division: b.division || '' }, teams, athletes: list };
}

async function getHeadToHead() {
  const b = board();
  const grade = await gradeFor(b);
  if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
  const games = (await getSeasonGames(grade)).filter(g => g.id !== b.gameId && isFinished(g) &&
    ((sameTeam(g.home.name, b.home.name) && sameTeam(g.away.name, b.away.name)) || (sameTeam(g.home.name, b.away.name) && sameTeam(g.away.name, b.home.name))));
  const tally = { home: 0, away: 0, draws: 0 };
  for (const g of games) {
    const r = resultFor(g, b.home.name).result;
    if (r === 'W') tally.home++; else if (r === 'L') tally.away++; else tally.draws++;
  }
  return { competition: competitionName(), division: grade.name, ...teamsOf(b), tally,
    games: games.map(g => ({ round: g.round, date: g.date, home: g.home, away: g.away })) };
}

async function getForm(count) {
  const b = board();
  const grade = await gradeFor(b);
  if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
  const finished = (await getSeasonGames(grade)).filter(g => g.id !== b.gameId && isFinished(g));
  const n = Math.min(10, Math.max(1, Number(count) || 5));
  const form = name => finished.filter(g => sameTeam(g.home.name, name) || sameTeam(g.away.name, name)).slice(-n)
    .map(g => ({ round: g.round, ...resultFor(g, name) }));
  const t = teamsOf(b);
  return { competition: competitionName(), division: grade.name,
    home: { ...t.home, form: form(b.home.name) }, away: { ...t.away, form: form(b.away.name) } };
}

// Live and finished scores from the current round, leaving out the game on the scoreboard.
async function getTicker() {
  const b = board();
  const games = (await getCurrentGames()).filter(g => g.id !== b.gameId && (isLive(g) || isFinished(g) || (g.home.score !== null && g.away.score !== null)));
  // The round fixture has no scores until a game is final, so read live games one by one.
  await Promise.all(games.filter(isLive).map(async g => {
    try {
      const d = await liveScore(g, 20 * 1000);
      if (d) { g.home = { ...g.home, score: d.home }; g.away = { ...g.away, score: d.away }; }
    } catch (err) { log('warn', 'ticker', `Live score for ${g.home.name} v ${g.away.name} failed: ${err.message}`); }
  }));
  return { competition: competitionName(), speed: b.tickerSpeed || TICKER_SPEED, games: games.map(g => ({ ...g, live: isLive(g), finished: isFinished(g) })) };
}

// Season shooting totals from the Game Summary of every finished game in a division.
// Finished games don't change, so their line ups are kept (see game-cache.json).
async function getTopShooters(q) {
  const st = await getStructure();
  const grade = findGrade(st, q.division ? q : { division: board().division || '1' });
  if (!grade) throw new Error(`No division "${q.division}"`);
  const games = (await getSeasonGames(grade)).filter(isFinished);
  const players = new Map();
  let read = 0, failed = 0, lastError = '';
  const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 60 * 1000));
  for (const [i, g] of games.entries()) {
    if (lineups[i].error) { failed++; lastError = lineups[i].error.message; continue; }
    const parsed = lineups[i].value;
    read++;
    for (const side of ['home', 'away']) {
      for (const p of parsed[side].players) {
        const sh = p.shooting;
        if (p.private || (!sh.goals && !sh.superGoals)) continue; // "Private player" can't be told apart
        const team = parsed[side].name;
        const k = norm(p.name) + '|' + norm(team);
        const t = players.get(k) || { name: p.name, team, logo: logoFor(team), games: 0, goals: 0, superGoals: 0, shots: 0, points: 0 };
        t.games++; t.goals += sh.goals; t.superGoals += sh.superGoals; t.shots += sh.shots || 0; t.points += sh.points;
        players.set(k, t);
      }
    }
  }
  const limit = Math.min(20, Math.max(1, Number(q.limit) || 8));
  const all = [...players.values()];
  const by = f => [...all].sort((a, b) => f(b) - f(a) || a.name.localeCompare(b.name)).slice(0, limit);
  if (failed) log('warn', 'shooters', `${failed} of ${games.length} games could not be read: ${lastError}`);
  return { competition: competitionName(), rules: rules(grade.name), division: grade.name, gamesRead: read, gamesFinished: games.length,
    error: !read && failed ? lastError : undefined,
    points: by(p => p.points), goals: by(p => p.goals), superGoals: by(p => p.superGoals) };
}

competitions.init(log, { readOnly: DATA_STATE.readOnly });
applyCompetition('Using competition');

// ─── HTTP ───────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.yaml': 'application/yaml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };

function send(res, status, body, type) {
  // No access-control-allow-origin: Studio's pages are served by Studio, so they are the same origin, and the
  // Stream Deck plugin isn't a browser. A web page from anywhere else can't read or drive Studio from a browser.
  res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Addresses already logged as refused a change (one line each, not one per press).
const refusedFrom = new Set();
// Requests that pages repeat every second or two are only logged when they fail.
const QUIET = new Set(['/api/version', '/api/log', '/api/scene/events']);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  const started = Date.now();
  res.on('finish', () => {
    const polled = QUIET.has(url.pathname) || (req.method === 'GET' && (url.pathname === '/api/scoreboard' || url.pathname === '/api/teams' || url.pathname === '/api/goals' || url.pathname === '/api/countdown' || url.pathname === '/api/ticker/speed'));
    const asset = req.method === 'GET' && !/\.html$|^\/$|^\/api\/|^\/deck\//.test(url.pathname);
    if (res.statusCode >= 400 || !(polled || asset)) {
      log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http',
        `${req.method} ${url.pathname}${url.search} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  try {
    // config.json "remoteChanges": false keeps changes (anything but reading, and the Stream Deck links) to this computer.
    const refused = access.refusal(MACHINE.remoteChanges, req.method, url.pathname, req.socket.remoteAddress);
    if (refused) {
      const from = access.strip(req.socket.remoteAddress);
      if (!refusedFrom.has(from)) { refusedFrom.add(from); log('warn', 'access', refused); }
      return send(res, 403, { error: refused });
    }
    if (url.pathname === '/api/log') {
      if (req.method === 'POST') {
        const e = await readBody(req);
        log(['error', 'warn'].includes(e.level) ? e.level : 'info', `page ${String(e.page || '?').slice(0, 80)}`, e.message || '', e.detail);
        return send(res, 204, '');
      }
      // Open http://localhost:8080/api/log to read the log in a browser.
      return fs.readFile(LOG_FILE, (err, buf) => send(res, 200, err ? 'The log is empty.' : buf, 'text/plain; charset=utf-8'));
    }
    if (url.pathname === '/api/structure') return send(res, 200, { ...await getStructure(), setup: CONFIG.name, rules: rules() });
    if (url.pathname.startsWith('/api/setup')) return await setupRoute(req, res, url, q);
    // The competition in use: its colours and font, team logos, competition logo, athlete photos and added fonts.
    if (url.pathname === '/theme.css') return send(res, 200, competitions.themeCss(CONFIG, fontPaths(competitions.activeId()), await fonts.macFaces(CONFIG.font)), 'text/css; charset=utf-8');
    if (/^\/(logos|brand|photos|fonts)\//.test(url.pathname)) {
      const file = competitions.imageFile(competitions.activeId(), url.pathname.split('/')[1], url.pathname.split('/')[2] || '');
      return fs.readFile(file || '', (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'));
    }
    if (url.pathname === '/api/ladder') {
      const st = await getStructure();
      // No ?division: the division of the game picked on the control page.
      const grade = findGrade(st, q.division ? q : { division: board().division || '1' });
      if (!grade) return send(res, 404, { error: `No division "${q.division}". This season has: ${st.grades.map(g => g.name).join(', ')}` });
      const ladder = await getLadder(grade.id);
      const marks = finals.ladderMarks(finals.sized(finalsFor(grade.name), Math.max(0, ...ladder.pools.map(p => p.length))));
      return send(res, 200, { organisation: st.organisation, competition: st.competition, season: st.season.name, division: grade.name,
        rules: { ...rules(grade.name), finalsPlaces: marks.places }, finals: marks, ...ladder });
    }
    if (url.pathname === '/api/version') return send(res, 200, { version: pageVersion(), base: LINK_BASE });
    if (url.pathname === '/api/health') return send(res, 200, health());
    if (url.pathname === '/api/settings/export' && req.method === 'GET') {
      // Every setting in one zip with its summary (datalocation.exportEntries); ?media=0 leaves out the media folder, ?notes= heads the summary.
      const name = datalocation.exportName();
      const { list, skipped } = datalocation.exportEntries(datadir.DATA_DIR, { media: q.media !== '0', folder: name, about: { studio: pageVersion() }, notes: String(q.notes || '').slice(0, 5000) });
      if (skipped.length) log('warn', 'settings', `Exporting the settings without ${skipped.join(', ')}: not downloaded from iCloud yet`);
      res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}.zip"` });
      try {
        await require('./zip').write(res, list);
        log('info', 'settings', `Exported the settings as ${name}.zip: ${list.length - 2} files`);
      } catch (err) { log('warn', 'settings', `Settings export stopped: ${err.message}`); res.destroy(); }
      return;
    }
    if (url.pathname === '/api/teams') return send(res, 200, withPhotos(await getTeamSheets()));
    if (url.pathname.startsWith('/api/athletes')) return await athletesRoute(req, res, url, q);
    if (url.pathname === '/api/games') return send(res, 200, await getCurrentGames());
    if (url.pathname === '/api/rounds') {
      if (req.method === 'POST') setRoundChoice((await readBody(req)).round);
      return send(res, 200, await getRoundInfo());
    }
    if (url.pathname === '/api/countdown') return send(res, 200, getCountdown());
    if (url.pathname === '/api/introoutro') return send(res, 200, await getIntroOutro(q));
    if (url.pathname === '/api/upnext') return send(res, 200, await getUpNext({ wrap: q.wrap === '0' ? false : q.wrap === '1' ? 'force' : true }));
    if (url.pathname === '/api/ladderbar') return send(res, 200, await getLadderBar());
    if (url.pathname === '/api/lowerthird/athletes') return send(res, 200, getLowerThirdAthletes());
    if (url.pathname === '/api/lowerthird') return send(res, 200, getLowerThird(q));
    if (url.pathname === '/api/headtohead') return send(res, 200, await getHeadToHead());
    if (url.pathname === '/api/form') return send(res, 200, await getForm(q.count));
    // Asked by ticker.html every few seconds so a speed change shows straight away (no PlayHQ call).
    if (url.pathname === '/api/ticker/speed') return send(res, 200, { speed: board().tickerSpeed || TICKER_SPEED });
    if (url.pathname === '/api/ticker') return send(res, 200, await getTicker());
    if (url.pathname === '/api/topshooters') return send(res, 200, await getTopShooters(q));
    if (url.pathname === '/api/fixtures') return send(res, 200, await getFixtures(q));
    if (url.pathname === '/api/finals') return send(res, 200, await getFinals(q));
    if (url.pathname === '/api/finals/result' && req.method === 'POST') return send(res, 200, await setFinalsResult(await readBody(req)));
    if (url.pathname === '/api/outputs' || url.pathname.startsWith('/api/outputs/')) {
      if (await outputs.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/scene') || url.pathname.startsWith('/media/')) {
      if (await scene.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/viewers')) {
      if (await viewers.route(req, res, url, { send, readBody })) return;
    }
    if (url.pathname.startsWith('/api/sponsors') || url.pathname.startsWith('/sponsors/')) {
      const saveSettings = (id, changes) => { competitions.save(id, changes); if (id === competitions.activeId()) applyCompetition('Sponsor settings saved'); };
      if (await exposure.route(req, res, url, { send })) return;
      if (await sponsors.route(req, res, url, { send, readBody, readRaw, saveSettings, gave: exposure.gave, flash: exposure.flash })) return;
    }
    if (url.pathname.startsWith('/deck/')) {
      const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
      // The scene's links: /deck/layer/<name>/on|off|toggle|restart and /deck/layers/off.
      const layer = scene.deck(parts, q);
      if (layer) return send(res, layer.status, layer.body);
      // The display outputs: /deck/output/on|off|toggle.
      const output = outputs.deck(parts);
      if (output) return send(res, output.status, output.body);
      const action = deckAction(parts, q);
      if (!action) return send(res, 404, { error: `Unknown Stream Deck link ${url.pathname}. See the Stream Deck page, /api.html.` });
      const b = board();
      applyAction(b, action);
      if (['autoSelect', 'autoCourt', 'reset'].includes(action.type)) await autoPick();
      saveBoards();
      log('info', 'deck', `${action.type}: now ${b.home.score}-${b.away.score}, clock ${b.clock.running ? 'running' : 'stopped'}`, action);
      return send(res, 200, { ok: true, home: b.home.score, away: b.away.score, source: b.source, clockRunning: b.clock.running });
    }
    if (url.pathname === '/api/worm') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getWorm());
    }
    if (url.pathname === '/api/stats') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getStats());
    }
    if (url.pathname === '/api/goals') {
      await refreshFromPlayhq(board()); // shares the scoreboard's cached PlayHQ reading
      return send(res, 200, getGoals(q.count));
    }
    if (url.pathname === '/api/scoreboard') {
      const b = board();
      if (req.method === 'POST') {
        const action = await readBody(req);
        log('info', 'scoreboard', `${action.type || '?'}`, action);
        applyAction(b, action);
        if (['autoSelect', 'autoCourt', 'reset'].includes(action.type)) await autoPick();
        saveBoards();
      }
      else await refreshFromPlayhq(b);
      return send(res, 200, scoreboardJson(b));
    }
    // / is the Output page; results.html is the fixture page showing finished games.
    const ALIASES = { '/': 'output.html', '/results.html': 'fixtures.html' };
    // The Graphics page was the home page at /index.html: old links still find it.
    if (url.pathname === '/index.html') { res.writeHead(302, { location: '/graphics.html' + url.search }); return res.end(); }
    let file = path.normalize(path.join(PUBLIC_DIR, ALIASES[url.pathname] || decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream'));
  } catch (err) {
    log('error', 'http', `${req.method} ${url.pathname}${url.search} failed: ${err.message}`, err.stack ? err.stack.split('\n').slice(1, 4).join(' | ') : undefined);
    send(res, 502, { error: err.message });
  }
}).on('upgrade', (req, socket) => {
  // WebSockets: the scene's live updates for Studio's pages (scene.js).
  if (!scene.upgrade(req, socket)) socket.destroy();
}).on('error', err => {
  // Without this Node throws, the helper dies with a stack trace and the Mac app restarts it
  // five times before giving up with a generic message. Say what is wrong instead.
  if (err.code === 'EADDRINUSE') {
    const why = `Port ${PORT} is already in use, so Studio can't start. Another copy of Studio (the app, or npm start) is probably running: quit it, or set another port in config.json.`;
    log('error', 'helper', why);
    console.error(why);
    process.exit(EXIT_PORT_IN_USE);
  }
  log('error', 'helper', `Could not listen on port ${PORT}: ${err.message}`);
  console.error(`Studio can't listen on port ${PORT}: ${err.message}`);
  process.exit(1);
}).listen(PORT, () => {
  log('info', 'helper', `Started on port ${PORT} (links ${LINK_BASE}), Node ${process.version}, competition ${CONFIG.name}, organisation ${playhq.organisation().orgId || '(not set)'} on ${playhq.organisation().tenant}`);
  console.log(`Debug log: ${LOG_FILE}`);
  setTimeout(() => warmTeamLists('start up'), 2000);
  console.log(`FirstPass Studio is running. Open ${LINK_BASE}/ for the Output page.`);
  console.log(`Competition: ${CONFIG.name} (change it at ${LINK_BASE}/setup.html). Leave this window open while streaming.`);
});
