// FirstPass Studio - teams: the team sheets (teamlist.html, matchups.html, the commentator stats) and each
// player's shooting stats, from PlayHQ's game page line ups with the live feed's team totals, or, with a
// PlayHQ Client ID, its REST "Summary for the Game"; the team list warm up when a game is picked; and
// which way round PlayHQ's teams and line ups sit against the scoreboard.
//
// create(deps) gives the team sheets for the competition in use. deps:
//   log(level, source, message)   the debug log
//   config()                      the competition setup in use (CONFIG in server.js: apiKey, apiBaseUrl, gameSummaryPath, apiTenant)
//   playhq                        the PlayHQ client (getGame, getLive, organisation)
//   datadir                       datadir.js (last-game-summary.json in the local folder)
//   board()                       the scoreboard in use
//   getUpNext()                   the next game on the court (games.js), for the warm up
//   squadFor(team, division), withSquad(side, division), logoFor(team)   from athletes.js
//   competitionName(), rules(division)   from games.js
//   defaultRefreshSec()           how often PlayHQ is checked unless the control says otherwise (board.js)
//   sameTeam(a, b)                name matching, as server.js does it
const fs = require('fs');

function create({ log, config, playhq, datadir, board, getUpNext, squadFor, withSquad, logoFor, competitionName, rules, defaultRefreshSec, sameTeam }) {
  const { getGame, getLive } = playhq;

  // ─── Game Summary v2 (team lists and shooting stats) ────────────────────────
  // PlayHQ's REST "Summary for the Game v2". Settings in config.json:
  //   apiBaseUrl       default https://api.playhq.com
  //   gameSummaryPath  default /v2/games/{id}/summary
  //   apiKey           sent as x-api-key if set (PlayHQ normally issues one per association)
  //   apiTenant        sent as x-phq-tenant, default the tenant from organisationUrl
  // The last answer is saved to last-game-summary.json, so its layout can be checked.
  const SUMMARY_BASE = (config().apiBaseUrl || 'https://api.playhq.com').replace(/\/$/, '');
  const SUMMARY_PATH = config().gameSummaryPath || '/v2/games/{id}/summary';

  async function fetchGameSummary(gameId) {
    // Public "Summary for the Game": x-api-key (PlayHQ's Client ID) + x-phq-tenant, no login token.
    // If the configured version isn't there, try the other one (v2 <-> v1).
    const headers = { accept: 'application/json', 'x-phq-tenant': config().apiTenant || playhq.organisation().tenant };
    if (config().apiKey) headers['x-api-key'] = config().apiKey;
    const other = /\/v2\//.test(SUMMARY_PATH) ? SUMMARY_PATH.replace('/v2/', '/v1/') : SUMMARY_PATH.replace('/v1/', '/v2/');
    let url, res;
    for (const p of [...new Set([SUMMARY_PATH, other])]) {
      url = SUMMARY_BASE + p.replace('{id}', encodeURIComponent(gameId));
      res = await fetch(url, { headers });
      log(res.ok ? 'info' : 'warn', 'summary', `Game Summary HTTP ${res.status} ${url}${config().apiKey ? ' (with apiKey)' : ' (no apiKey)'}`);
      if (res.status !== 404) break;
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(`PlayHQ refused the Game Summary (HTTP ${res.status}).` +
        (config().apiKey ? ' Check the PlayHQ Client ID on the competition setup page.'
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
    const maxAge = (b.playhqRefreshSec || defaultRefreshSec()) * 1000;
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
      if (g.home.players.length || g.away.players.length || !config().apiKey) {
        const error = g.home.players.length || g.away.players.length ? undefined : 'PlayHQ has no line-ups for this game yet.';
        if (live) { g.home.totals = live.home; g.away.totals = live.away; }
        return { ...meta, home: g.home, away: g.away, error, updatedAt: new Date().toISOString() };
      }
    } catch (err) {
      gqlError = err.message;
      log('warn', 'teams', `Game detail failed: ${err.message}`);
      if (!config().apiKey) return { ...meta, ...base, error: err.message };
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

  return { positionOf, POSITION_ORDER, warmTeamLists, getTeamSheets, scoringState, orientToBoard, parseSummary, resetCaches: () => summaryCache.clear() };
}

module.exports = { create };
