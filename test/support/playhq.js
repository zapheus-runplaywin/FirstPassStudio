// A stand-in for PlayHQ for the tests: the answers playhq.com's GraphQL API and its live
// scoring feed (spectator.playhq.com) give, shaped as server.js asks for them, for a small
// Thunder League season. PlayHQ can't be reached from where the tests run, and real games
// move on, so the season is made up around the time the tests run:
//   Rounds 1 and 2 were played 14 and 7 days ago (finished, with line ups and shooting).
//   Round 3 is today: in each division one game started 30 minutes ago (being scored) and
//   one starts in 90 minutes. Round 4 is next week.
// Studio runs in a time zone where it is about midday (see localZone), so "today" never
// crosses midnight while a test runs.
//
// world.live[gameId] is the live feed for a game being scored (score, goals, clock); tests
// change it to play a game. world.calls lists every request, to check what Studio asked for.
// world.fail[operationName] (or .live) answers that request with an HTTP error status instead, and
// world.answers[operationName] (or .live) answers it with whatever the function gives:
//   world.answers.gradeLadder = ({ query }) => /byes/.test(query) && { status: 400, body: { errors: [...] } };
// (a falsy result answers as usual).

'use strict';

const http = require('node:http');

// A fixed-offset time zone where it's about 12:00 now, and that zone's offset in hours.
function localZone(now = Date.now()) {
  const offset = Math.max(-11, Math.min(12, 12 - new Date(now).getUTCHours()));
  return { tz: offset === 0 ? 'Etc/UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`, offset };
}

const ORG_ID = 'a9434809';
const ORG_URL = `https://www.playhq.com/netball-australia/org/west-coast-mens-and-mixed-netball-association/${ORG_ID}`;
const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const DIVISIONS = [
  { id: 'grade-div1', name: 'Division 1', gender: 'MIXED', teams: ['Blizzardz', 'Knights', 'Mavericks', "Travis' Disciples"] },
  { id: 'grade-div2', name: 'Division 2', gender: 'MALE', teams: ['Stormz', 'Titans', 'Tsunamiz', 'Semi Pro'] },
];
// Who plays who each round (indexes into the division's teams): two games a round, every team plays.
const DRAW = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]], [[1, 0], [3, 2]]];
const ROUND_DAYS = [-14, -7, 0, 7];

function createWorld({ now = Date.now() } = {}) {
  const { offset } = localZone(now);
  const local = ms => new Date(ms + offset * 3600000).toISOString(); // wall clock where Studio runs
  const dateAt = ms => local(ms).slice(0, 10);
  const timeAt = ms => local(ms).slice(11, 16) + ':00';
  const today = dateAt(now);
  const dayOf = days => dateAt(now + days * 86400000);

  const world = { now, today, orgId: ORG_ID, orgUrl: ORG_URL, divisions: DIVISIONS, calls: [], live: {}, games: {}, rounds: {}, fail: {}, answers: {} };

  for (const [d, div] of DIVISIONS.entries()) {
    const rounds = [];
    for (const [r, days] of ROUND_DAYS.entries()) {
      const round = { id: `${div.id}-r${r + 1}`, name: `Round ${r + 1}`, number: r + 1, current: days === 0, gradeId: div.id, games: [] };
      for (const [i, [h, a]] of DRAW[r].entries()) {
        const id = `game-d${d + 1}-r${r + 1}-${i + 1}`;
        // Today: the court 1 and 2 games started 30 minutes ago, the next ones start in 90.
        const start = days === 0 ? now + (d === 0 ? -30 : 90) * 60000 : now + days * 86400000 + (i * 60 - 60) * 60000;
        const finished = days < 0;
        const game = {
          id, roundId: round.id, gradeId: div.id, division: div.name,
          date: days === 0 ? today : dayOf(days), time: timeAt(start), court: `Court ${i + 1}`,
          status: finished ? 'FINAL' : days === 0 && d === 0 ? 'IN_PROGRESS' : 'UPCOMING',
          home: div.teams[h], away: div.teams[a],
          // Finished scores: the first-named team of each pairing wins, 30 + its slot.
          score: finished ? { home: 30 + h + r, away: 24 + a } : null,
        };
        round.games.push(game);
        world.games[id] = game;
      }
      rounds.push(round);
      world.rounds[round.id] = round;
    }
    div.rounds = rounds;
  }
  // The games being scored now start at 0-0 with the clock running in the first quarter.
  for (const g of Object.values(world.games)) {
    if (g.status === 'IN_PROGRESS') world.live[g.id] = { home: 0, away: 0, homeGoals: 0, awayGoals: 0, homeSuper: 0, awaySuper: 0,
      period: 'FIRST_QTR', clock: { status: 'RESUME', time: '07:30', lastUpdatedAt: String(now) }, break: null };
  }
  world.gameNow = d => DIVISIONS[d].rounds[2].games[0]; // division d's game being scored today, court 1
  return world;
}

// ─── Answers ────────────────────────────────────────────────────────────────
const teamRef = name => ({ __typename: 'DiscoverTeam', id: `team-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name });
const stat = (type, count) => ({ type: { value: type }, count });

// Each team's line up: seven players, the shooters (GS, GA) scoring all the goals.
function players(team, goals, superGoals) {
  return POSITIONS.map((pos, i) => {
    const shooter = i < 2;
    const g = shooter ? (i === 0 ? Math.ceil(goals / 2) : Math.floor(goals / 2)) : 0;
    const sg = shooter && i === 0 ? superGoals : 0;
    return {
      playerNumber: String(i + 1),
      player: { __typename: 'DiscoverParticipant', id: `${team}-${pos}`, profile: { firstName: team.split(/\W/)[0], lastName: pos, gender: 'MALE' } },
      statistics: shooter ? [stat('1_POINT_SCORE', g), stat('2_POINT_SCORE', sg), stat('GOAL_ATTEMPT', g + sg + 3)] : [],
      playerPosition: { shortName: pos },
      captain: i === 2 ? { name: 'Captain', shortName: 'C' } : null,
    };
  });
}

function discoverGame(world, id) {
  const g = world.games[id];
  if (!g) return null;
  const live = world.live[id];
  const score = g.score || (live ? { home: live.home, away: live.away } : null);
  const side = k => {
    if (!score) return null;
    const total = score[k];
    const superGoals = live ? live[`${k}Super`] : 1;
    return { players: players(g[k], total - 2 * superGoals, superGoals), statistics: [stat('TOTAL_SCORE', total)] };
  };
  return {
    id, date: g.date, status: { value: g.status },
    home: teamRef(g.home), away: teamRef(g.away),
    result: g.score ? { home: { score: g.score.home, statistics: [] }, away: { score: g.score.away, statistics: [] } } : null,
    statistics: score ? { home: side('home'), away: side('away') } : null,
  };
}

function fixtureGame(g) {
  const side = k => g.score ? { outcome: { value: g.score[k] > g.score[k === 'home' ? 'away' : 'home'] ? 'WON' : 'LOST' }, statistics: [stat('TOTAL_SCORE', g.score[k])] }
    : { outcome: null, statistics: [] };
  return {
    id: g.id, date: g.date, dates: [g.date], status: { value: g.status },
    home: teamRef(g.home), away: teamRef(g.away),
    result: { home: side('home'), away: side('away') },
    allocation: { time: g.time, court: { name: g.court, venue: { name: 'Gold Netball Centre' } } },
  };
}

function ladder(world, div) {
  const rows = new Map(div.teams.map(t => [t, { team: t, played: 0, won: 0, lost: 0, drawn: 0, byes: 0, forfeits: 0, pointsFor: 0, pointsAgainst: 0, competitionPoints: 0 }]));
  for (const g of Object.values(world.games).filter(x => x.gradeId === div.id && x.score)) {
    for (const [k, o] of [['home', 'away'], ['away', 'home']]) {
      const r = rows.get(g[k]);
      r.played++; r.pointsFor += g.score[k]; r.pointsAgainst += g.score[o];
      if (g.score[k] > g.score[o]) { r.won++; r.competitionPoints += 4; } else r.lost++;
    }
  }
  const standings = [...rows.values()].map(r => ({ ...r, team: teamRef(r.team), percentage: r.pointsAgainst ? Math.round(r.pointsFor / r.pointsAgainst * 10000) / 100 : 0 }))
    .sort((a, b) => b.competitionPoints - a.competitionPoints || b.percentage - a.percentage);
  return { id: div.id, name: div.name, ladder: [{ standings }] };
}

// One GraphQL answer for api.playhq.com.
function answer(world, operationName, variables, query = '') {
  switch (operationName) {
    case 'ProfileSearch': return { data: { profileSearch: { result: [] } } };
    case 'TenantConfig': case 'tenantLabel': return { data: { tenantConfiguration: { label: 'na' } } };
    case 'discoverCompetitions':
      if (variables.organisationID !== world.orgId) return { data: { discoverCompetitions: [] } };
      return { data: { discoverCompetitions: [
        { id: 'comp-tl', name: 'Thunder League', organisation: { id: world.orgId, name: 'West Coast Mens and Mixed Netball Association' },
          seasons: [
            { id: 'season-old', name: 'Autumn 2026', startDate: '2026-02-01', endDate: '2026-05-30', status: { name: 'Completed', value: 'COMPLETED' } },
            { id: 'season-now', name: 'Spring 2026', startDate: '2026-08-01', endDate: '2026-12-20', status: { name: 'Active', value: 'ACTIVE' } },
          ] },
        { id: 'comp-social', name: 'Summer Social', organisation: { id: world.orgId, name: 'West Coast Mens and Mixed Netball Association' }, seasons: [] },
      ] } };
    case 'gradeListDiscoverSeason':
      return { data: { discoverSeason: { id: variables.id, name: 'Spring 2026',
        competition: { id: 'comp-tl', name: 'Thunder League', organisation: { id: world.orgId, name: 'West Coast Mens and Mixed Netball Association' } },
        grades: world.divisions.map(d => ({ id: d.id, name: d.name, ...(/\bgender\b/.test(query) && { gender: { value: d.gender } }) })) } } };
    case 'gradeLadder': {
      const div = world.divisions.find(d => d.id === variables.gradeID);
      if (!div) return { data: { discoverGrade: null } };
      // Only the columns asked for, as PlayHQ answers.
      const l = ladder(world, div);
      const asked = k => k === 'team' || new RegExp(`\\b${k}\\b`).test(query);
      l.ladder = l.ladder.map(p => ({ standings: p.standings.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => asked(k)))) }));
      return { data: { discoverGrade: l } };
    }
    case 'gradeRounds': {
      const div = world.divisions.find(d => d.id === variables.gradeID);
      return { data: { discoverGrade: div ? { id: div.id, name: div.name, rounds: div.rounds.map(({ id, name, current, number }) => ({ id, name, current, number })) } : null } };
    }
    case 'discoverFixtureByRound': {
      const round = world.rounds[variables.roundID];
      return { data: { discoverFixtureByRound: round ? { games: round.games.map(fixtureGame) } : null } };
    }
    case 'discoverGame': return { data: { discoverGame: discoverGame(world, variables.gameID) } };
    default: return { errors: [{ message: `The test PlayHQ doesn't know ${operationName}` }] };
  }
}

// The live scoring feed (spectator.playhq.com) for one game.
function liveAnswer(world, id) {
  const g = world.games[id], l = world.live[id];
  if (!g || (!l && !g.score)) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  const s = l || { home: g.score.home, away: g.score.away, homeGoals: g.score.home - 2, awayGoals: g.score.away - 2, homeSuper: 1, awaySuper: 1, period: 'FOURTH_QTR', clock: null };
  const side = k => ({ statisticsV2: [stat('TOTAL_SCORE', s[k]), stat('1_POINT_SCORE', s[`${k}Goals`]), stat('2_POINT_SCORE', s[`${k}Super`])] });
  return { data: { game: {
    id, status: g.status, updatedAt: null, break: s.break || null,
    statistics: { home: side('home'), away: side('away') },
    result: { home: { statistics: [stat('TOTAL_SCORE', s.home)] }, away: { statistics: [stat('TOTAL_SCORE', s.away)] }, currentPeriod: { value: s.period } },
    clock: s.clock ? { period: s.period, periodValue: s.period, ...s.clock } : null,
  } } };
}

// Starts the stand-in on a free port. Gives { world, url, spectatorUrl, close }.
async function startPlayhq(world = createWorld()) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* answered below */ }
      const spectator = req.url.startsWith('/spectator');
      const { operationName = '', variables = {} } = parsed;
      world.calls.push({ spectator, operationName, variables, tenant: req.headers.tenant || req.headers['x-phq-tenant'] || '', cookie: req.headers.cookie || '', query: parsed.query || '' });
      const failing = world.fail[spectator ? 'live' : operationName];
      if (failing) { res.writeHead(failing, { 'content-type': 'text/plain' }); return res.end('Request blocked'); }
      const custom = (world.answers || {})[spectator ? 'live' : operationName];
      const own = custom && custom({ variables, query: parsed.query || '', calls: world.calls });
      if (own) { res.writeHead(own.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(own.body)); }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'phq_session=test; Path=/' });
      res.end(JSON.stringify(spectator ? liveAnswer(world, variables.id) : answer(world, operationName, variables, parsed.query)));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { world, url: `http://127.0.0.1:${port}/graphql`, spectatorUrl: `http://127.0.0.1:${port}/spectator`,
    close: () => new Promise(r => server.close(r)) };
}

module.exports = { createWorld, startPlayhq, localZone, POSITIONS };
