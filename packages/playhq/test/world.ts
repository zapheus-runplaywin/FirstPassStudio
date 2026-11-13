// A stand-in for PlayHQ for these tests, ported from Studio's test/support/playhq.mts: the answers
// api.playhq.com and spectator.playhq.com give for a small Thunder League season, served through a
// fake fetch so every failure can be set up exactly. PlayHQ can't be reached from CI, and real games
// move on, so the season is made up around a fixed time:
//   Rounds 1 and 2 were played 14 and 7 days ago (finished, with line ups and shooting).
//   Round 3 is today: in Division 1 the first game started 30 minutes ago (being scored).
//   Round 4 is next week.
//
// world.calls lists every request. world.fail[operationName] (or .live) answers with that HTTP status;
// world.answers[operationName] (or .live) answers with whatever the function gives (falsy: as usual).

import type { FetchLike, ResponseLike } from '../src/transport';

export const NOW = Date.parse('2026-11-13T04:00:00Z');
export const ORG_ID = 'a9434809';
export const ORG_URL = `https://www.playhq.com/netball-australia/org/west-coast-mens-and-mixed-netball-association/${ORG_ID}`;
export const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const DIVISIONS = [
  { id: 'grade-div1', name: 'Division 1', gender: 'MIXED', teams: ['Blizzardz', 'Knights', 'Mavericks', "Travis' Disciples"] },
  { id: 'grade-div2', name: 'Division 2', gender: 'MALE', teams: ['Stormz', 'Titans', 'Tsunamiz', 'Semi Pro'] },
];
const DRAW = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]], [[1, 0], [3, 2]]] as const;
const ROUND_DAYS = [-14, -7, 0, 7];

type Game = {
  id: string; roundId: string; gradeId: string; date: string; time: string; court: string; status: string;
  home: string; away: string; score: { home: number; away: number } | null;
};
type Live = { home: number; away: number; homeGoals: number; awayGoals: number; homeSuper: number; awaySuper: number; period: string; clock: Record<string, string> | null; break: unknown };
type Call = { url: string; spectator: boolean; operationName: string; variables: Record<string, unknown>; headers: Record<string, string>; query: string };
type Custom = (req: { variables: Record<string, unknown>; query: string; calls: Call[] }) => { status?: number; body: unknown; headers?: Record<string, string> } | null | false | undefined;

export function createWorld(now = NOW) {
  const dateAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const timeAt = (ms: number) => new Date(ms).toISOString().slice(11, 16) + ':00';
  const world = {
    now, orgId: ORG_ID, orgUrl: ORG_URL,
    calls: [] as Call[],
    games: {} as Record<string, Game>,
    rounds: {} as Record<string, { id: string; name: string; number: number; current: boolean; games: Game[] }>,
    divisions: DIVISIONS.map((d) => ({ ...d, rounds: [] as { id: string; name: string; number: number; current: boolean; games: Game[] }[] })),
    live: {} as Record<string, Live>,
    fail: {} as Record<string, number>,
    answers: {} as Record<string, Custom>,
    /** Thrown by fetch, as when PlayHQ can't be reached. */
    unreachable: null as Error | null,
    /** Set-Cookie on every answer, '' for none. */
    setCookie: 'phq_session=test; Path=/',
  };
  for (const [d, div] of world.divisions.entries()) {
    for (const [r, days] of ROUND_DAYS.entries()) {
      const round = { id: `${div.id}-r${r + 1}`, name: `Round ${r + 1}`, number: r + 1, current: days === 0, games: [] as Game[] };
      for (const [i, pair] of (DRAW[r] ?? []).entries()) {
        const [h, a] = pair;
        const id = `game-d${d + 1}-r${r + 1}-${i + 1}`;
        const start = days === 0 ? now + (d === 0 && i === 0 ? -30 : 90) * 60000 : now + days * 86400000 + (i * 60 - 60) * 60000;
        const finished = days < 0;
        const game: Game = {
          id, roundId: round.id, gradeId: div.id, date: dateAt(start), time: timeAt(start), court: `Court ${i + 1}`,
          status: finished ? 'FINAL' : days === 0 && d === 0 && i === 0 ? 'IN_PROGRESS' : 'UPCOMING',
          home: div.teams[h] ?? '', away: div.teams[a] ?? '',
          score: finished ? { home: 30 + h + r, away: 24 + a } : null,
        };
        round.games.push(game);
        world.games[id] = game;
      }
      div.rounds.push(round);
      world.rounds[round.id] = round;
    }
  }
  for (const g of Object.values(world.games)) {
    if (g.status === 'IN_PROGRESS') {
      world.live[g.id] = { home: 0, away: 0, homeGoals: 0, awayGoals: 0, homeSuper: 0, awaySuper: 0, period: 'FIRST_QTR', clock: { status: 'RESUME', time: '07:30', lastUpdatedAt: String(now) }, break: null };
    }
  }
  return world;
}
export type World = ReturnType<typeof createWorld>;

const teamRef = (name: string) => ({ __typename: 'DiscoverTeam', id: `team-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name });
const stat = (type: string, count: number) => ({ type: { value: type }, count });

/** Seven players, the shooters (GS, GA) scoring all the goals; WA is captain. */
function players(team: string, goals: number, superGoals: number) {
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
  }).reverse(); // PlayHQ's order isn't court order
}

function discoverGame(world: World, id: string) {
  const g = world.games[id];
  if (!g) return null;
  const live = world.live[id];
  const score = g.score ?? (live ? { home: live.home, away: live.away } : null);
  const side = (k: 'home' | 'away') => {
    if (!score) return null;
    const superGoals = live ? live[`${k}Super`] : 1;
    return { players: players(g[k], score[k] - 2 * superGoals, superGoals), statistics: [stat('TOTAL_SCORE', score[k])] };
  };
  return {
    id, date: g.date, status: { value: g.status },
    home: teamRef(g.home), away: teamRef(g.away),
    result: g.score ? { home: { score: g.score.home, statistics: [] }, away: { score: g.score.away, statistics: [] } } : null,
    statistics: score ? { home: side('home'), away: side('away') } : null,
  };
}

function fixtureGame(g: Game) {
  const side = (k: 'home' | 'away') => g.score
    ? { outcome: { value: g.score[k] > g.score[k === 'home' ? 'away' : 'home'] ? 'WON' : 'LOST' }, statistics: [stat('TOTAL_SCORE', g.score[k])] }
    : { outcome: null, statistics: [] };
  return {
    id: g.id, date: g.date, dates: [g.date], status: { value: g.status },
    home: teamRef(g.home), away: teamRef(g.away),
    result: { home: side('home'), away: side('away') },
    allocation: { time: g.time, court: { name: g.court, venue: { name: 'Gold Netball Centre' } } },
  };
}

function ladder(world: World, div: World['divisions'][number], query: string) {
  const rows = new Map(div.teams.map((t) => [t, { team: t, played: 0, won: 0, lost: 0, drawn: 0, byes: 0, forfeits: 0, pointsFor: 0, pointsAgainst: 0, competitionPoints: 0 }]));
  for (const g of Object.values(world.games).filter((x) => x.gradeId === div.id && x.score)) {
    for (const [k, o] of [['home', 'away'], ['away', 'home']] as const) {
      const r = rows.get(g[k])!;
      r.played++; r.pointsFor += g.score![k]; r.pointsAgainst += g.score![o];
      if (g.score![k] > g.score![o]) { r.won++; r.competitionPoints += 4; } else r.lost++;
    }
  }
  const asked = (k: string) => k === 'team' || new RegExp(`\\b${k}\\b`).test(query);
  const standings = [...rows.values()]
    .map((r) => ({ ...r, team: teamRef(r.team), percentage: r.pointsAgainst ? Math.round((r.pointsFor / r.pointsAgainst) * 10000) / 100 : 0 }))
    .sort((a, b) => b.competitionPoints - a.competitionPoints || b.percentage - a.percentage)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => asked(k))));
  return { id: div.id, name: div.name, ladder: [{ standings }] };
}

function answer(world: World, operationName: string, variables: Record<string, unknown>, query: string): unknown {
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
        // Not in name order, as PlayHQ may send them.
        grades: [...world.divisions].reverse().map((d) => ({ id: d.id, name: d.name, ...(/\bgender\b/.test(query) && { gender: { value: d.gender } }) })) } } };
    case 'gradeLadder': {
      const div = world.divisions.find((d) => d.id === variables.gradeID);
      return { data: { discoverGrade: div ? ladder(world, div, query) : null } };
    }
    case 'gradeRounds': {
      const div = world.divisions.find((d) => d.id === variables.gradeID);
      return { data: { discoverGrade: div ? { id: div.id, name: div.name, rounds: div.rounds.map(({ id, name, current, number }) => ({ id, name, current, number })) } : null } };
    }
    case 'discoverFixtureByRound': {
      const round = world.rounds[variables.roundID as string];
      return { data: { discoverFixtureByRound: round ? { games: round.games.map(fixtureGame) } : null } };
    }
    case 'discoverGame': return { data: { discoverGame: discoverGame(world, variables.gameID as string) } };
    default: return { errors: [{ message: `The test PlayHQ doesn't know ${operationName}` }] };
  }
}

function liveAnswer(world: World, id: string) {
  const g = world.games[id];
  const l = world.live[id];
  if (!g || (!l && !g.score)) return { errors: [{ message: 'The game could not be found or was not electronically scored' }] };
  const s = l ?? { home: g.score!.home, away: g.score!.away, homeGoals: g.score!.home - 2, awayGoals: g.score!.away - 2, homeSuper: 1, awaySuper: 1, period: 'FOURTH_QTR', clock: null, break: null };
  const side = (k: 'home' | 'away') => ({ statisticsV2: [stat('TOTAL_SCORE', s[k]), stat('1_POINT_SCORE', s[`${k}Goals`]), stat('2_POINT_SCORE', s[`${k}Super`]), stat('GOAL_ATTEMPT', s[`${k}Goals`] + s[`${k}Super`] + 3), stat('MISS', 3)] });
  return { data: { game: {
    id, status: g.status, updatedAt: null, break: s.break ?? null,
    statistics: { home: side('home'), away: side('away') },
    result: { home: { statistics: [stat('TOTAL_SCORE', s.home)] }, away: { statistics: [stat('TOTAL_SCORE', s.away)] }, currentPeriod: { value: s.period } },
    clock: s.clock ? { period: s.period, periodValue: s.period, ...s.clock } : null,
  } } };
}

export function response(status: number, body: string, headers: Record<string, string> = {}): ResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

/** fetch for the stand-in: api.playhq.com at any URL, the live feed at any URL containing "spectator". */
export function fakeFetch(world: World): FetchLike {
  return async (url, init) => {
    if (world.unreachable) throw world.unreachable;
    const parsed = JSON.parse(init.body) as { operationName?: string; variables?: Record<string, unknown>; query?: string };
    const spectator = url.includes('spectator');
    const operationName = parsed.operationName ?? '';
    const variables = parsed.variables ?? {};
    const query = parsed.query ?? '';
    world.calls.push({ url, spectator, operationName, variables, headers: init.headers, query });
    const key = spectator ? 'live' : operationName;
    const failing = world.fail[key];
    if (failing) return response(failing, 'Request blocked', { 'content-type': 'text/plain' });
    const own = world.answers[key]?.({ variables, query, calls: world.calls });
    if (own) return response(own.status ?? 200, typeof own.body === 'string' ? own.body : JSON.stringify(own.body), own.headers);
    const body = spectator ? liveAnswer(world, variables.id as string) : answer(world, operationName, variables, query);
    return response(200, JSON.stringify(body), world.setCookie ? { 'content-type': 'application/json', 'set-cookie': world.setCookie } : { 'content-type': 'application/json' });
  };
}
