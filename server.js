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
const migrations = require('./migrations');
const competitions = require('./competitions');
const finals = require('./finals');
const scene = require('./scene');
const outputs = require('./outputs');
const { linkHost } = require('./linkhost');

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
// The start of every page link shown to people (home page, control page, Mac app): the Mac's
// Bonjour name unless config.json linkHost says otherwise. See linkhost.js.
const LINK_BASE = `http://${linkHost(MACHINE.linkHost)}:${PORT}`;
const API_URL = process.env.PLAYHQ_API_URL || 'https://api.playhq.com/graphql';
const CACHE_MS = Math.max(15, Number(MACHINE.cacheSeconds || 60)) * 1000;

// ─── Debug log ──────────────────────────────────────────────────────────────
// logs/playhq-graphics.log in the data folder: helper requests, PlayHQ calls, scoreboard changes and
// errors from every page. Capped at logMaxMB (default 15): when full, the oldest
// half is dropped so the newest lines are always kept.
const LOG_DIR = DATA('logs');
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
scene.init(log, { ffmpeg: MACHINE.ffmpegPath });
outputs.init(log);

// ─── Where the data comes from ──────────────────────────────────────────────
// config.json holds the organisation's PlayHQ page link. From it we read the
// sport "tenant" (e.g. netball-australia) and the 8-character organisation id.
function parsePlayhqUrl(url) {
  const m = String(url || '').match(/playhq\.com\/(?:[a-z]{2}\/)?([a-z0-9-]+)\/org\/[^/]+\/([0-9a-f]{8})/i);
  return m ? { tenant: m[1], orgId: m[2] } : null;
}
let TENANT = 'netball-australia', ORG_ID = null;

// ─── PlayHQ guest session ───────────────────────────────────────────────────
const HEADERS = {
  'accept': '*/*',
  'content-type': 'application/json',
  'origin': 'https://www.playhq.com',
  'referer': 'https://www.playhq.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};
const SESSION_QUERIES = [
  { operationName: 'ProfileSearch', variables: { fullName: 'a' }, query: 'query ProfileSearch($fullName: String!) { profileSearch(fullName: $fullName) { result { id } } }' },
  { operationName: 'TenantConfig', variables: {}, query: 'query TenantConfig { tenantConfiguration { label } }' },
];
let cookie = null, cookieAt = 0, cookiePromise = null;

function readCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list.join('\n') : (res.headers.get('set-cookie') || '');
  const jar = {};
  for (const m of raw.matchAll(/(phq_[a-z_]+)=([^;,\s]*)/gi)) jar[m[1]] = m[2];
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function getSession(force) {
  if (!force && cookie && Date.now() - cookieAt < 10 * 60 * 1000) return cookie;
  if (cookiePromise) return cookiePromise;
  cookiePromise = (async () => {
    try {
      for (const body of SESSION_QUERIES) {
        const res = await fetch(API_URL, { method: 'POST', headers: { ...HEADERS, tenant: TENANT, 'request-id': crypto.randomUUID() }, body: JSON.stringify(body) });
        const c = readCookies(res);
        if (c) { cookie = c; cookieAt = Date.now(); return cookie; }
      }
      // Some sessions answer without a cookie; carry on without one.
      cookie = ''; cookieAt = Date.now();
      return cookie;
    } finally { cookiePromise = null; }
  })();
  return cookiePromise;
}

async function gql(operationName, query, variables, retried, tenant = TENANT) {
  const c = await getSession(retried);
  const headers = { ...HEADERS, tenant, 'request-id': crypto.randomUUID() };
  if (c) headers.cookie = c;
  const started = Date.now();
  let res;
  try { res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ operationName, query, variables }) }); }
  catch (err) { log('error', 'playhq', `${operationName} could not reach PlayHQ: ${err.cause ? err.cause.message || err.cause.code : err.message}`, variables); throw err; }
  const text = await res.text();
  log(res.ok ? 'info' : 'warn', 'playhq', `${operationName} HTTP ${res.status} ${Date.now() - started}ms ${text.length}B`, variables);
  if (!res.ok) log('warn', 'playhq', `${operationName} answer`, text.slice(0, 500));
  if ((res.status === 401 || res.status === 403) && !retried) return gql(operationName, query, variables, true, tenant);
  if (!res.ok) {
    // A query PlayHQ doesn't accept (e.g. a field it doesn't have) comes back as HTTP 400 with GraphQL errors.
    let bad = null;
    try { bad = JSON.parse(text).errors; } catch { /* not JSON */ }
    const err = new Error(bad && bad.length ? `PlayHQ answered HTTP ${res.status}: ${bad.map(e => e.message).join('; ')}`
      : `PlayHQ answered HTTP ${res.status}${/Request blocked/i.test(text) ? ' (temporarily blocked, will retry)' : ''}`);
    if (bad && bad.length) err.graphql = bad;
    throw err;
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('PlayHQ sent something that was not JSON'); }
  if (json.errors && json.errors.length) {
    log('error', 'playhq', `${operationName} GraphQL errors`, json.errors);
    const err = new Error(json.errors.map(e => e.message).join('; '));
    err.graphql = json.errors;
    throw err;
  }
  return json.data;
}

// ─── Queries ────────────────────────────────────────────────────────────────
const Q_COMPETITIONS = `query discoverCompetitions($organisationID: ID!) {
  discoverCompetitions(organisationID: $organisationID) {
    id name
    seasons(organisationID: $organisationID) { id name startDate endDate status { name value } }
    organisation { id name }
  }
}`;
// Each division's gender (Men's, Women's, Mixed...) is asked for too, as playhq.com does; if
// PlayHQ ever refuses it the season is read again without it.
const qSeason = withGender => `query gradeListDiscoverSeason($id: String!) {
  discoverSeason(seasonID: $id) {
    id name
    competition { id name organisation { id name } }
    grades { id name${withGender ? ' gender { value }' : ''} }
  }
}`;
let seasonGender = true;
// 'female' or 'male' for a division PlayHQ says is for women or men, '' for mixed, open or not given.
function gradeGenderOf(v) {
  const s = String((v && typeof v === 'object' ? v.value || v.name : v) || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (/^(FEMALE|WOMEN|WOMENS|WOMAN|GIRLS?|LADIES)$/.test(s)) return 'female';
  if (/^(MALE|MEN|MENS|MAN|BOYS?)$/.test(s)) return 'male';
  return '';
}

// Ladder columns. If PlayHQ doesn't know one of these for a sport, it's dropped
// automatically and the page just leaves that column out.
const STANDING_FIELDS = ['played', 'won', 'lost', 'drawn', 'byes', 'forfeits', 'pointsFor', 'pointsAgainst', 'percentage', 'competitionPoints'];
const unknownFields = new Set();

async function fetchLadder(gradeId) {
  for (let attempt = 0; attempt < STANDING_FIELDS.length + 1; attempt++) {
    const fields = STANDING_FIELDS.filter(f => !unknownFields.has(f));
    const q = `query gradeLadder($gradeID: ID!) {
  discoverGrade(gradeID: $gradeID) {
    id name
    ladder { standings { team { id name } ${fields.join(' ')} } }
  }
}`;
    try {
      const data = await gql('gradeLadder', q, { gradeID: gradeId });
      return data.discoverGrade;
    } catch (err) {
      const bad = (err.graphql || []).map(e => (e.message.match(/Cannot query field "(\w+)"/) || [])[1]).filter(Boolean);
      if (!bad.length) throw err;
      bad.forEach(f => unknownFields.add(f));
    }
  }
  throw new Error('Could not read the ladder fields from PlayHQ');
}

function normaliseLadder(grade) {
  const raw = grade && grade.ladder;
  const pools = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return pools.map(pool => (pool.standings || []).map((s, i) => ({
    position: i + 1,
    team: s.team ? s.team.name : '',
    played: s.played, won: s.won, lost: s.lost, drawn: s.drawn, byes: s.byes, forfeits: s.forfeits,
    pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst,
    percentage: s.percentage, points: s.competitionPoints,
  })));
}

// ─── Finding the competition, season and divisions ──────────────────────────
function pickSeason(seasons) {
  if (CONFIG.seasonName) {
    const s = seasons.find(x => x.name.toLowerCase().includes(CONFIG.seasonName.toLowerCase()));
    if (s) return s;
  }
  const now = Date.now();
  const t = d => (d ? Date.parse(d) : NaN);
  const live = seasons.filter(s => /active|live|in.?progress/i.test(JSON.stringify(s.status || '')));
  const current = seasons.filter(s => t(s.startDate) <= now && (isNaN(t(s.endDate)) || t(s.endDate) + 86400000 >= now));
  const pool = live.length ? live : current.length ? current : seasons;
  return pool.slice().sort((a, b) => (t(b.startDate) || 0) - (t(a.startDate) || 0))[0];
}

let structure = null, structureAt = 0;
async function getStructure() {
  if (structure && Date.now() - structureAt < 30 * 60 * 1000) return structure;
  let seasonId = CONFIG.seasonId || null;
  let orgName = CONFIG.organisationName, compName = CONFIG.competitionName, allCompetitions = [];
  if (!seasonId) {
    if (!ORG_ID) throw new Error(`Add the organisation's PlayHQ link for ${CONFIG.name} on the competition setup page (${LINK_BASE}/setup.html).`);
    const data = await gql('discoverCompetitions', Q_COMPETITIONS, { organisationID: ORG_ID });
    allCompetitions = data.discoverCompetitions || [];
    const want = (CONFIG.competitionName || '').toLowerCase();
    const comp = allCompetitions.find(c => c.name.toLowerCase() === want) || allCompetitions.find(c => c.name.toLowerCase().includes(want));
    if (!want) throw new Error(`Pick ${CONFIG.name}'s PlayHQ competition on the competition setup page (${LINK_BASE}/setup.html).`);
    if (!comp) throw new Error(`No competition called "${CONFIG.competitionName}" found. PlayHQ lists: ${allCompetitions.map(c => c.name).join(', ') || 'none'}`);
    const season = pickSeason(comp.seasons || []);
    if (!season) throw new Error(`"${comp.name}" has no seasons on PlayHQ yet.`);
    seasonId = season.id;
    compName = comp.name;
    if (comp.organisation && comp.organisation.name) orgName = CONFIG.organisationName || comp.organisation.name;
  }
  let s;
  try { s = (await gql('gradeListDiscoverSeason', qSeason(seasonGender), { id: seasonId })).discoverSeason; }
  catch (err) {
    if (!err.graphql || !seasonGender) throw err;
    seasonGender = false;
    log('info', 'playhq', `Division gender unavailable, reading divisions without it: ${err.message}`);
    s = (await gql('gradeListDiscoverSeason', qSeason(false), { id: seasonId })).discoverSeason;
  }
  if (!s) throw new Error(`PlayHQ has no season with id ${seasonId}.`);
  const grades = (s.grades || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  structure = {
    organisation: CONFIG.organisationName || (s.competition && s.competition.organisation && s.competition.organisation.name) || orgName,
    competition: CONFIG.displayName || CONFIG.competitionName || compName || (s.competition && s.competition.name),
    season: { id: s.id, name: s.name },
    grades: grades.map((g, i) => ({ division: i + 1, id: g.id, name: g.name, gender: gradeGenderOf(g.gender) })),
    otherCompetitions: allCompetitions.map(c => c.name),
  };
  structureAt = Date.now();
  return structure;
}

const ladderCache = new Map();
async function getLadder(gradeId) {
  const hit = ladderCache.get(gradeId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const g = await fetchLadder(gradeId);
    const value = { grade: g ? g.name : '', pools: normaliseLadder(g), updatedAt: new Date().toISOString() };
    ladderCache.set(gradeId, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (hit) return { ...hit.value, stale: true, error: err.message }; // keep showing the last good ladder
    throw err;
  }
}

function findGrade(st, q) {
  if (q.gradeId) return { id: q.gradeId, name: q.gradeId };
  if (q.division && /^\d+$/.test(q.division)) return st.grades[Number(q.division) - 1];
  if (q.division) return st.grades.find(g => g.name.toLowerCase().includes(q.division.toLowerCase()));
  return st.grades[0];
}

// ─── Games (for the scoreboard) ─────────────────────────────────────────────
const Q_ROUNDS = `query gradeRounds($gradeID: ID!) {
  discoverGrade(gradeID: $gradeID) { id name rounds { id name current number } }
}`;
const TEAM = `__typename ... on DiscoverTeam { id name } ... on ProvisionalTeam { name }`;
const SIDE = `outcome { value } statistics { count type { value } }`;
const Q_ROUND_GAMES = `query discoverFixtureByRound($roundID: ID!) {
  discoverFixtureByRound(roundID: $roundID) {
    games {
      id date dates
      status { value }
      home { ${TEAM} }
      away { ${TEAM} }
      result { home { ${SIDE} } away { ${SIDE} } }
      allocation { time court { name venue { name } } }
    }
  }
}`;

function totalScore(side) {
  const s = side && (side.statistics || []).find(x => x.type && x.type.value === 'TOTAL_SCORE');
  return s && s.count !== null && s.count !== undefined ? s.count : null;
}

function outcomeOf(side) { return (side && side.outcome && side.outcome.value) || null; }

const roundGamesCache = new Map();
const roundGamesInFlight = new Map();
async function getRoundGames(roundId, maxAgeMs) {
  const hit = roundGamesCache.get(roundId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.games;
  if (!roundGamesInFlight.has(roundId)) {
    roundGamesInFlight.set(roundId, fetchRoundGames(roundId).finally(() => roundGamesInFlight.delete(roundId)));
  }
  return roundGamesInFlight.get(roundId);
}
async function fetchRoundGames(roundId) {
  const data = await gql('discoverFixtureByRound', Q_ROUND_GAMES, { roundID: roundId });
  const games = ((data.discoverFixtureByRound || {}).games || []).map(g => ({
    id: g.id,
    roundId,
    status: g.status && g.status.value,
    date: g.date || (g.dates || [])[0] || null,
    time: g.allocation && g.allocation.time,
    court: g.allocation && g.allocation.court ? g.allocation.court.name : '',
    venue: g.allocation && g.allocation.court && g.allocation.court.venue ? g.allocation.court.venue.name : '',
    home: { name: g.home ? g.home.name : 'TBC', score: totalScore(g.result && g.result.home), outcome: outcomeOf(g.result && g.result.home) },
    away: { name: g.away ? g.away.name : 'TBC', score: totalScore(g.result && g.result.away), outcome: outcomeOf(g.result && g.result.away) },
  }));
  roundGamesCache.set(roundId, { at: Date.now(), games });
  for (const g of games) noteStart(g);
  return games;
}

// ─── One game in detail (live score, line-ups, player stats) ────────────────
// The same request the playhq.com game page makes. Unlike the round fixture, it
// has the score while the game is being scored, and needs no API key.
const STATS = 'statistics { count type { value } }';
// A player's gender (for the generic silhouette when there's no photo). PlayHQ's field
// isn't documented, so each spelling is tried in turn and the first one PlayHQ accepts is kept.
const GENDER_FIELDS = ['gender', 'gender { value }', ''];
let genderField = 0;
const lineup = () => {
  const profile = `profile { firstName lastName ${GENDER_FIELDS[genderField]} }`;
  return `players {
  playerNumber
  player {
    __typename
    ... on DiscoverParticipant { id ${profile} }
    ... on DiscoverParticipantFillInPlayer { id ${profile} }
    ... on DiscoverGamePermitFillInPlayer { id ${profile} }
    ... on DiscoverRegularFillInPlayer { id name }
    ... on DiscoverAnonymousParticipant { id name }
  }
  ${STATS}
  playerPosition { shortName }
  captain { name shortName }
}`;
};
const qGame = () => `query discoverGame($gameID: ID!) {
  discoverGame(gameID: $gameID) {
    id date status { value }
    home { ${TEAM} }
    away { ${TEAM} }
    result { home { score ${STATS} } away { score ${STATS} } }
    statistics { home { ${lineup()} ${STATS} } away { ${lineup()} ${STATS} } }
  }
}`;
// 'female', 'male' or '' from whatever PlayHQ sends ("FEMALE", { value: "F" }, "Woman"...).
function genderOf(v) {
  const s = String((v && typeof v === 'object' ? v.value || v.name : v) || '').toUpperCase();
  if (/^(F|W|G)|FEMALE|WOMAN|GIRL/.test(s)) return 'female';
  if (/^(M|B)|MAN|BOY/.test(s)) return 'male';
  return '';
}

const statCount = (list, type) => { const x = (list || []).find(s => s.type && s.type.value === type); return x ? x.count : null; };
const POSITION_RANK = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
function parseGame(g) {
  const side = k => {
    const result = g.result && g.result[k];
    const st = g.statistics && g.statistics[k];
    const teamStats = (st && st.statistics) || [];
    // The official result once there is one, else the running total from the scorer.
    let score = result && result.score != null ? result.score : statCount(result && result.statistics, 'TOTAL_SCORE');
    if (score == null) score = statCount(teamStats, 'TOTAL_SCORE');
    if (score == null && (statCount(teamStats, '1_POINT_SCORE') != null || statCount(teamStats, '2_POINT_SCORE') != null)) {
      score = (statCount(teamStats, '1_POINT_SCORE') || 0) + 2 * (statCount(teamStats, '2_POINT_SCORE') || 0);
    }
    const players = ((st && st.players) || []).map(p => {
      const who = p.player || {};
      const name = who.profile ? `${who.profile.firstName || ''} ${who.profile.lastName || ''}`.trim() : (who.name || '');
      const goals = statCount(p.statistics, '1_POINT_SCORE') || 0;
      const superGoals = statCount(p.statistics, '2_POINT_SCORE') || 0;
      return {
        name, number: p.playerNumber || '', playhqId: who.id || '', gender: genderOf(who.profile && who.profile.gender), position: positionOf(p), // GS..GK; full names and odd spellings tidied, '' when PlayHQ has none,
        private: who.__typename === 'DiscoverAnonymousParticipant',
        captain: !!p.captain && !/vice/i.test(p.captain.name || ''), viceCaptain: !!p.captain && /vice/i.test(p.captain.name || ''),
        // shots = every attempt, normal and super (PlayHQ records one attempt count).
        shooting: { goals, superGoals, shots: statCount(p.statistics, 'GOAL_ATTEMPT'), points: goals + 2 * superGoals },
      };
    }).filter(p => p.name);
    const rank = p => { const i = POSITION_RANK.indexOf(p.position); return i === -1 ? 99 : i; };
    players.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const name = (g[k] && g[k].name) || '';
    return { name, logo: logoFor(name), score, players };
  };
  return { id: g.id, status: g.status && g.status.value, home: side('home'), away: side('away') };
}

const gameCache = new Map();
const gameInFlight = new Map();

// Finished games' line ups don't change, so they are kept in game-cache.json in the data
// folder, with the player gender field PlayHQ accepted: after a restart the team lists'
// squads, top shooters and the athletes page don't ask PlayHQ for the whole season again.
// A game id is PlayHQ's own, so the file serves every competition.
const GAME_CACHE_FILE = DATA('game-cache.json');
const GAME_CACHE_MAX = 3000, GAME_CACHE_DAYS = 120;
const finishedSummaries = new Map(); // game id -> parsed game
const finishedAt = new Map();        // game id -> when it was kept
try {
  const saved = JSON.parse(fs.readFileSync(GAME_CACHE_FILE, 'utf8'));
  const i = GENDER_FIELDS.indexOf(saved.genderField);
  if (i > 0) genderField = i;
  const oldest = Date.now() - GAME_CACHE_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, e] of Object.entries(saved.games || {})) {
    if (e && e.game && e.at > oldest) { finishedSummaries.set(id, e.game); finishedAt.set(id, e.at); }
  }
  log('info', 'playhq', `${finishedSummaries.size} finished games' line ups loaded from game-cache.json`);
} catch (err) { if (err.code !== 'ENOENT') log('warn', 'playhq', `game-cache.json not read: ${err.message}`); }
let gameCacheTimer = null;
function saveGameCache() {
  if (gameCacheTimer) return;
  gameCacheTimer = setTimeout(() => {
    gameCacheTimer = null;
    const games = Object.fromEntries([...finishedSummaries].map(([id, game]) => [id, { at: finishedAt.get(id) || Date.now(), game }]));
    fs.writeFile(GAME_CACHE_FILE, JSON.stringify({ genderField: GENDER_FIELDS[genderField], games }), err => {
      if (err) log('warn', 'playhq', `game-cache.json not saved: ${err.message}`);
    });
  }, 2000);
}
function keepFinished(gameId, parsed) {
  finishedSummaries.set(gameId, parsed);
  finishedAt.set(gameId, Date.now());
  while (finishedSummaries.size > GAME_CACHE_MAX) {
    const first = finishedSummaries.keys().next().value;
    finishedSummaries.delete(first); finishedAt.delete(first);
  }
  saveGameCache();
}
// Runs fn on each item, a few at a time (gentle on PlayHQ, much quicker than one by one).
// Gives { value } or { error } for each item, in order.
async function eachLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { value: await fn(items[i], i) }; } catch (error) { out[i] = { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const PLAYHQ_AT_ONCE = 4;
// A game's line up, from the kept finished games when there, else from PlayHQ (kept if finished).
async function readGame(g, maxAgeMs) {
  const kept = finishedSummaries.get(g.id);
  if (kept) return kept;
  const parsed = await getGame(g.id, maxAgeMs);
  // A finished game with no line up at all may still get one entered, so it isn't kept.
  if (isFinished(g) && (parsed.home.players.length || parsed.away.players.length)) keepFinished(g.id, parsed);
  return parsed;
}
async function getGame(gameId, maxAgeMs) {
  const hit = gameCache.get(gameId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.game;
  if (!gameInFlight.has(gameId)) {
    gameInFlight.set(gameId, (async () => {
      let g;
      for (;;) {
        try { g = (await gql('discoverGame', qGame(), { gameID: gameId })).discoverGame; break; }
        catch (err) {
          // PlayHQ doesn't know that spelling of gender: try the next one (the last asks for none).
          // (PlayHQ may answer HTTP 400 with an error that doesn't name the field, so any rejected query moves on.)
          if (!err.graphql || genderField >= GENDER_FIELDS.length - 1) throw err;
          genderField++;
          saveGameCache(); // remembered, so a restart doesn't ask the rejected ones again
          log('info', 'playhq', `Player gender: trying "${GENDER_FIELDS[genderField] || 'none'}" after: ${err.message}`);
        }
      }
      if (!g) throw new Error(`PlayHQ has no game ${gameId}`);
      const game = parseGame(g);
      gameCache.set(gameId, { at: Date.now(), game });
      return game;
    })().finally(() => gameInFlight.delete(gameId)));
  }
  return gameInFlight.get(gameId);
}

// ─── Live scoring feed ──────────────────────────────────────────────────────
// playhq.com's game page reads the running score and the scorer's game clock from
// spectator.playhq.com while a game is on. Its tenant header is the short sport
// label ("na" for netball-australia), which PlayHQ's tenantConfiguration gives.
const SPECTATOR_URL = process.env.PLAYHQ_SPECTATOR_URL || 'https://spectator.playhq.com/graphql';
const LIVE_STATS = 'statistics { type { value } count }';
const Q_LIVE = `query game($id: ID!) {
  game(id: $id) {
    id status updatedAt break
    statistics { home { statisticsV2 { type { value } count } } away { statisticsV2 { type { value } count } } }
    result { home { ${LIVE_STATS} } away { ${LIVE_STATS} } currentPeriod { value } }
    clock { period periodValue status time lastUpdatedAt }
  }
}`;
let tenantLabel = '';
async function getTenantLabel() {
  if (tenantLabel) return tenantLabel;
  try { tenantLabel = ((await gql('tenantLabel', 'query tenantLabel { tenantConfiguration { label } }', {})).tenantConfiguration || {}).label || ''; }
  catch (err) { log('warn', 'live', `Could not read the tenant label: ${err.message}`); }
  if (!tenantLabel) tenantLabel = TENANT === 'netball-australia' ? 'na' : TENANT;
  return tenantLabel;
}
async function fetchLive(gameId) {
  const headers = { ...HEADERS, 'x-phq-tenant': await getTenantLabel() };
  const c = await getSession();
  if (c) headers.cookie = c;
  const started = Date.now();
  const res = await fetch(SPECTATOR_URL, { method: 'POST', headers, body: JSON.stringify({ operationName: 'game', query: Q_LIVE, variables: { id: gameId } }) });
  const text = await res.text();
  log(res.ok ? 'info' : 'warn', 'live', `game ${gameId} HTTP ${res.status} ${Date.now() - started}ms ${text.length}B`);
  if (!res.ok) { log('warn', 'live', 'answer', text.slice(0, 500)); throw new Error(`PlayHQ live feed answered HTTP ${res.status}`); }
  const json = JSON.parse(text);
  if (json.errors && json.errors.length) {
    const message = json.errors.map(e => e.message).join('; ');
    // Inside the window but the scorer hasn't started: expected, so said once per game.
    if (/not electronically scored/i.test(message)) {
      if (!notScoredLogged.has(gameId)) { notScoredLogged.add(gameId); log('info', 'live', `game ${gameId} isn't being scored in PlayHQ yet (${message}); still checking`); }
      throw Object.assign(new Error('PlayHQ isn\'t scoring this game yet.'), { notScored: true });
    }
    log('error', 'live', 'GraphQL errors', json.errors);
    throw new Error(message);
  }
  const g = json.data && json.data.game;
  if (!g) throw new Error(`PlayHQ live feed has no game ${gameId}`);
  const side = k => {
    const total = statCount(g.result && g.result[k] && g.result[k].statistics, 'TOTAL_SCORE');
    const team = (g.statistics && g.statistics[k] && g.statistics[k].statisticsV2) || [];
    return {
      score: total ?? statCount(team, 'TOTAL_SCORE'),
      goals: statCount(team, '1_POINT_SCORE'), superGoals: statCount(team, '2_POINT_SCORE'),
      shots: statCount(team, 'GOAL_ATTEMPT'), misses: statCount(team, 'MISS'),
    };
  };
  return { id: g.id, status: g.status, home: side('home'), away: side('away'), clock: g.clock || null, break: g.break || null,
    period: (g.clock && g.clock.periodValue) || (g.result && g.result.currentPeriod && g.result.currentPeriod.value) || null };
}
// Electronic scoring starts scoringMinutesBefore (autoSelectMinutesBefore on the setup page,
// default 10) minutes before a game. Before then PlayHQ's live feed only answers "game could
// not be found or was not electronically scored", so it isn't asked at all.
const gameStarts = new Map(); // game id -> { date, time, status } from the fixtures
function noteStart(g) { if (g && g.id && g.date && g.time) gameStarts.set(g.id, { date: g.date, time: g.time, status: g.status }); }
function scoringOpensAt(game) {
  const g = game && game.date && game.time ? game : gameStarts.get(game && game.id ? game.id : game);
  if (!g || /PROGRESS|LIVE|STARTED|COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(g.status || '')) return null;
  const start = startOf(g);
  return start === null ? null : start - AUTO_LEAD_MS;
}
// Why the live feed isn't asked yet ('' once the window is open, or when the start time isn't known).
function scoringNotYet(game) {
  const at = scoringOpensAt(game);
  if (at === null || at <= Date.now()) return '';
  const when = new Date(at);
  const day = localDate(when) === localDate() ? '' : ` on ${when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  return `Electronic scoring starts ${AUTO_LEAD_MS / 60000} minutes before the game, so PlayHQ is checked from ${when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}${day}.`;
}
const notScoredLogged = new Set(); // games already logged as not being scored yet
const liveCache = new Map();
const liveInFlight = new Map();
async function getLive(gameId, maxAgeMs) {
  const hit = liveCache.get(gameId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.live;
  const wait = scoringNotYet(gameId);
  if (wait) throw Object.assign(new Error(wait), { notYet: true });
  if (!liveInFlight.has(gameId)) {
    liveInFlight.set(gameId, fetchLive(gameId)
      .then(live => { liveCache.set(gameId, { at: Date.now(), live }); return live; })
      .finally(() => liveInFlight.delete(gameId)));
  }
  return liveInFlight.get(gameId);
}
const PERIOD_NUMBER = { FIRST_QTR: 1, SECOND_QTR: 2, THIRD_QTR: 3, FOURTH_QTR: 4, FIRST_HALF: 1, SECOND_HALF: 2 };

// Live score for any game: the live feed first, then the game page data, then the round fixture.
async function liveScore(game, maxAgeMs) {
  try {
    const l = await getLive(game.id, maxAgeMs);
    if (l.home.score != null || l.away.score != null) return { home: l.home.score ?? 0, away: l.away.score ?? 0, status: l.status, live: l };
  } catch (err) {
    if (err.notYet) return null; // not scored yet, so nothing to find on the game page either
    if (!err.notScored) log('warn', 'live', `Live feed failed for ${game.id}: ${err.message}`);
  }
  try {
    const d = await getGame(game.id, maxAgeMs);
    if (d.home.score != null || d.away.score != null) return { home: d.home.score ?? 0, away: d.away.score ?? 0, status: d.status };
  } catch (err) { log('warn', 'live', `Game detail failed for ${game.id}: ${err.message}`); }
  return null;
}

// A division's rounds (kept for 5 minutes).
const roundsCache = new Map();
async function getRounds(gradeId) {
  const hit = roundsCache.get(gradeId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.rounds;
  const g = (await gql('gradeRounds', Q_ROUNDS, { gradeID: gradeId })).discoverGrade;
  const rounds = (g && g.rounds) || [];
  roundsCache.set(gradeId, { at: Date.now(), rounds });
  return rounds;
}

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
let control = {};
try { control = JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf8')); } catch { /* none saved yet */ }
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
  fs.writeFileSync(CONTROL_FILE, JSON.stringify(control, null, 2) + '\n');
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
// stream is on the first timeslot and shows the game after it.
async function getUpNext() {
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
  if (!next) return { ...out, error: 'No later game in this round' };
  return { ...out, ...next, logos: { home: logoFor(next.home.name), away: logoFor(next.away.name) } };
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

// ─── Scoreboard state (set from control.html, shown by scoreboard.html) ─────
// Kept in scoreboard-state.json so a restart mid-game keeps the score. The lasting
// settings (LASTING) also go to control.json, which wins when both have them. Studio runs one
// scoreboard (one Studio per court); both files keep it under "1", as when there could be more.
const STATE_FILE = DATA('scoreboard-state.json');
let boards = {};
try { boards = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { boards = {}; }
boards = boards['1'] ? { 1: boards['1'] } : {}; // one scoreboard: drop any old second board
function saveBoards() {
  fs.writeFile(STATE_FILE, JSON.stringify(boards, null, 2), () => {});
  if (boards['1']) control.boards['1'] = Object.fromEntries(LASTING.map(k => [k, boards['1'][k]]));
  saveControl();
}

const DEFAULT_REFRESH_SEC = Math.max(3, Number(MACHINE.playhqRefreshSeconds) || 5);
let QUARTER_SEC = 600;
// The ticker's scroll speed in pixels per second: the default, the limits and one Faster / Slower step.
const TICKER_SPEED = 120, TICKER_MIN = 20, TICKER_MAX = 600, TICKER_STEP = 20;
const tickerSpeed = v => Math.max(TICKER_MIN, Math.min(TICKER_MAX, Math.round(Number(v) || TICKER_SPEED)));

function newBoard() {
  return {
    source: 'manual',          // 'playhq' = scores follow PlayHQ, 'manual' = scores from the control page
    gameId: null, roundId: null,
    division: '', court: '', round: '', date: '', time: '', venue: '',
    home: { name: 'Home', score: 0 },
    away: { name: 'Away', score: 0 },
    period: 1, periodLabel: 'Q',
    clock: { lengthSec: QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null },
    showClock: true,
    followPlayhqClock: false,  // true = the clock follows the PlayHQ scorer's game clock (while following PlayHQ); matches source when that changes
    autoSelect: CONFIG.autoSelectGame !== undefined ? !!CONFIG.autoSelectGame : !!CONFIG.defaultCourt, // pick the game from the court and the time
    autoCourt: CONFIG.defaultCourt || '',
    playhqRefreshSec: DEFAULT_REFRESH_SEC,
    tickerSpeed: TICKER_SPEED,  // how fast ticker.html scrolls, in pixels per second
    updatedAt: Date.now(),
  };
}
function board() {
  if (!boards['1']) boards['1'] = { ...newBoard(), ...pickKeys(control.boards['1'], LASTING) };
  const b = boards['1'];
  if (b.autoSelect === undefined) { const n = newBoard(); b.autoSelect = n.autoSelect; b.autoCourt = n.autoCourt; } // saved before these existed
  return b;
}

const pickKeys = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
if (boards['1']) Object.assign(boards['1'], pickKeys(control.boards['1'], LASTING));
if (!fs.existsSync(CONTROL_FILE)) { controlSaved = ''; saveBoards(); } // none yet: write it from what was in use

function clockElapsed(c) { return c.elapsedMs + (c.running && c.startedAt ? Date.now() - c.startedAt : 0); }

// Clock buttons pressed by a person stop the clock following PlayHQ (like score buttons do for the score).
const MANUAL_CLOCK = new Set(['clockStart', 'clockStop', 'clockToggle', 'clockReset', 'clockSet', 'clockAdjust']);
// The clock matches the scores: whenever scoring switches between Follow PlayHQ and Manual
// (the buttons, the Stream Deck, a score press, or a game being picked), following the
// PlayHQ scorer's clock is switched to match. Changing the clock afterwards still wins.
const SETS_SOURCE = new Set(['source', 'selectGame']);
function applyAction(b, a) {
  const sourceBefore = b.source;
  applyOne(b, a);
  if (b.source === sourceBefore && !SETS_SOURCE.has(a.type)) return;
  const follow = b.source === 'playhq';
  if (b.followPlayhqClock === follow) return;
  b.followPlayhqClock = follow;
  b.playhqClockKey = null; // apply the next PlayHQ reading straight away
  b.clockMatchedAt = Date.now();
  log('info', 'scoreboard', `Scores now ${follow ? 'follow PlayHQ' : 'manual'} (${a.type}), so the clock ${follow ? 'follows the PlayHQ scorer' : 'is manual'} too`);
}
// ─── Super shots (for supershot.html) ───────────────────────────────────────
// Each super shot bumps b.superShot.n, and supershot.html plays when it sees n go up.
// From the control page or Stream Deck: a +2 press. From PlayHQ: the team's super shot
// count (2_POINT_SCORE) going up by exactly one with their score up by at least 2, so two
// normal goals between checks and a scorer swapping a goal for a super shot don't count.
// When the feed has no super shot count, a score jump of exactly 2 with the normal goal
// count unchanged (or unknown) counts. The first reading after a game is picked or scores
// switch to PlayHQ only sets the starting point, so catching up never plays it, and nothing
// plays once the game is finished.
const superSeen = new WeakMap(); // board -> last PlayHQ reading compared against
function superShot(b, side, how) {
  if (!competitions.superShotsFor(CONFIG, b.division)) return;
  const n = ((b.superShot && b.superShot.n) || 0) + 1;
  b.superShot = { n, side, at: Date.now(), how };
  log('info', 'supershot', `Super shot for ${b[side].name} (${side}, ${how}), number ${n}`);
}
function watchSuperShots(b, game, live, kind) {
  const read = k => ({ score: game[k].score, goals: live ? live[k].goals : null, superGoals: live ? live[k].superGoals : null });
  const now = { key: `${b.gameId} ${kind}`, home: read('home'), away: read('away') };
  const before = superSeen.get(b);
  superSeen.set(b, now);
  if (!before || before.key !== now.key || isFinished(game)) return;
  for (const k of ['home', 'away']) {
    const was = before[k], is = now[k];
    if (was.score == null || is.score == null) continue;
    const up = is.score - was.score;
    const counted = was.superGoals != null && is.superGoals != null;
    if (counted ? is.superGoals - was.superGoals === 1 && up >= 2
      : up === 2 && (was.goals == null || is.goals == null || is.goals === was.goals)) superShot(b, k, 'playhq');
  }
}

function applyOne(b, a) {
  if (['score', 'setScore', 'resetScores', 'selectGame', 'source', 'reset'].includes(a.type)) superSeen.delete(b); // start again from the next reading
  if (MANUAL_CLOCK.has(a.type) && b.followPlayhqClock && !a.fromToggle) {
    b.followPlayhqClock = false;
    log('info', 'scoreboard', `Clock switched to manual by ${a.type}`);
  }
  const side = a.side === 'away' ? b.away : b.home;
  switch (a.type) {
    case 'score': {
      const before = Number(side.score) || 0;
      side.score = Math.max(0, before + Number(a.delta || 0));
      noteGoals(b, a.side === 'away' ? 'away' : 'home', side.score - before, 'manual');
      if (side.score > before) watchStreaks(b, 'manual');
      b.source = 'manual';
      if (Number(a.delta) === 2) superShot(b, a.side === 'away' ? 'away' : 'home', 'manual');
      break;
    }
    case 'superShot': superShot(b, a.side === 'away' ? 'away' : 'home', 'test'); break; // plays it without changing the score
    case 'streak': { // plays streak.html without changing the score
      const kind = STREAK_GOALS[a.kind] ? a.kind : 'heating';
      const side = a.side === 'away' ? 'away' : 'home';
      streak(b, kind, kind === 'goalForGoal' ? '' : side, STREAK_GOALS[kind], 'test', kind === 'goalForGoal' ? side : '');
      break;
    }
    case 'setScore': side.score = Math.max(0, Number(a.value) || 0); b.source = 'manual'; break;
    case 'setTeams': b.home.name = a.home ?? b.home.name; b.away.name = a.away ?? b.away.name; b.division = a.division ?? b.division; b.court = a.court ?? b.court; break;
    case 'selectGame':
      if (!a.auto && b.autoSelect) { b.autoSelect = false; log('info', 'auto', 'Game picked by hand, so automatic game selection is off'); }
      Object.assign(b, { gameId: a.game.id, roundId: a.game.roundId, division: a.game.division || '', court: a.game.court || '', source: 'playhq',
        round: a.game.round || '', date: a.game.date || '', time: a.game.time || '', venue: a.game.venue || '', playhqPeriodSeen: null, playhqClock: null, playhqClockKey: null });
      b.home = { name: a.game.home.name, score: a.game.home.score ?? 0 };
      b.away = { name: a.game.away.name, score: a.game.away.score ?? 0 };
      if (b.goalsGameId !== a.game.id) clearGoals(b, a.game.id);
      setImmediate(() => warmTeamLists(a.auto ? 'game picked automatically' : 'game picked'));
      break;
    case 'source': {
      const want = a.value === 'toggle' ? (b.source === 'playhq' ? 'manual' : 'playhq') : a.value;
      b.source = want === 'playhq' && b.gameId ? 'playhq' : 'manual';
      break;
    }
    case 'resetScores': b.home.score = 0; b.away.score = 0; b.source = 'manual'; clearGoals(b, b.gameId); break;
    case 'clockToggle': applyOne(b, { type: b.clock.running ? 'clockStop' : 'clockStart', fromToggle: true }); break;
    case 'autoSelect':
      b.autoSelect = a.value === 'toggle' ? !b.autoSelect : !!a.value && a.value !== 'off';
      b.autoHold = '';
      break;
    case 'autoCourt': // choosing a court means "follow this court", so it also turns automatic selection on
      b.autoCourt = String(a.value || '').trim(); b.autoHold = '';
      if (b.autoCourt && !b.autoSelect) { b.autoSelect = true; log('info', 'auto', `Court set to ${b.autoCourt}, so automatic game selection is on`); }
      break;
    case 'followPlayhqClock': {
      b.followPlayhqClock = a.value === 'toggle' ? !b.followPlayhqClock : !!a.value && a.value !== 'off';
      b.playhqClockKey = null; // apply the next PlayHQ reading straight away
      break;
    }
    case 'period': {
      // Quarters 1-4 or halves 1-2, then 5 for extra time.
      const last = CONFIG.periodType === 'halves' ? 2 : 4;
      let next = a.value === 'next' ? b.period + 1 : a.value === 'prev' ? b.period - 1 : Number(a.value) || 1;
      if (next > last && next < 5) next = a.value === 'prev' ? last : 5;
      if (a.value === 'prev' && b.period === 5) next = last;
      b.period = Math.max(1, Math.min(5, next));
      break;
    }
    case 'periodLabel': b.periodLabel = String(a.value || 'Q').slice(0, 6); break;
    case 'clockStart': if (!b.clock.running) { b.clock.running = true; b.clock.startedAt = Date.now(); } break;
    case 'clockStop': if (b.clock.running) { b.clock.elapsedMs = clockElapsed(b.clock); b.clock.running = false; b.clock.startedAt = null; } break;
    case 'clockReset': b.clock = { ...b.clock, lengthSec: b.clock.baseSec || QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null }; break;
    case 'clockSet': { // set the time left, e.g. to match the venue clock
      const left = Math.max(0, Math.round(Number(a.secondsLeft) || 0));
      if (left > b.clock.lengthSec) b.clock.lengthSec = left; // e.g. a longer extra-time period
      b.clock.elapsedMs = (b.clock.lengthSec - left) * 1000;
      if (b.clock.running) b.clock.startedAt = Date.now();
      break;
    }
    case 'clockLength': b.clock.lengthSec = b.clock.baseSec = Math.max(60, Number(a.value) || QUARTER_SEC); break;
    case 'clockAdjust': { // + adds time to the clock, - takes it off
      const leftMs = b.clock.lengthSec * 1000 - clockElapsed(b.clock);
      applyAction(b, { type: 'clockSet', secondsLeft: Math.max(0, leftMs / 1000 + Number(a.deltaSec || 0)) });
      break;
    }
    case 'playhqRefresh': b.playhqRefreshSec = Math.max(3, Math.min(120, Math.round(Number(a.value) || DEFAULT_REFRESH_SEC))); break;
    case 'showClock': b.showClock = !!a.value; break;
    case 'tickerSpeed': { // a speed in pixels per second, or 'faster', 'slower', 'normal'
      const now = b.tickerSpeed || TICKER_SPEED;
      b.tickerSpeed = a.value === 'faster' ? tickerSpeed(now + TICKER_STEP) : a.value === 'slower' ? tickerSpeed(now - TICKER_STEP)
        : a.value === 'normal' ? TICKER_SPEED : tickerSpeed(a.value);
      log('info', 'ticker', `Ticker speed now ${b.tickerSpeed} pixels per second`);
      break;
    }
    case 'reset': Object.assign(b, newBoard(), { tickerSpeed: b.tickerSpeed }); clearGoals(b, null); break; // the ticker keeps its speed
  }
  b.updatedAt = Date.now();
}

// While a board follows PlayHQ, refresh its score from PlayHQ (every playhqRefreshSec, default 5).
async function refreshFromPlayhq(b) {
  if (b.source !== 'playhq' || !b.roundId) return;
  // Before electronic scoring starts there is nothing to read, so PlayHQ isn't asked.
  const wait = scoringNotYet(b);
  if (wait !== (b.playhqWaiting || '')) { if (wait) log('info', 'scoreboard', wait); b.playhqWaiting = wait; }
  if (wait) { b.playhqError = ''; return; }
  try {
    const maxAge = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
    let game = null;
    const s = await liveScore({ id: b.gameId }, maxAge);
    if (s) {
      game = { id: b.gameId, status: s.status, home: { name: b.home.name, score: s.home }, away: { name: b.away.name, score: s.away } };
      // Follow the scorer's quarter when it changes (the Stream Deck can still set it in between).
      const q = s.live && PERIOD_NUMBER[s.live.period];
      if (q && b.playhqPeriodSeen !== s.live.period) {
        if (b.period !== q) { b.period = q; log('info', 'scoreboard', `PlayHQ moved to quarter ${q}`); }
        b.playhqPeriodSeen = s.live.period;
      }
      if (s.live && s.live.clock) followClock(b, s.live);
    } else {
      // Last resort: the round fixture, which only has scores once a game is final.
      game = (await getRoundGames(b.roundId, maxAge)).find(g => g.id === b.gameId);
    }
    if (!game) return;
    watchSuperShots(b, game, s && s.live, s ? (s.live ? 'live' : 'game') : 'fixture');
    // Log what PlayHQ reports each time it changes, including "no score yet", for debugging.
    const seen = `${game.id} ${game.status} ${game.home.score} ${game.away.score}`;
    if (b.playhqSeen !== seen) {
      log('info', 'scoreboard', `PlayHQ says ${game.home.name} ${game.home.score ?? 'no score'} - ${game.away.score ?? 'no score'} ${game.away.name} (${game.status})`);
      b.playhqSeen = seen;
    }
    if (goalsFromPlayhq(b, game, s && s.live)) {
      if (!isFinished(game)) watchStreaks(b, 'playhq');
      saveBoards();
    }
    if (game.home.score !== null) b.home.score = game.home.score;
    if (game.away.score !== null) b.away.score = game.away.score;
    b.playhqStatus = game.status;
    b.playhqError = '';
  } catch (err) {
    if (b.playhqError !== err.message) log('error', 'scoreboard', `Following PlayHQ failed: ${err.message}`);
    b.playhqError = err.message;
  }
}

// ─── Goal order (last 10 goals graphic) ─────────────────────────────────────
// PlayHQ's live feed only gives running totals (score, goals, super goals per team), not a
// list of goals, so the order is worked out here from the score changing: each Follow PlayHQ
// reading (every playhqRefreshSec, default 5 s) is compared with the score on the board, and
// each +1 / +2 press on the control page or Stream Deck is a goal as it happens. A rise of 2 is
// split into goals and super goals by the feed's goal counts; without them it is taken as one
// super shot (two goals inside 5 seconds can't happen). The first reading of a game picked
// part way through, or a jump of more than 3 points for one team at once (the helper was
// closed, or nothing was polling), isn't split into goals: a gap is noted instead.
const GOALS_KEPT = 120;
const MAX_STEP = 3;
function clearGoals(b, gameId) { b.goals = []; b.goalsGameId = gameId || null; b.goalsBaseline = false; b.goalsSeq = 0; b.playhqCounts = null; b.streakFired = {}; }
function clockLeft(b) { return b.clock ? Math.max(0, Math.ceil(b.clock.lengthSec - clockElapsed(b.clock) / 1000)) : null; }
function pushGoal(b, side, points, how) {
  b.goalsSeq = (b.goalsSeq || 0) + 1;
  b.goals.push({ id: b.goalsSeq, side, points, period: b.period, clockLeft: clockLeft(b), at: Date.now(), how });
  if (b.goals.length > GOALS_KEPT) b.goals.splice(0, b.goals.length - GOALS_KEPT);
}
// A score taken off (a correction) removes that team's latest goals.
function takeGoals(b, side, points) {
  for (let i = b.goals.length - 1; i >= 0 && points > 0; i--) {
    const g = b.goals[i];
    if (g.side !== side || g.gap) continue;
    if (g.points <= points) { points -= g.points; b.goals.splice(i, 1); }
    else { g.points -= points; points = 0; } // a super goal taken down by 1
  }
}
function noteGoals(b, side, delta, how, split) {
  if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
  if (how === 'manual') b.goalsBaseline = true; // the board's score is now the one goals are counted from
  if (!delta) return;
  if (delta < 0) { takeGoals(b, side, -delta); return; }
  const supers = split ? split.superGoals : (rules(b.division).superShots ? Math.floor(delta / 2) : 0);
  const goals = split ? split.goals : delta - 2 * supers;
  for (let i = 0; i < supers; i++) pushGoal(b, side, 2, how);
  for (let i = 0; i < goals; i++) pushGoal(b, side, 1, how);
}
// Called with each PlayHQ reading before it is put on the board. Returns true if goals changed.
function goalsFromPlayhq(b, game, live) {
  if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
  const counts = live ? { home: { goals: live.home.goals, superGoals: live.home.superGoals }, away: { goals: live.away.goals, superGoals: live.away.superGoals } } : null;
  const before = b.goals.length, seq = b.goalsSeq;
  const deltas = { home: (game.home.score ?? b.home.score) - (Number(b.home.score) || 0), away: (game.away.score ?? b.away.score) - (Number(b.away.score) || 0) };
  if (!b.goalsBaseline) {
    // First reading for this game: only a game that hasn't started yet (0-0 on the board) is followed goal by goal from here.
    b.goalsBaseline = true;
    const onBoard = (Number(b.home.score) || 0) + (Number(b.away.score) || 0);
    if ((deltas.home || deltas.away) && (onBoard || deltas.home > MAX_STEP || deltas.away > MAX_STEP || deltas.home < 0 || deltas.away < 0)) {
      log('info', 'goals', `Picked up ${b.home.name} v ${b.away.name} at ${game.home.score}-${game.away.score}, so goals are listed from here`);
      b.goals.push({ id: ++b.goalsSeq, gap: true, at: Date.now() });
      b.playhqCounts = counts;
      return true;
    }
  }
  for (const side of ['home', 'away']) {
    const d = deltas[side];
    if (!d) continue;
    if (d > MAX_STEP) {
      log('info', 'goals', `${b[side].name} went up ${d} points between readings, too many to list one by one; noted as a gap`);
      b.goals.push({ id: ++b.goalsSeq, gap: true, at: Date.now() });
      continue;
    }
    const was = b.playhqCounts && b.playhqCounts[side], now = counts && counts[side];
    let split = null;
    if (d > 0 && was && now && now.goals != null && now.superGoals != null && was.goals != null && was.superGoals != null) {
      const g = now.goals - was.goals, sg = now.superGoals - was.superGoals;
      if (g >= 0 && sg >= 0 && g + 2 * sg === d) split = { goals: g, superGoals: sg };
    }
    noteGoals(b, side, d, 'playhq', split);
    log('info', 'goals', `${b[side].name} ${d > 0 ? '+' : ''}${d} (${split ? `${split.goals} goal${split.goals === 1 ? '' : 's'}, ${split.superGoals} super from PlayHQ's counts` : 'split worked out from the score'})`);
  }
  if (counts) b.playhqCounts = counts;
  return b.goals.length !== before || b.goalsSeq !== seq;
}
// ─── Hot streaks (for streak.html) ──────────────────────────────────────────
// Worked out from the goal order above, where a super goal is one goal: 3 goals in a row by one
// team is "heating up", 5 is "on fire", and 10 goals going one each way (home, away, home...)
// is "goal for goal". Each plays once: a run that reaches 5 plays "on fire" (and not "heating
// up" again), and a goal for goal stretch plays once however long it goes on. A run is known
// by the id of its first goal, so a -1 correction and the goal again doesn't replay it. A gap
// in the goal list (a game picked part way through, a jump too big to split) starts the count
// again, so scores catching up never play, and nothing plays once the game is finished.
// Each one bumps b.streak.n, and streak.html plays when it sees n go up.
const STREAK_GOALS = { heating: 3, fire: 5, goalForGoal: 10 };
const STREAK_NAMES = { heating: 'heating up', fire: 'on fire', goalForGoal: 'goal for goal' };
function streak(b, kind, side, goals, how, from) {
  const n = ((b.streak && b.streak.n) || 0) + 1;
  b.streak = { n, kind, side: side || '', goals, from: from || '', at: Date.now(), how }; // from: who scored the first goal of a goal for goal stretch
  log('info', 'streak', `${side ? `${b[side].name} (${side}) ` : ''}${STREAK_NAMES[kind]}, ${goals} goals (${how}), number ${n}`);
}
function watchStreaks(b, how) {
  if (!Array.isArray(b.goals)) return;
  const fired = b.streakFired || (b.streakFired = {});
  // Back from the latest goal: the current run by one team, and the stretch of goals going one each way.
  let run = 0, runStart = null, runSide = '', alt = 0, altStart = null, altSide = '', last = '';
  for (let i = b.goals.length - 1; i >= 0; i--) {
    const g = b.goals[i];
    if (g.gap || (runSide && g.side !== runSide)) break;
    runSide = g.side; run++; runStart = g.id;
  }
  for (let i = b.goals.length - 1; i >= 0; i--) {
    const g = b.goals[i];
    if (g.gap || (last && g.side === last)) break;
    last = altSide = g.side; alt++; altStart = g.id;
  }
  if (run >= STREAK_GOALS.fire && fired.fire !== runStart) { fired.fire = fired.heating = runStart; streak(b, 'fire', runSide, run, how); }
  else if (run >= STREAK_GOALS.heating && fired.heating !== runStart) { fired.heating = runStart; streak(b, 'heating', runSide, run, how); }
  if (alt >= STREAK_GOALS.goalForGoal && fired.goalForGoal !== altStart) { fired.goalForGoal = altStart; streak(b, 'goalForGoal', '', alt, how, altSide); }
}

// What goals.html shows: the last `count` goals (oldest first), the current run and the tally.
function getGoals(count) {
  const b = board();
  if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
  const n = Math.max(3, Math.min(30, Math.round(Number(count) || 10)));
  // Take the last n goals; a gap inside them is kept so the page can mark it.
  const out = [];
  let found = 0;
  for (let i = b.goals.length - 1; i >= 0 && found < n; i--) {
    out.unshift(b.goals[i]);
    if (!b.goals[i].gap) found++;
  }
  while (out.length && out[0].gap) out.shift();
  const real = out.filter(g => !g.gap);
  const tally = side => ({ goals: real.filter(g => g.side === side).length, points: real.filter(g => g.side === side).reduce((t, g) => t + g.points, 0) });
  let run = null;
  for (let i = b.goals.length - 1; i >= 0; i--) {
    const g = b.goals[i];
    if (g.gap) break;
    if (!run) run = { side: g.side, goals: 0, points: 0 };
    if (g.side !== run.side) break;
    run.goals++; run.points += g.points;
  }
  const r = rules(b.division);
  return {
    gameId: b.gameId, division: b.division, court: b.court, round: b.round, source: b.source, period: b.period,
    periodLabel: r.periodLabel, superShots: r.superShots, competition: competitionName(),
    home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
    away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
    count: n, goals: out, tally: { home: tally('home'), away: tally('away') }, run,
    totalGoals: b.goals.filter(g => !g.gap).length, gapInHistory: b.goals.some(g => g.gap),
  };
}

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
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function startOf(g, date = g.date) {
  const m = String(g.time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!date || !m) return null;
  return new Date(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime();
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
  b.clock = { ...b.clock, lengthSec: b.clock.baseSec || QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null };
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

// The scorer's game clock from PlayHQ's live feed. Seen so far (one finished game):
// { period: "4th Quarter", periodValue: "FOURTH_QTR", status: "RESUME", time: "00:00", lastUpdatedAt: "<ms>" }.
// Read as: `time` is the time left when the scorer last touched the clock (lastUpdatedAt),
// and RESUME/START mean it is running. Every reading is logged so this can be checked.
function followClock(b, live) {
  const c = live.clock;
  b.playhqClock = c;
  const key = `${c.periodValue || c.period} ${c.status} ${c.time} ${c.lastUpdatedAt} ${live.break || ''}`;
  if (b.playhqClockKey === key) return;
  b.playhqClockKey = key;
  const secs = parseClock(c.time);
  const running = /^(RESUME|RESUMED|START|STARTED|RUNNING)$/i.test(c.status || '') && !live.break;
  const updated = Number(c.lastUpdatedAt) || Date.parse(c.lastUpdatedAt) || 0;
  const lagMs = running && updated ? Math.max(0, Math.min(120000, Date.now() - updated)) : 0;
  log('info', 'clock', `PlayHQ clock ${c.periodValue || c.period || '?'} ${c.status || '?'} ${c.time ?? '?'} (updated ${updated ? Math.round((Date.now() - updated) / 1000) + 's ago' : '?'})${live.break ? ' break ' + live.break : ''}${b.followPlayhqClock ? '' : ' (not followed)'}`);
  if (!b.followPlayhqClock || secs === null) return;
  if (secs > b.clock.lengthSec) b.clock.lengthSec = secs;
  const leftMs = Math.max(0, secs * 1000 - lagMs);
  b.clock = { ...b.clock, elapsedMs: b.clock.lengthSec * 1000 - leftMs, running: running && leftMs > 0, startedAt: running && leftMs > 0 ? Date.now() : null };
  b.updatedAt = Date.now();
}

// ─── Stream Deck links ──────────────────────────────────────────────────────
// Plain GET links, so a Stream Deck "Website" button (with "GET request in
// background" ticked) can press them. Full list in STREAMDECK.md.
//   /deck/home/add1  add2  minus1  minus2     (same for /deck/away/...)
//   /deck/home/supershot                      (plays supershot.html for that team, score unchanged)
//   /deck/streak/heating/home  fire/away  goalforgoal   (plays streak.html, score unchanged)
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
function parseClock(t) {
  const m = String(t || '').match(/^(\d{1,2})(?:[:.](\d{1,2}))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
}
function deckAction(parts, q) {
  const [what, verb, arg] = parts;
  if (what === 'home' || what === 'away') {
    const m = String(verb || '').match(/^(add|plus|minus|sub)(\d)$/);
    if (m) return { type: 'score', side: what, delta: (m[1] === 'add' || m[1] === 'plus' ? 1 : -1) * Number(m[2]) };
    if (verb === 'supershot') return { type: 'superShot', side: what };
  }
  // /deck/streak/heating/home, /deck/streak/fire/away, /deck/streak/goalforgoal (streak.html, score unchanged)
  if (what === 'streak') {
    const kind = { heating: 'heating', heatingup: 'heating', fire: 'fire', onfire: 'fire', goalforgoal: 'goalForGoal' }[String(verb || '').toLowerCase()];
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
const MACHINE_KEYS = ['port', 'cacheSeconds', 'playhqRefreshSeconds', 'logMaxMB', 'apiBaseUrl', 'gameSummaryPath'];
function applyCompetition(why) {
  const id = competitions.activeId();
  const prev = CONFIG;
  CONFIG = { ...Object.fromEntries(MACHINE_KEYS.filter(k => MACHINE[k] !== undefined).map(k => [k, MACHINE[k]])), ...competitions.get(id), id };
  const u = parsePlayhqUrl(CONFIG.organisationUrl) || {};
  TENANT = u.tenant || 'netball-australia';
  ORG_ID = u.orgId || null;
  LOOKAHEAD_DAYS = CONFIG.roundLookaheadDays || 5;
  AUTO_LEAD_MS = (Number.isFinite(Number(CONFIG.autoSelectMinutesBefore)) ? Number(CONFIG.autoSelectMinutesBefore) : 10) * 60 * 1000;
  QUARTER_SEC = Math.round((Number(CONFIG.quarterMinutes) || 10) * 60);
  structure = null; // names may have changed
  const switched = prev.id && prev.id !== id;
  const sourceChanged = switched || ['organisationUrl', 'competitionName', 'seasonName'].some(k => prev[k] !== CONFIG[k]);
  if (prev.id && sourceChanged) {
    for (const cache of [ladderCache, roundGamesCache, gameCache, liveCache, roundsCache, roundDatesCache, summaryCache, appearanceCache]) cache.clear();
    tenantLabel = ''; cookie = null;
  }
  { const b = board(); // a new quarter length applies to a clock that hasn't started
    if (!b.clock.running && !b.clock.elapsedMs) b.clock.lengthSec = b.clock.baseSec = QUARTER_SEC;
  }
  log('info', 'setup', !id ? `${why}: none yet` : `${why}: ${CONFIG.name} (${CONFIG.competitionName || 'no PlayHQ competition set'}, organisation ${ORG_ID || 'not set'} on ${TENANT})`);
  if (prev.id && sourceChanged) {
    if (roundChoice) setRoundChoice('');
    Object.assign(board(), newBoard()); autoPick();
    saveBoards();
  }
}

// What the setup page shows for one competition.
function setupInfo(id) {
  return { id, active: id === competitions.activeId(), settings: competitions.get(id),
    logos: competitions.images(id, 'logos'), brand: competitions.images(id, 'brand') };
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
  const m = url.pathname.match(/^\/api\/setup(?:\/([a-z0-9-]+)(?:\/(activate|image|export|template))?)?$/);
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
    canSaveImports: datadir.canSaveImports(), dataDir: datadir.DATA_DIR, readOnly: competitions.isReadOnly(),
    fonts: competitions.FONTS, defaults: competitions.DEFAULTS, finalsFormats: finals.list(), finalsMarks: finals.MARKS });
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
  if (what === 'image') {
    const kind = q.kind === 'brand' ? 'brand' : 'logos';
    if (req.method === 'POST') {
      const name = competitions.saveImage(id, kind, q.name, await readRaw(req, 15 * 1024 * 1024));
      log('info', 'setup', `${id}: added ${kind === 'brand' ? 'competition logo' : 'team logo'} ${name}`);
      return send(res, 200, { name, ...setupInfo(id) });
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
  if (what === 'template') return send(res, 200, competitions.exportTemplate(id));
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
  const headers = { accept: 'application/json', 'x-phq-tenant': CONFIG.apiTenant || TENANT };
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
  fs.writeFile(DATA('last-game-summary.json'), JSON.stringify(json, null, 2), () => {});
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

// ─── Team logos (competitions/<id>/logos) ───────────────────────────────────
// A logo belongs to the team's club, so every division's team of that club shows it.
// Matched to the club's (then the team's) name loosely ("Perth Coastal" finds "Perth Coastals.png").
// A club whose name doesn't match can be given a logo on the competition setup page.
function logoFor(teamName) {
  const files = competitions.images(competitions.activeId(), 'logos');
  if (!files.length) return null;
  const club = competitions.clubFor(CONFIG, teamName);
  const picked = competitions.clubEntry(CONFIG, club).logo;
  if (picked && files.includes(picked)) return '/logos/' + encodeURIComponent(picked);
  const norm = s => String(s || '').toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  for (const want of [norm(club), norm(teamName)]) {
    if (!want) continue;
    const hit = files.find(f => norm(f) === want) || files.find(f => want.includes(norm(f)) || norm(f).includes(want));
    if (hit) return '/logos/' + encodeURIComponent(hit);
  }
  return null;
}

// ─── Athlete photos (competitions/<id>/photos) ──────────────────────────────
// Each photo is named after the athlete ("Jane Smith.jpg"), so the name is the match.
// Matching ignores case, punctuation and word order ("smith_jane.png" finds Jane Smith,
// "Noah OBrien.jpg" finds Noah O'Brien).
// The athletes page (athletes.html) saves photos under the athlete's PlayHQ name.
const photoKey = s => String(s || '').toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
const fileKey = f => photoKey(path.basename(f, path.extname(f)));
function photoFiles() { return competitions.images(competitions.activeId(), 'photos'); }
function photoFor(name, files = photoFiles()) {
  const want = photoKey(name);
  const hit = want && files.find(f => fileKey(f) === want);
  return hit ? '/photos/' + encodeURIComponent(hit) : null;
}
// ─── Athlete register (competitions/<id>/athletes.json) ─────────────────────
// One entry per athlete in the competition, keyed by their name like the photos, so an
// athlete who plays in more than one division (or team) is one athlete with one photo.
// It remembers the teams and divisions they've played for, their PlayHQ ids and gender,
// and a gender set by hand on the athletes page. Filled in as line ups are read.
let register = { id: null, data: {}, dirty: false };
function registerFile(id) { return path.join(competitions.DIR, id, 'athletes.json'); }
function athletes() {
  const id = competitions.activeId();
  if (register.id !== id) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(registerFile(id), 'utf8')).athletes || {}; } catch { /* none yet */ }
    register = { id, data, dirty: false };
  }
  return register.data;
}
function saveRegister() {
  if (!register.dirty || !register.id) return;
  const sorted = Object.fromEntries(Object.keys(register.data).sort().map(k => [k, register.data[k]]));
  try {
    fs.writeFileSync(registerFile(register.id), JSON.stringify({ athletes: sorted }, null, 2) + '\n');
    register.dirty = false;
  } catch (err) { log('warn', 'athletes', `Could not save athletes.json: ${err.message}`); }
}
// Adds a team's line up to the register: a new athlete, a new team or division, a PlayHQ id or gender.
function recordPlayers(team, division, players) {
  const data = athletes();
  for (const p of players || []) {
    const k = photoKey(p.name);
    if (!k || p.private) continue;
    const before = JSON.stringify(data[k] || null);
    const e = data[k] || (data[k] = { name: p.name });
    if (p.playhqId) e.playhqIds = [...new Set([...(e.playhqIds || []), String(p.playhqId)])].sort();
    if (p.gender) e.playhqGender = p.gender;
    if (team && division) {
      e.teams = e.teams || {};
      e.teams[division] = [...new Set([...(e.teams[division] || []), team])].sort();
    }
    if (JSON.stringify(e) !== before) register.dirty = true;
  }
  saveRegister();
}
// The gender of a division, from PlayHQ ('' for mixed or open), once the divisions have been read.
function divisionGender(division) {
  const g = structure && structure.grades.find(x => norm(x.name) === norm(division));
  return g ? g.gender || '' : '';
}
// Where an athlete's silhouette comes from: picked by hand, PlayHQ's player gender, or else the
// PlayHQ gender of the divisions they play in (a men's or women's division; mixed says nothing).
function genderInfo(name, fromPlayhq, division) {
  const e = athletes()[photoKey(name)] || {};
  if (e.gender) return { gender: e.gender, genderFrom: 'hand' };
  if (e.playhqGender || fromPlayhq) return { gender: e.playhqGender || fromPlayhq, genderFrom: 'playhq' };
  const found = new Set([...Object.keys(e.teams || {}), division].filter(Boolean).map(divisionGender).filter(Boolean));
  if (found.size === 1) return { gender: [...found][0], genderFrom: 'division' };
  return { gender: '', genderFrom: '' };
}
function genderFor(name, fromPlayhq, division) { return genderInfo(name, fromPlayhq, division).gender; }
// The generic picture for an athlete with no photo.
function silhouette(gender) { return `/silhouettes/${gender === 'female' || gender === 'male' ? gender : 'neutral'}.svg`; }
// Every team and division the register has seen the athlete in.
function athleteTeams(name) {
  const e = athletes()[photoKey(name)] || {};
  return Object.entries(e.teams || {}).flatMap(([division, teams]) => teams.map(team => ({ division, team })))
    .sort((a, b) => a.division.localeCompare(b.division, 'en', { numeric: true }) || a.team.localeCompare(b.team));
}

// Adds each player's photo (or silhouette) to a team sheet answer.
function withPhotos(data) {
  const files = photoFiles();
  for (const side of ['home', 'away']) {
    if (!data[side] || !data[side].players) continue;
    if (!data.stale) recordPlayers(data[side].name, data.division, data[side].players);
    data[side].players = data[side].players.map(p => {
      const gender = genderFor(p.name, p.gender, data.division);
      return { ...p, gender, photo: photoFor(p.name, files), silhouette: silhouette(gender) };
    });
  }
  return data;
}
// Saves a photo as "<name>.<ext>", replacing any other photo of the same athlete.
function savePhoto(name, ext, buf) {
  const id = competitions.activeId();
  const clean = String(name || '').replace(/[^\w .'()&+-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!photoKey(clean)) throw new Error('A photo needs an athlete name.');
  const type = String(ext || '').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
  for (const f of photoFiles()) if (fileKey(f) === photoKey(clean)) competitions.deleteImage(id, 'photos', f);
  return competitions.saveImage(id, 'photos', `${clean}.${type}`, buf);
}

// Every athlete PlayHQ has listed for one team this season, from the line ups of its
// finished games and its next game (line ups are often entered before the game).
// With a division, only that division's team of that name (a club can have one in several).
async function seasonLineups(teamName, inDivision) {
  const st = await getStructure();
  const want = norm(teamName);
  const games = [];
  let division = '';
  for (const grade of st.grades) {
    if (inDivision && norm(grade.name) !== norm(inDivision)) continue;
    const mine = (await getSeasonGames(grade)).filter(g => norm(g.home.name) === want || norm(g.away.name) === want);
    if (mine.length) division = grade.name;
    const done = mine.filter(isFinished);
    const next = mine.find(g => !isFinished(g));
    games.push(...done, ...(next ? [next] : []));
  }
  const athletes = new Map();
  let read = 0, failed = 0, lastError = '';
  const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 1000));
  for (const [i, g] of games.entries()) {
    if (lineups[i].error) { failed++; lastError = lineups[i].error.message; continue; }
    const parsed = lineups[i].value;
    read++;
    for (const s of [parsed.home, parsed.away]) recordPlayers(s.name, g.division, s.players);
    const side = norm(parsed.home.name) === want ? parsed.home : norm(parsed.away.name) === want ? parsed.away : null;
    if (!side) continue;
    for (const p of side.players) {
      if (p.private) continue; // "Private player" can't be told apart
      const k = photoKey(p.name);
      const a = athletes.get(k) || { name: p.name, number: '', positions: {}, games: 0, captain: false, lastDate: '', gender: '' };
      a.gender = a.gender || p.gender;
      a.games++;
      if (p.position) a.positions[p.position] = (a.positions[p.position] || 0) + 1;
      if ((g.date || '') >= a.lastDate) { a.lastDate = g.date || ''; if (p.number !== '' && p.number != null) a.number = p.number; }
      a.captain = a.captain || p.captain;
      athletes.set(k, a);
    }
  }
  if (failed) log('warn', 'athletes', `${teamName}: ${failed} of ${games.length} games could not be read: ${lastError}`);
  return { st, athletes, division, games, read, failed, lastError };
}
async function getAthletes(teamName, inDivision) {
  const { st, athletes, division, games, read, failed, lastError } = await seasonLineups(teamName, inDivision);
  const files = photoFiles();
  let all = {};
  try { all = await allAppearances(); } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
  const rank = a => { const i = POSITION_RANK.indexOf(a.position); return i === -1 ? 99 : i; };
  const list = [...athletes.values()].map(a => {
    const position = Object.entries(a.positions).sort((x, y) => y[1] - x[1])[0];
    const g = genderInfo(a.name, a.gender, division);
    return { name: a.name, number: a.number, position: position ? position[0] : '', positions: Object.keys(a.positions), games: a.games, captain: a.captain,
      photo: photoFor(a.name, files), ...g, genderSetByHand: g.genderFrom === 'hand', silhouette: silhouette(g.gender), teams: athleteTeams(a.name),
      ...athleteStats(a.name, all[photoKey(a.name)]) };
  }).sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
  return { team: teamName, logo: logoFor(teamName), division, divisions: st.grades.map(g => g.name), athletes: list, gamesRead: read, gamesFound: games.length,
    error: !read && failed ? lastError : !games.length ? `PlayHQ has no games for ${teamName}${inDivision ? ` in ${inDivision}` : ''} this season.` : undefined };
}

// ─── Games and positions played ─────────────────────────────────────────────
// The athletes page can give an athlete a games played figure per division, and optionally
// per club, "as of" a date: the games PlayHQ shows in that division (and club) after that
// date are added on, so the number keeps up through the season. With no date the number is
// used as it is. Positions played typed in are added to the ones seen in PlayHQ line ups.
// Both are kept in the athlete register (athletes.json) as `records` and `positions`.
// A game counts when the athlete is named in that team's line up for a finished game.
const appearanceCache = new Map();
async function seasonAppearances(grade) {
  const hit = appearanceCache.get(grade.id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.map;
  const map = new Map();
  const games = (await getSeasonGames(grade)).filter(isFinished);
  const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 60 * 1000));
  for (const [i, g] of games.entries()) {
    if (lineups[i].error) { log('warn', 'athletes', `${grade.name}: game ${g.id} could not be read: ${lineups[i].error.message}`); continue; }
    const parsed = lineups[i].value;
    for (const side of [parsed.home, parsed.away]) {
      recordPlayers(side.name, grade.name, side.players);
      for (const p of side.players) {
        if (p.private || !photoKey(p.name)) continue;
        const list = map.get(photoKey(p.name)) || [];
        if (!list.some(a => a.gameId === g.id)) list.push({ gameId: g.id, date: g.date || '', team: side.name, position: p.position });
        map.set(photoKey(p.name), list);
      }
    }
  }
  appearanceCache.set(grade.id, { at: Date.now(), map });
  return map;
}
// Every division's appearances, keyed by athlete: { key: { division: [appearance] } }.
async function allAppearances() {
  const st = await getStructure();
  const out = {};
  for (const grade of st.grades) {
    try {
      for (const [k, list] of await seasonAppearances(grade)) (out[k] = out[k] || {})[grade.name] = list;
    } catch (err) { log('warn', 'athletes', `${grade.name}: appearances unavailable: ${err.message}`); }
  }
  return out;
}
// Games played per division for one athlete, from their records and this season's line ups.
function career(name, apps) {
  const e = athletes()[photoKey(name)] || {};
  const records = e.records || [];
  const divisions = [...new Set([...records.map(r => r.division), ...Object.keys(apps || {})])]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return divisions.map(division => {
    const season = (apps && apps[division]) || [];
    const since = r => r.asOf ? season.filter(a => (!r.club || sameTeam(a.team, r.club)) && a.date > r.asOf).length : 0;
    const lines = records.filter(r => r.division === division).map(r => ({ ...r, since: since(r), total: r.games + since(r) }));
    const whole = lines.filter(l => !l.club).sort((a, b) => (b.asOf || '').localeCompare(a.asOf || ''))[0];
    // No record for the whole division: add up the club records, plus this season's games for other clubs.
    const total = whole ? whole.total : lines.reduce((n, l) => n + l.total, 0) + season.filter(a => !lines.some(l => sameTeam(l.club, a.team))).length;
    return { division, total, season: season.length, lines };
  });
}
// The games played to show for an athlete in a division, for a club when they have a record for it.
function gamesIn(name, apps, division, club) {
  const d = career(name, apps).find(c => c.division === division);
  if (!d) return 0;
  const line = club && d.lines.find(l => l.club && sameTeam(l.club, club));
  return line ? line.total : d.total;
}
function positionsPlayed(name, apps) {
  const e = athletes()[photoKey(name)] || {};
  const seen = Object.values(apps || {}).flat().map(a => a.position);
  return POSITION_RANK.filter(p => (e.positions || []).includes(p) || seen.includes(p));
}
// What the athletes page shows and edits for one athlete.
function athleteStats(name, apps) {
  const e = athletes()[photoKey(name)] || {};
  return { career: career(name, apps), positionsPlayed: positionsPlayed(name, apps), positionsTyped: e.positions || [], records: e.records || [] };
}
function cleanRecords(list) {
  return (Array.isArray(list) ? list : []).map(r => {
    const division = String(r.division || '').trim();
    const games = Math.round(Number(r.games));
    const asOf = String(r.asOf || '').trim();
    if (!division) throw new Error('Each games played line needs a division.');
    if (!Number.isFinite(games) || games < 0) throw new Error(`Games played for ${division} must be 0 or more.`);
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`"${asOf}" isn't a date (YYYY-MM-DD).`);
    const out = { division, games };
    if (String(r.club || '').trim()) out.club = String(r.club).trim();
    if (asOf) out.asOf = asOf;
    return out;
  });
}

async function athletesRoute(req, res, url, q) {
  const id = competitions.activeId();
  if (url.pathname === '/api/athletes/photo') {
    if (req.method === 'POST') {
      const buf = await readRaw(req, 15 * 1024 * 1024);
      if (!buf.length) throw new Error('That file is empty.');
      // ?athlete= saves it under that athlete's name; ?file= keeps the file's own name (several dropped at once).
      const ext = path.extname(q.file || '') || ('.' + (q.ext || 'jpg'));
      const name = savePhoto(q.athlete || path.basename(q.file || '', path.extname(q.file || '')), ext, buf);
      log('info', 'athletes', `${id}: photo ${name} saved`);
      return send(res, 200, { name, url: '/photos/' + encodeURIComponent(name) });
    }
    if (req.method === 'DELETE') {
      competitions.deleteImage(id, 'photos', q.file);
      log('info', 'athletes', `${id}: photo ${q.file} removed`);
      return send(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/athletes/rename' && req.method === 'POST') {
    const body = await readBody(req);
    const clean = String(body.athlete || '').replace(/[^\w .'()&+-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!photoKey(clean)) throw new Error('Pick an athlete for this photo.');
    for (const f of photoFiles()) if (f !== body.file && fileKey(f) === photoKey(clean)) competitions.deleteImage(id, 'photos', f);
    const name = competitions.renameImage(id, 'photos', body.file, clean + path.extname(String(body.file || '')).toLowerCase());
    log('info', 'athletes', `${id}: photo ${body.file} is now ${name}`);
    return send(res, 200, { name, url: '/photos/' + encodeURIComponent(name) });
  }
  // A gender set by hand, for the silhouette ('' goes back to PlayHQ's).
  if (url.pathname === '/api/athletes/gender' && req.method === 'POST') {
    const body = await readBody(req);
    const k = photoKey(body.athlete);
    if (!k) throw new Error('Which athlete?');
    const data = athletes();
    const e = data[k] || (data[k] = { name: String(body.athlete).trim() });
    if (body.gender === 'female' || body.gender === 'male') e.gender = body.gender; else delete e.gender;
    register.dirty = true;
    saveRegister();
    log('info', 'athletes', `${id}: ${e.name} gender ${e.gender || 'from PlayHQ'}`);
    const g = genderInfo(e.name);
    return send(res, 200, { name: e.name, ...g, genderSetByHand: g.genderFrom === 'hand', silhouette: silhouette(g.gender) });
  }
  // Games played and positions played, typed in on the athletes page.
  if (url.pathname === '/api/athletes/stats' && req.method === 'POST') {
    const body = await readBody(req);
    const k = photoKey(body.athlete);
    if (!k) throw new Error('Which athlete?');
    const records = cleanRecords(body.records);
    const positions = POSITION_RANK.filter(p => (body.positions || []).includes(p));
    const data = athletes();
    const e = data[k] || (data[k] = { name: String(body.athlete).trim() });
    if (records.length) e.records = records; else delete e.records;
    if (positions.length) e.positions = positions; else delete e.positions;
    register.dirty = true;
    saveRegister();
    log('info', 'athletes', `${id}: ${e.name} games/positions saved`, { records, positions });
    let apps = {};
    try { apps = (await allAppearances())[k] || {}; } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
    return send(res, 200, { name: e.name, ...athleteStats(e.name, apps) });
  }
  // Games played by both line ups of the game on a board, for the graphics.
  if (url.pathname === '/api/athletes/games') {
    const b = board();
    const all = await allAppearances();
    const out = { division: b.division };
    let sheets = { home: { players: [] }, away: { players: [] } };
    try { sheets = await getTeamSheets(); } catch { /* none */ }
    for (const side of ['home', 'away']) {
      out[side] = Object.fromEntries((sheets[side].players || []).map(p =>
        [p.name, { games: gamesIn(p.name, all[photoKey(p.name)], b.division, b[side].name), positions: positionsPlayed(p.name, all[photoKey(p.name)]) }]));
    }
    return send(res, 200, out);
  }
  if (url.pathname !== '/api/athletes') return send(res, 404, { error: 'Unknown athletes link' });
  // Every athlete seen so far in the competition, across all its divisions.
  if (q.all) {
    let all = {};
    try { all = await allAppearances(); } catch (err) { log('warn', 'athletes', `Appearances unavailable: ${err.message}`); }
    const files = photoFiles();
    const list = Object.values(athletes()).map(e => {
      const g = genderInfo(e.name);
      return { name: e.name, ...g, genderSetByHand: g.genderFrom === 'hand', photo: photoFor(e.name, files), silhouette: silhouette(g.gender), teams: athleteTeams(e.name),
        ...athleteStats(e.name, all[photoKey(e.name)]) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return send(res, 200, { athletes: list });
  }
  if (q.team) return send(res, 200, await getAthletes(q.team, q.division));
  const list = { folder: `competitions/${id}/photos`, photos: photoFiles().map(f => ({ file: f, url: '/photos/' + encodeURIComponent(f) })) };
  if (q.photos === 'only') return send(res, 200, list);
  // The teams to pick from, the two in the game on the control page, and every photo saved.
  const b = board();
  let teams = [], error;
  try { teams = (await setupTeams({ byDivision: true })).teams.map(t => ({ name: t.name, division: t.division, logo: t.logo })); } catch (err) { error = err.message; }
  return send(res, 200, { competition: CONFIG.name, teams, currentDivision: b.division || '', current: [b.home.name, b.away.name].filter(n => n && n !== 'TBC' && !/^home$|^away$/i.test(n)),
    ...list, error });
}

// A team's club colour from the competition setup page, or null to use the competition's colours.
function colourFor(teamName) {
  return competitions.clubEntry(CONFIG, competitions.clubFor(CONFIG, teamName)).colour || null;
}

// A line up with fewer than seven players isn't complete (benches often clear it and only
// add players as they score): the rest of the team's season squad (everyone in its line ups
// this season) is added after them, without positions, and marked fromSquad.
const FULL_LINEUP = 7;
const squadCache = new Map();
const squadInFlight = new Map();
async function squadFor(teamName, division) {
  const k = `${norm(division)}|${norm(teamName)}`;
  const hit = squadCache.get(k);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.list;
  if (!squadInFlight.has(k)) {
    squadInFlight.set(k, seasonLineups(teamName, division).then(({ athletes }) => {
      const list = [...athletes.values()].map(a => ({ name: a.name, number: a.number, gender: a.gender }));
      squadCache.set(k, { at: Date.now(), list });
      return list;
    }).finally(() => squadInFlight.delete(k)));
  }
  return squadInFlight.get(k);
}
async function withSquad(side, division) {
  if (!side.name || side.players.length >= FULL_LINEUP) return side;
  let squad = [];
  try { squad = await squadFor(side.name, division); } catch (err) { log('warn', 'teams', `${side.name}: squad unavailable: ${err.message}`); }
  const listed = new Set(side.players.map(p => photoKey(p.name)));
  const rest = squad.filter(a => !listed.has(photoKey(a.name))).map(a => ({ name: a.name, number: a.number || '', playhqId: '', gender: a.gender || '',
    position: '', private: false, captain: false, viceCaptain: false, shooting: { goals: 0, superGoals: 0, shots: null, points: 0 }, fromSquad: true }))
    .sort((x, y) => x.name.localeCompare(y.name));
  if (!rest.length) return side;
  const key = `${side.name}|${side.players.length}|${rest.length}`;
  if (!squadLogged.has(key)) { squadLogged.add(key); log('info', 'teams', `${side.name}: line up has ${side.players.length} players, adding ${rest.length} more from the season squad`); }
  return { ...side, players: [...side.players, ...rest], squad: true };
}
const squadLogged = new Set();

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

// PlayHQ's status names aren't documented, so a game counts as finished when its
// status says so, or when it has scores, isn't marked live and its date has passed.
function isFinished(g) {
  const st = g.status || '';
  if (/COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(st)) return true;
  if (/PROGRESS|LIVE|STARTED|UPCOMING|SCHEDULED/i.test(st)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return g.home.score !== null && g.away.score !== null && !!g.date && g.date < today;
}
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
function competitionName() { return (structure && structure.competition) || CONFIG.displayName || CONFIG.competitionName; }
// The competition's rules and look, for pages that change with them. With a division, super
// shots are that division's (a competition can play them in some divisions only).
function rules(division) {
  // Light and dark mode competition logos; when only one is set it is used for both.
  const brandUrl = f => f ? '/brand/' + encodeURIComponent(f) : null;
  const light = brandUrl(CONFIG.competitionLogo || CONFIG.competitionLogoDark), dark = brandUrl(CONFIG.competitionLogoDark || CONFIG.competitionLogo);
  return { periodType: CONFIG.periodType, periods: CONFIG.periodType === 'halves' ? 2 : 4, periodLabel: CONFIG.periodType === 'halves' ? 'H' : 'Q',
    periodMinutes: CONFIG.quarterMinutes, superShots: competitions.superShotsFor(CONFIG, division), finalsPlaces: (finals.byId(CONFIG.finalsFormat) || { teams: 0 }).teams,
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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

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
    // The competition in use: its colours, team logos, competition logo and athlete photos.
    if (url.pathname === '/theme.css') return send(res, 200, competitions.themeCss(CONFIG), 'text/css; charset=utf-8');
    if (/^\/(logos|brand|photos)\//.test(url.pathname)) {
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
    if (url.pathname === '/api/teams') return send(res, 200, withPhotos(await getTeamSheets()));
    if (url.pathname.startsWith('/api/athletes')) return await athletesRoute(req, res, url, q);
    if (url.pathname === '/api/games') return send(res, 200, await getCurrentGames());
    if (url.pathname === '/api/rounds') {
      if (req.method === 'POST') setRoundChoice((await readBody(req)).round);
      return send(res, 200, await getRoundInfo());
    }
    if (url.pathname === '/api/countdown') return send(res, 200, getCountdown());
    if (url.pathname === '/api/upnext') return send(res, 200, await getUpNext());
    if (url.pathname === '/api/ladderbar') return send(res, 200, await getLadderBar());
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
    if (url.pathname.startsWith('/deck/')) {
      const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
      // The scene's links: /deck/layer/<name>/on|off|toggle|restart and /deck/layers/off.
      const layer = scene.deck(parts);
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
      const logos = { home: logoFor(b.home.name), away: logoFor(b.away.name) };
      const teamColours = { home: colourFor(b.home.name), away: colourFor(b.away.name) };
      const venueName = CONFIG.venueName || b.venue || '';
      const r = rules(b.division);
      return send(res, 200, { ...b, periodLabel: r.periodLabel, rules: r, competition: competitionName(), competitionSetup: CONFIG.name, venueName, logos, teamColours,
        clockElapsedMs: clockElapsed(b.clock), serverNow: Date.now() });
    }
    const ALIASES = { '/': 'index.html', '/results.html': 'fixtures.html' }; // results.html is the fixture page showing finished games
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
}).listen(PORT, () => {
  log('info', 'helper', `Started on port ${PORT} (links ${LINK_BASE}), Node ${process.version}, competition ${CONFIG.name}, organisation ${ORG_ID || '(not set)'} on ${TENANT}`);
  console.log(`Debug log: ${LOG_FILE}`);
  setTimeout(() => warmTeamLists('start up'), 2000);
  console.log(`PlayHQ Graphics is running. Open ${LINK_BASE}/ for the page links.`);
  console.log(`Competition: ${CONFIG.name} (change it at ${LINK_BASE}/setup.html). Leave this window open while streaming.`);
});
