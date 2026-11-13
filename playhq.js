// FirstPass Studio - the PlayHQ client: everything that talks to PlayHQ, and nothing else.
//
// PlayHQ's public data (what www.playhq.com shows) comes from https://api.playhq.com/graphql. It
// needs no API key, but only answers requests that look like they come from playhq.com and carry
// a guest session cookie. The asking and the reading are FirstPass's shared PlayHQ package,
// @firstpass/playhq (built in the FirstPassVisionVantage repo, packages/playhq, and installed from
// GitHub Packages): the guest session, the GraphQL queries, the live scoring feed from
// spectator.playhq.com, and the parsers that turn the answers into games, line ups and ladders.
// Vantage and HQ use the same package, so a change in how PlayHQ answers is fixed once.
//
// What stays here is Studio's own: how long each answer is kept and the last good one shown while
// PlayHQ fails, finished games' line ups kept in game-cache.json in the local data folder (so a
// restart doesn't ask for the whole season again), the competition from the setup page, the
// electronic scoring window, the live feed's health for the status board, the PlayHQ traffic
// counter (playhqnet.js), the debug log, the game recording (recorder.js) and practice games
// (practice.js), which answer instead of PlayHQ while one runs.
//
// create(deps) gives one client for the competition in use. deps:
//   log(level, source, message, extra)   the debug log
//   apiUrl, cacheMs, linkBase            from config.json (the link is only for error messages)
//   config()                             the competition settings in use (CONFIG in server.js)
//   leadMs()                             how long before a game electronic scoring opens (autoSelectMinutesBefore)
//   logoFor(teamName), positionOf(player) the competition's team logo and the netball position code
//   record, practice                     recorder.js and practice.js (optional)
// setOrganisation(url) points it at a PlayHQ organisation (tenant and id from the link); resetCaches()
// forgets everything cached when the competition changes. The pure helpers (parsePlayhqUrl,
// isFinished, startOf, localDate) are exported on their own as well.

'use strict';

const fs = require('fs');
const {
  createTransport, createPlayhqApi, createKeeper, parseCompetitions, parseOrganisationLink, pickSeason: pickSeasonOf,
  isFinished, saysFinished, startOf, localDate, POSITION_RANK, PERIOD_NUMBER, Q_COMPETITIONS,
} = require('@firstpass/playhq');
const datadir = require('./datadir');
const savefile = require('./savefile');
const net = require('./playhqnet');

function create(deps) {
  const { log, apiUrl, cacheMs, linkBase, config, leadMs, logoFor, positionOf } = deps;
  // recorder.js, for the game recording: every answer PlayHQ gives (record.playhq, record.live).
  const record = deps.record || { playhq() {}, live() {} };
  // practice.js: while a practice game runs, its recording answers instead of PlayHQ (practice.answer, practice.live);
  // a demo game's recording leaves what it doesn't have (the client's competition) to PlayHQ.
  const practice = deps.practice || { active: () => false };

  let ORG_ID = null;

  // Finished games' line ups don't change, so they are kept in game-cache.json in the data folder, with the
  // player gender field PlayHQ accepted: after a restart the team lists' squads, top shooters and the athletes
  // page don't ask PlayHQ for the whole season again. A game id is PlayHQ's own, so the file serves every competition.
  const GAME_CACHE_FILE = datadir.local('game-cache.json');
  const GAME_CACHE_MAX = 3000, GAME_CACHE_DAYS = 120;
  // Bumped when what is kept for a game changes (2: each team's own counts, totals), so older copies are read again once.
  const GAME_CACHE_VERSION = 2;
  const finishedSummaries = new Map(); // game id -> parsed game
  const finishedAt = new Map();        // game id -> when it was kept
  let savedGenderField;
  try {
    const saved = JSON.parse(fs.readFileSync(GAME_CACHE_FILE, 'utf8'));
    if (typeof saved.genderField === 'string') savedGenderField = saved.genderField;
    const oldest = Date.now() - GAME_CACHE_DAYS * 24 * 60 * 60 * 1000;
    for (const [id, e] of Object.entries(saved.version === GAME_CACHE_VERSION ? saved.games || {} : {})) {
      if (e && e.game && e.at > oldest) { finishedSummaries.set(id, e.game); finishedAt.set(id, e.at); }
    }
    log('info', 'playhq', `${finishedSummaries.size} finished games' line ups loaded from game-cache.json`);
  } catch (err) { if (err.code !== 'ENOENT') log('warn', 'playhq', `game-cache.json not read: ${err.message}`); }

  // ─── Asking PlayHQ (@firstpass/playhq) ──────────────────────────────────────
  // Every request is counted for the status board's PlayHQ line and written to the debug log.
  function noteRequest(r) {
    const source = r.kind === 'live' ? 'live' : 'playhq';
    if (r.error && r.error.unreachable) {
      net.failed();
      if (r.kind === 'session') log('error', 'playhq', `Guest session: ${r.error.message}`);
      else if (r.kind === 'api') log('error', 'playhq', `${r.operationName}: ${r.error.message}`, r.variables);
      return;
    }
    // The guest session's answer isn't read, so it counts only what PlayHQ says it sent.
    net.note({ ms: r.ms, bytes: net.answerBytes(r.response, r.kind === 'session' ? '' : r.text), ...(r.kind === 'live' ? { live: true } : {}) });
    if (r.kind === 'session') return;
    const ok = r.status >= 200 && r.status < 300;
    const what = r.kind === 'live' ? `game ${r.variables.id}` : r.operationName;
    log(ok ? 'info' : 'warn', source, `${what} HTTP ${r.status} ${r.ms}ms ${r.length}B`, r.kind === 'live' ? undefined : r.variables);
    if (!ok) log('warn', source, r.kind === 'live' ? 'answer' : `${r.operationName} answer`, String(r.text || '').slice(0, 500));
    else if (r.kind === 'api' && String(r.text || '').includes('"errors"')) {
      try {
        const errors = JSON.parse(r.text).errors;
        if (errors && errors.length) log('error', 'playhq', `${r.operationName} GraphQL errors`, errors);
      } catch { /* not JSON: the package says so */ }
    }
  }

  const transport = createTransport({
    fetch: (url, init) => fetch(url, init),
    apiUrl,
    spectatorUrl: process.env.PLAYHQ_SPECTATOR_URL || undefined,
    unreachableHint: 'Is this Mac connected to the internet?',
    onRequest: noteRequest,
    onAnswer: a => (a.kind === 'live' ? record.live(a.variables.id, a.data) : record.playhq(a.operationName, a.variables, a.tenant, a.data)),
    answer: (op, vars) => {
      if (!practice.active()) return undefined;
      return op === 'live' ? practice.live(vars.id) : practice.answer(op, vars); // undefined: a demo game asks PlayHQ
    },
  });
  const api = createPlayhqApi(transport, {
    positionOf: p => positionOf(p), // GS..GK; full names and odd spellings tidied, '' when PlayHQ has none
    learned: savedGenderField === undefined ? undefined : { genderField: savedGenderField },
    // What PlayHQ refused (a ladder column, a spelling of a player's gender): said in the log, and the gender
    // spelling kept in game-cache.json so a restart doesn't ask the refused ones again.
    onLearn: (learned, why) => { log('info', 'playhq', why); saveGameCache(); },
  });

  // ─── Finding the competition, season and divisions ──────────────────────────
  const pickSeason = seasons => pickSeasonOf(seasons, config().seasonName);

  // An organisation's competitions and their seasons, for the setup page (tenant: the sport in its link).
  async function competitions(orgId, tenant) {
    const data = await transport.gql('discoverCompetitions', Q_COMPETITIONS, { organisationID: orgId }, { tenant });
    return parseCompetitions(data.discoverCompetitions);
  }

  let structure = null, structureAt = 0;
  // The season's divisions (kept for 30 minutes). If PlayHQ fails when they're due to be read again, the last ones
  // read are kept (and read again on the next ask), so every graphic doesn't fail with it.
  async function getStructure() {
    if (structure && Date.now() - structureAt < 30 * 60 * 1000) return structure;
    if (!structure) return readStructure();
    const kept = structure;
    try { return await readStructure(); }
    catch (err) {
      log('warn', 'playhq', `Keeping the divisions read ${Math.round((Date.now() - structureAt) / 60000)} minutes ago: ${err.message}`);
      return kept;
    }
  }
  async function readStructure() {
    let seasonId = config().seasonId || null;
    let orgName = config().organisationName, compName = config().competitionName, allCompetitions = [];
    if (!seasonId) {
      if (!ORG_ID) throw new Error(`Add the organisation's PlayHQ link for ${config().name} on the competition setup page (${linkBase}/setup.html).`);
      allCompetitions = await api.competitions(ORG_ID);
      const want = (config().competitionName || '').toLowerCase();
      const comp = allCompetitions.find(c => c.name.toLowerCase() === want) || allCompetitions.find(c => c.name.toLowerCase().includes(want));
      if (!want) throw new Error(`Pick ${config().name}'s PlayHQ competition on the competition setup page (${linkBase}/setup.html).`);
      if (!comp) throw new Error(`No competition called "${config().competitionName}" found. PlayHQ lists: ${allCompetitions.map(c => c.name).join(', ') || 'none'}`);
      const season = pickSeason(comp.seasons);
      if (!season) throw new Error(`"${comp.name}" has no seasons on PlayHQ yet.`);
      seasonId = season.id;
      compName = comp.name;
      if (comp.organisation && comp.organisation.name) orgName = config().organisationName || comp.organisation.name;
    }
    const s = await api.season(seasonId); // the divisions in name order, each with its gender ('female', 'male' or '')
    structure = {
      organisation: config().organisationName || (s.organisation && s.organisation.name) || orgName,
      competition: config().displayName || config().competitionName || compName || (s.competition && s.competition.name),
      season: s.season,
      grades: s.grades,
      otherCompetitions: allCompetitions.map(c => c.name),
    };
    structureAt = Date.now();
    return structure;
  }

  // A division's ladder (kept cacheMs; the last good one, marked stale, while PlayHQ fails). A column PlayHQ doesn't
  // have for the sport is left out, and the page leaves it out too.
  const ladders = createKeeper();
  async function getLadder(gradeId) {
    const kept = await ladders.get(gradeId, cacheMs, async () => {
      const l = await api.ladder(gradeId);
      return { grade: l.grade, pools: l.pools, updatedAt: new Date().toISOString() };
    });
    return kept.stale ? { ...kept.value, stale: true, error: kept.stale.message } : kept.value; // keep showing the last good ladder
  }

  function findGrade(st, q) {
    if (q.gradeId) return { id: q.gradeId, name: q.gradeId };
    if (q.division && /^\d+$/.test(q.division)) return st.grades[Number(q.division) - 1];
    if (q.division) return st.grades.find(g => g.name.toLowerCase().includes(q.division.toLowerCase()));
    return st.grades[0];
  }

  // ─── Games (for the scoreboard) ─────────────────────────────────────────────
  // A round's games, read again once older than maxAgeMs. If PlayHQ fails then, the last ones read are given, with
  // .stale saying why (the fixtures, countdown, up next and the game list keep showing), and PlayHQ is asked again
  // next time.
  const roundGames = createKeeper();
  async function getRoundGames(roundId, maxAgeMs) {
    const kept = await roundGames.get(roundId, maxAgeMs, async () => {
      const games = await api.roundGames(roundId);
      for (const g of games) noteStart(g);
      return games;
    });
    if (!kept.stale) return kept.value;
    log('warn', 'playhq', `Keeping round ${roundId}'s games as last read: ${kept.stale.message}`);
    return Object.assign([...kept.value], { stale: kept.stale.message }); // .stale: why they aren't fresh
  }

  // ─── One game in detail (live score, line-ups, player stats) ────────────────
  // The same request the playhq.com game page makes. Unlike the round fixture, it has the score while the game is
  // being scored. Each side gets the competition's logo for its team.
  const gameCache = new Map();
  const gameInFlight = new Map();
  const withLogos = g => ({ ...g, home: { ...g.home, logo: logoFor(g.home.name) }, away: { ...g.away, logo: logoFor(g.away.name) } });

  let gameCacheTimer = null;
  function saveGameCache() {
    if (gameCacheTimer) return;
    gameCacheTimer = setTimeout(() => {
      gameCacheTimer = null;
      const games = Object.fromEntries([...finishedSummaries].map(([id, game]) => [id, { at: finishedAt.get(id) || Date.now(), game }]));
      savefile.writeFile(GAME_CACHE_FILE, JSON.stringify({ version: GAME_CACHE_VERSION, genderField: api.learned().genderField, games }), err => {
        if (err) log('warn', 'playhq', `game-cache.json not saved: ${err.message}`);
      });
    }, 2000);
  }
  function keepFinished(gameId, parsed) {
    if (practice.active()) return; // a practice game's answers aren't kept
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
    let parsed = await getGame(g.id, maxAgeMs);
    if (!isFinished(g)) return parsed;
    // A copy read while the game was still on (the scoreboard and ticker read it as it's played) is short of the last
    // goals, so a finished game is read again until PlayHQ's own game page says it's finished, and only kept then.
    if (!saysFinished(parsed.status)) parsed = await getGame(g.id, 60 * 1000);
    if (!saysFinished(parsed.status)) return parsed;
    // No team counts on the game page: the live feed's (asked directly, so an old game doesn't touch the PlayHQ status).
    if (!parsed.home.totals || !parsed.away.totals) {
      try {
        const l = await fetchLive(g.id);
        const totals = k => (l[k].goals == null && l[k].superGoals == null ? null : { goals: l[k].goals || 0, superGoals: l[k].superGoals || 0, shots: l[k].shots });
        parsed = { ...parsed, home: { ...parsed.home, totals: parsed.home.totals || totals('home') }, away: { ...parsed.away, totals: parsed.away.totals || totals('away') } };
      } catch (err) { log('info', 'playhq', `No team counts for game ${g.id} from the live feed: ${err.message}`); }
    }
    // A finished game with no line up at all may still get one entered, so it isn't kept.
    if (parsed.home.players.length || parsed.away.players.length) keepFinished(g.id, parsed);
    return parsed;
  }
  async function getGame(gameId, maxAgeMs) {
    const hit = gameCache.get(gameId);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.game;
    if (!gameInFlight.has(gameId)) {
      gameInFlight.set(gameId, api.game(gameId)
        .then(g => { const game = withLogos(g); gameCache.set(gameId, { at: Date.now(), game }); return game; })
        .finally(() => gameInFlight.delete(gameId)));
    }
    return gameInFlight.get(gameId);
  }

  // ─── Live scoring feed ──────────────────────────────────────────────────────
  // playhq.com's game page reads the running score and the scorer's game clock from spectator.playhq.com while a
  // game is on. Before the scorer starts it says the game isn't being scored (err.notScored), which is expected,
  // so it is logged once per game.
  async function fetchLive(gameId) {
    try { return await api.live(gameId); }
    catch (err) {
      if (err.notScored) {
        if (!notScoredLogged.has(gameId)) { notScoredLogged.add(gameId); log('info', 'live', `game ${gameId} isn't being scored in PlayHQ yet (${err.graphql.map(e => e.message).join('; ')}); still checking`); }
      } else if (err.graphql) log('error', 'live', 'GraphQL errors', err.graphql);
      throw err;
    }
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
  // Per game, what its live feed last said, for spotting a scorebench that has dropped off line (board.js
  // playhqTrouble): okAt the last reading, notScoredAt the last "not electronically scored", changedAt when a
  // reading last differed from the one before (the score, the counts, the clock or the break).
  const liveSeen = new Map();
  const seenOf = id => liveSeen.get(id) || liveSeen.set(id, { okAt: 0, notScoredAt: 0, changedAt: 0, sig: '' }).get(id);
  function noteLive(id, live) {
    const s = seenOf(id), now = Date.now(), sig = JSON.stringify(live);
    if (sig !== s.sig) { s.sig = sig; s.changedAt = now; }
    s.okAt = now;
    s.live = live;
  }
  const liveSeenFor = id => ({ ...seenOf(id) });
  async function getLive(gameId, maxAgeMs) {
    const hit = liveCache.get(gameId);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.live;
    const wait = scoringNotYet(gameId);
    if (wait) throw Object.assign(new Error(wait), { notYet: true });
    if (!liveInFlight.has(gameId)) {
      liveInFlight.set(gameId, fetchLive(gameId)
        .then(live => { liveCache.set(gameId, { at: Date.now(), live }); lastLive.at = Date.now(); lastLive.error = ''; noteLive(gameId, live); return live; })
        .catch(err => { if (err.notScored) seenOf(gameId).notScoredAt = Date.now(); else { lastLive.error = err.message; lastLive.errorAt = Date.now(); } throw err; })
        .finally(() => liveInFlight.delete(gameId)));
    }
    return liveInFlight.get(gameId);
  }

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

  // A division's rounds (kept for 5 minutes; the last ones read while PlayHQ is failing).
  const rounds = createKeeper();
  async function getRounds(gradeId) {
    const kept = await rounds.get(gradeId, 5 * 60 * 1000, () => api.rounds(gradeId));
    if (kept.stale) log('warn', 'playhq', `Keeping the rounds as last read: ${kept.stale.message}`); // and asked again next time
    return kept.value;
  }

  // The competition in use changed: its PlayHQ organisation, and forget what was cached.
  function setOrganisation(url) {
    const u = parseOrganisationLink(url) || {};
    transport.setTenant(u.tenant || 'netball-australia');
    ORG_ID = u.orgId || null;
    structure = null; // names may have changed
    return { tenant: transport.tenant(), orgId: ORG_ID };
  }
  function resetCaches() {
    for (const cache of [ladders, roundGames, rounds, gameCache, liveCache, gameStarts, liveSeen]) cache.clear();
    transport.reset();
  }

  return {
    setOrganisation, resetCaches,
    organisation: () => ({ tenant: transport.tenant(), orgId: ORG_ID }),
    structureNow: () => structure,
    competitions, getStructure, getLadder, findGrade, pickSeason,
    getRounds, getRoundGames, getGame, readGame, eachLimited, PLAYHQ_AT_ONCE, POSITION_RANK,
    getLive, liveScore, scoringNotYet, PERIOD_NUMBER, lastLive, liveSeenFor,
  };
}

module.exports = { create, parsePlayhqUrl: parseOrganisationLink, isFinished, startOf, localDate };
