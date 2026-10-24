// FirstPass Studio - the PlayHQ client: everything that talks to PlayHQ, and nothing else.
//
// PlayHQ's public data (what www.playhq.com shows) comes from https://api.playhq.com/graphql. It
// needs no API key, but only answers requests that look like they come from playhq.com and carry
// a guest session cookie, so this module gets the cookie, asks the questions and caches the
// answers: the organisation's competitions and seasons (the "structure"), ladders, rounds and
// their games, one game in detail (line ups and player stats, from the same discoverGame query
// the game page makes), and the live scoring feed from spectator.playhq.com (running score, the
// scorer's clock and quarter). Finished games' line ups are kept in game-cache.json in the local
// data folder so a restart doesn't ask for the whole season again.
//
// create(deps) gives one client for the competition in use. deps:
//   log(level, source, message, extra)   the debug log
//   apiUrl, cacheMs, linkBase            from config.json (the link is only for error messages)
//   config()                             the competition settings in use (CONFIG in server.js)
//   leadMs()                             how long before a game electronic scoring opens (autoSelectMinutesBefore)
//   logoFor(teamName), positionOf(player) the competition's team logo and the netball position code
// setOrganisation(url) points it at a PlayHQ organisation (tenant and id from the link); resetCaches()
// forgets everything cached when the competition changes. The pure helpers (parsePlayhqUrl,
// isFinished, startOf, localDate) are exported on their own as well.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const datadir = require('./datadir');
const savefile = require('./savefile');

// ─── Where the data comes from ──────────────────────────────────────────────
// config.json holds the organisation's PlayHQ page link. From it we read the
// sport "tenant" (e.g. netball-australia) and the 8-character organisation id.
function parsePlayhqUrl(url) {
  const m = String(url || '').match(/playhq\.com\/(?:[a-z]{2}\/)?([a-z0-9-]+)\/org\/[^/]+\/([0-9a-f]{8})/i);
  return m ? { tenant: m[1], orgId: m[2] } : null;
}

// PlayHQ's status names aren't documented, so a game counts as finished when its
// status says so, or when it has scores, isn't marked live and its date has passed.
function isFinished(g) {
  const st = g.status || '';
  if (/COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(st)) return true;
  if (/PROGRESS|LIVE|STARTED|UPCOMING|SCHEDULED/i.test(st)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return g.home.score !== null && g.away.score !== null && !!g.date && g.date < today;
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function startOf(g, date = g.date) {
  const m = String(g.time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!date || !m) return null;
  return new Date(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime();
}

function create(deps) {
  const { log, apiUrl, cacheMs, linkBase, config, leadMs, logoFor, positionOf } = deps;

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
          const res = await fetch(apiUrl, { method: 'POST', headers: { ...HEADERS, tenant: TENANT, 'request-id': crypto.randomUUID() }, body: JSON.stringify(body) });
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
    try { res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ operationName, query, variables }) }); }
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
    if (config().seasonName) {
      const s = seasons.find(x => x.name.toLowerCase().includes(config().seasonName.toLowerCase()));
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
    let seasonId = config().seasonId || null;
    let orgName = config().organisationName, compName = config().competitionName, allCompetitions = [];
    if (!seasonId) {
      if (!ORG_ID) throw new Error(`Add the organisation's PlayHQ link for ${config().name} on the competition setup page (${linkBase}/setup.html).`);
      const data = await gql('discoverCompetitions', Q_COMPETITIONS, { organisationID: ORG_ID });
      allCompetitions = data.discoverCompetitions || [];
      const want = (config().competitionName || '').toLowerCase();
      const comp = allCompetitions.find(c => c.name.toLowerCase() === want) || allCompetitions.find(c => c.name.toLowerCase().includes(want));
      if (!want) throw new Error(`Pick ${config().name}'s PlayHQ competition on the competition setup page (${linkBase}/setup.html).`);
      if (!comp) throw new Error(`No competition called "${config().competitionName}" found. PlayHQ lists: ${allCompetitions.map(c => c.name).join(', ') || 'none'}`);
      const season = pickSeason(comp.seasons || []);
      if (!season) throw new Error(`"${comp.name}" has no seasons on PlayHQ yet.`);
      seasonId = season.id;
      compName = comp.name;
      if (comp.organisation && comp.organisation.name) orgName = config().organisationName || comp.organisation.name;
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
      organisation: config().organisationName || (s.competition && s.competition.organisation && s.competition.organisation.name) || orgName,
      competition: config().displayName || config().competitionName || compName || (s.competition && s.competition.name),
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
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
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
  const GAME_CACHE_FILE = datadir.local('game-cache.json');
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
      savefile.writeFile(GAME_CACHE_FILE, JSON.stringify({ genderField: GENDER_FIELDS[genderField], games }), err => {
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
    return start === null ? null : start - leadMs();
  }
  // Why the live feed isn't asked yet ('' once the window is open, or when the start time isn't known).
  function scoringNotYet(game) {
    const at = scoringOpensAt(game);
    if (at === null || at <= Date.now()) return '';
    const when = new Date(at);
    const day = localDate(when) === localDate() ? '' : ` on ${when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    return `Electronic scoring starts ${leadMs() / 60000} minutes before the game, so PlayHQ is checked from ${when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}${day}.`;
  }
  const notScoredLogged = new Set(); // games already logged as not being scored yet
  const liveCache = new Map();
  const liveInFlight = new Map();
  // The last answer from PlayHQ's live feed, for /api/health: when, and the error if it failed.
  const lastLive = { at: 0, error: '', errorAt: 0 };
  async function getLive(gameId, maxAgeMs) {
    const hit = liveCache.get(gameId);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.live;
    const wait = scoringNotYet(gameId);
    if (wait) throw Object.assign(new Error(wait), { notYet: true });
    if (!liveInFlight.has(gameId)) {
      liveInFlight.set(gameId, fetchLive(gameId)
        .then(live => { liveCache.set(gameId, { at: Date.now(), live }); lastLive.at = Date.now(); lastLive.error = ''; return live; })
        .catch(err => { if (!err.notScored) { lastLive.error = err.message; lastLive.errorAt = Date.now(); } throw err; })
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


  // The competition in use changed: its PlayHQ organisation, and forget what was cached.
  function setOrganisation(url) {
    const u = parsePlayhqUrl(url) || {};
    TENANT = u.tenant || 'netball-australia';
    ORG_ID = u.orgId || null;
    structure = null; // names may have changed
    return { tenant: TENANT, orgId: ORG_ID };
  }
  function resetCaches() {
    for (const cache of [ladderCache, roundGamesCache, gameCache, liveCache, roundsCache]) cache.clear();
    tenantLabel = ''; cookie = null;
  }

  return {
    setOrganisation, resetCaches,
    organisation: () => ({ tenant: TENANT, orgId: ORG_ID }),
    structureNow: () => structure,
    gql, getStructure, getLadder, findGrade, pickSeason, Q_COMPETITIONS,
    getRounds, getRoundGames, getGame, readGame, eachLimited, PLAYHQ_AT_ONCE, lineup, POSITION_RANK,
    getLive, liveScore, scoringNotYet, PERIOD_NUMBER, lastLive,
  };
}

module.exports = { create, parsePlayhqUrl, isFinished, startOf, localDate };
