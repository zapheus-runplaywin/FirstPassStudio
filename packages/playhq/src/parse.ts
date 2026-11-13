// PlayHQ's answers turned into the shared model (model.ts). Pure functions: no network, no clock
// unless `now` is passed, so every product and every test reads PlayHQ the same way.

import type {
  Competition, FixtureGame, FixtureRow, FixtureTeam, GameDetail, GameSide, Grade, Ladder, LadderRow,
  LiveGame, LiveSide, Player, Position, Round, Season, SeasonGrades,
} from './model';
import { genderOf, gradeGenderOf, POSITION_RANK, positionOf as defaultPositionOf, statCount, TIMEZONES } from './rules';

// ─── PlayHQ's raw shapes (only the fields FirstPass asks for) ───────────────
type Stat = { count?: number | null; type?: { value?: string | null } | null };
type RawTeam = { __typename?: string; id?: string | null; name?: string | null } | null | undefined;

export type RawCompetition = {
  id: string; name: string;
  seasons?: Season[] | null;
  organisation?: { id: string; name: string } | null;
};

export type RawSeason = {
  id: string; name: string;
  competition?: { id: string; name: string; organisation?: { id: string; name: string } | null } | null;
  grades?: { id: string; name: string; gender?: unknown }[] | null;
};

export type RawLadderGrade = {
  id?: string; name?: string | null;
  ladder?: RawLadderPool | RawLadderPool[] | null;
} | null | undefined;
type RawLadderPool = { standings?: (Record<string, unknown> & { team?: { id?: string; name?: string } | null })[] | null };

export type RawRound = { id: string; name?: string | null; current?: boolean | null; number?: number | null };

export type RawFixtureGame = {
  id: string;
  date?: string | null;
  dates?: string[] | null;
  status?: { value?: string | null } | null;
  home?: RawTeam; away?: RawTeam;
  result?: { home?: RawFixtureSide; away?: RawFixtureSide } | null;
  allocation?: { time?: string | null; court?: { name?: string | null; venue?: { name?: string | null } | null } | null } | null;
};
type RawFixtureSide = { outcome?: { value?: string | null } | null; statistics?: Stat[] | null } | null | undefined;

export type RawLineupEntry = {
  playerNumber?: string | number | null;
  player?: { __typename?: string; id?: string; name?: string; profile?: { firstName?: string | null; lastName?: string | null; gender?: unknown } | null } | null;
  statistics?: Stat[] | null;
  playerPosition?: { shortName?: string | null } | null;
  captain?: { name?: string | null; shortName?: string | null } | null;
};

export type RawGame = {
  id: string;
  date?: string | null;
  status?: { value?: string | null } | null;
  home?: RawTeam; away?: RawTeam;
  result?: { home?: { score?: number | null; statistics?: Stat[] | null } | null; away?: { score?: number | null; statistics?: Stat[] | null } | null } | null;
  statistics?: { home?: { players?: RawLineupEntry[] | null; statistics?: Stat[] | null } | null; away?: { players?: RawLineupEntry[] | null; statistics?: Stat[] | null } | null } | null;
};

export type RawLiveGame = {
  id: string;
  status?: string | null;
  break?: unknown;
  statistics?: { home?: { statisticsV2?: Stat[] | null } | null; away?: { statisticsV2?: Stat[] | null } | null } | null;
  result?: { home?: { statistics?: Stat[] | null } | null; away?: { statistics?: Stat[] | null } | null; currentPeriod?: { value?: string | null } | null } | null;
  clock?: LiveGame['clock'];
};

export type RawGradeRound = {
  id: string;
  name?: string;
  isFinalsRound?: boolean;
  byes?: { id: string; name: string }[];
  games?: {
    id: string;
    status?: { value?: string } | null;
    date?: string | null;
    home?: { id?: string; name?: string } | null;
    away?: { id?: string; name?: string } | null;
    allocation?: {
      time?: string | null;
      court?: { name?: string; venue?: { name?: string; suburb?: string; state?: string } } | null;
    } | null;
  }[];
};

// ─── Competitions and seasons ───────────────────────────────────────────────
export function parseCompetitions(list: RawCompetition[] | null | undefined): Competition[] {
  return (list ?? []).map((c) => ({ id: c.id, name: c.name, seasons: c.seasons ?? [], organisation: c.organisation ?? null }));
}

/** A season's divisions, sorted by name with numbers in order (Division 2 before Division 10). */
export function parseSeason(s: RawSeason): SeasonGrades {
  const grades = (s.grades ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return {
    season: { id: s.id, name: s.name },
    competition: s.competition ? { id: s.competition.id, name: s.competition.name } : null,
    organisation: s.competition?.organisation ?? null,
    grades: grades.map((g, i): Grade => ({ division: i + 1, id: g.id, name: g.name, gender: gradeGenderOf(g.gender) })),
  };
}

/**
 * The season in use: one whose name contains `seasonName` when given, else a live one, else one
 * running today, else any, latest start first.
 */
export function pickSeason<S extends Season>(seasons: readonly S[], seasonName?: string | null, now: number = Date.now()): S | undefined {
  if (seasonName) {
    const s = seasons.find((x) => x.name.toLowerCase().includes(seasonName.toLowerCase()));
    if (s) return s;
  }
  const t = (d: string | null | undefined) => (d ? Date.parse(d) : NaN);
  const live = seasons.filter((s) => /active|live|in.?progress/i.test(JSON.stringify(s.status || '')));
  const current = seasons.filter((s) => t(s.startDate) <= now && (isNaN(t(s.endDate)) || t(s.endDate) + 86400000 >= now));
  const pool = live.length ? live : current.length ? current : seasons;
  return pool.slice().sort((a, b) => (t(b.startDate) || 0) - (t(a.startDate) || 0))[0];
}

// ─── Ladders and rounds ─────────────────────────────────────────────────────
const num = (v: unknown) => (typeof v === 'number' ? v : v === null ? null : undefined);

export function parseLadder(grade: RawLadderGrade): Ladder {
  const raw = grade?.ladder;
  const pools = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return {
    grade: grade?.name ?? '',
    pools: pools.map((pool) => (pool.standings ?? []).map((s, i): LadderRow => {
      const row: LadderRow = { position: i + 1, team: s.team?.name ?? '', teamId: s.team?.id ?? null };
      for (const k of ['played', 'won', 'lost', 'drawn', 'byes', 'forfeits', 'pointsFor', 'pointsAgainst', 'percentage'] as const) {
        const v = num(s[k]);
        if (v !== undefined) row[k] = v;
      }
      const points = num(s.competitionPoints);
      if (points !== undefined) row.points = points;
      return row;
    })),
  };
}

export function parseRounds(rounds: RawRound[] | null | undefined): Round[] {
  return (rounds ?? []).map((r) => ({ id: r.id, name: r.name ?? '', current: r.current ?? null, number: r.number ?? null }));
}

// ─── A round's games ────────────────────────────────────────────────────────
export function parseRoundGames(roundId: string, games: RawFixtureGame[] | null | undefined): FixtureGame[] {
  return (games ?? []).map((g) => {
    const side = (team: RawTeam, result: RawFixtureSide) => ({
      name: team?.name || 'TBC',
      id: team?.id ?? null,
      score: statCount(result?.statistics, 'TOTAL_SCORE'),
      outcome: result?.outcome?.value ?? null,
    });
    const court = g.allocation?.court;
    return {
      id: g.id,
      roundId,
      status: g.status?.value ?? null,
      date: g.date || (g.dates ?? [])[0] || null,
      time: g.allocation?.time ?? null,
      court: court?.name ?? '',
      venue: court?.venue?.name ?? '',
      home: side(g.home, g.result?.home),
      away: side(g.away, g.result?.away),
    };
  });
}

// ─── One game in detail ─────────────────────────────────────────────────────
export type ParseGameOptions = {
  /** The position code for a line-up entry. Defaults to rules.positionOf (GS..GK, tidied). */
  positionOf?: (entry: RawLineupEntry) => Position;
};

const rank = (p: Player) => {
  const i = POSITION_RANK.indexOf(p.position);
  return i === -1 ? 99 : i;
};

export function parseGame(g: RawGame, options: ParseGameOptions = {}): GameDetail {
  const positionOf = options.positionOf ?? defaultPositionOf;
  const side = (k: 'home' | 'away'): GameSide => {
    const result = g.result?.[k];
    const st = g.statistics?.[k];
    const teamStats = st?.statistics ?? [];
    // The official result once there is one, else the running total from the scorer.
    let score: number | null = result?.score ?? statCount(result?.statistics, 'TOTAL_SCORE');
    if (score === null) score = statCount(teamStats, 'TOTAL_SCORE');
    if (score === null && (statCount(teamStats, '1_POINT_SCORE') !== null || statCount(teamStats, '2_POINT_SCORE') !== null)) {
      score = (statCount(teamStats, '1_POINT_SCORE') ?? 0) + 2 * (statCount(teamStats, '2_POINT_SCORE') ?? 0);
    }
    const players = (st?.players ?? []).map((p): Player => {
      const who = p.player ?? {};
      const name = who.profile ? `${who.profile.firstName ?? ''} ${who.profile.lastName ?? ''}`.trim() : (who.name ?? '');
      const goals = statCount(p.statistics, '1_POINT_SCORE') ?? 0;
      const superGoals = statCount(p.statistics, '2_POINT_SCORE') ?? 0;
      const captainName = p.captain?.name ?? '';
      return {
        name,
        number: p.playerNumber !== null && p.playerNumber !== undefined ? String(p.playerNumber) : '',
        playhqId: who.id ?? '',
        gender: genderOf(who.profile?.gender),
        position: positionOf(p),
        private: who.__typename === 'DiscoverAnonymousParticipant',
        captain: !!p.captain && !/vice/i.test(captainName),
        viceCaptain: !!p.captain && /vice/i.test(captainName),
        // shots = every attempt, normal and super (PlayHQ records one attempt count).
        shooting: { goals, superGoals, shots: statCount(p.statistics, 'GOAL_ATTEMPT'), points: goals + 2 * superGoals },
      };
    }).filter((p) => p.name);
    players.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const teamGoals = statCount(teamStats, '1_POINT_SCORE');
    const teamSupers = statCount(teamStats, '2_POINT_SCORE');
    const totals = teamGoals === null && teamSupers === null
      ? null
      : { goals: teamGoals ?? 0, superGoals: teamSupers ?? 0, shots: statCount(teamStats, 'GOAL_ATTEMPT') };
    return { name: g[k]?.name ?? '', id: g[k]?.id ?? null, score, totals, players };
  };
  return { id: g.id, status: g.status?.value ?? null, date: g.date ?? null, home: side('home'), away: side('away') };
}

// ─── The live feed ──────────────────────────────────────────────────────────
export function parseLive(g: RawLiveGame): LiveGame {
  const side = (k: 'home' | 'away'): LiveSide => {
    const total = statCount(g.result?.[k]?.statistics, 'TOTAL_SCORE');
    const team = g.statistics?.[k]?.statisticsV2 ?? [];
    return {
      score: total ?? statCount(team, 'TOTAL_SCORE'),
      goals: statCount(team, '1_POINT_SCORE'),
      superGoals: statCount(team, '2_POINT_SCORE'),
      shots: statCount(team, 'GOAL_ATTEMPT'),
      misses: statCount(team, 'MISS'),
    };
  };
  return {
    id: g.id,
    status: g.status ?? null,
    home: side('home'),
    away: side('away'),
    clock: g.clock ?? null,
    break: g.break ?? null,
    period: g.clock?.periodValue || g.result?.currentPeriod?.value || null,
  };
}

// ─── HQ's fixture import ────────────────────────────────────────────────────
/**
 * Each division's rounds as the teams and fixture rows HQ saves: games with a date (undated finals are
 * skipped), and one row per team bye, dated the round's first game. Teams come from games and byes;
 * finals between teams not decided yet have no ids, so they add no team.
 */
export function collectFixtures(
  grades: { grade: { id: string; name: string }; rounds: RawGradeRound[] }[],
  defaultTimezone = 'Australia/Perth',
): { teams: Map<string, FixtureTeam>; games: FixtureRow[] } {
  const teams = new Map<string, FixtureTeam>();
  const games: FixtureRow[] = [];
  for (const { grade, rounds } of grades) {
    for (const round of rounds) {
      for (const bye of round.byes ?? []) teams.set(bye.id, { id: bye.id, name: bye.name, grade: grade.name });
      for (const game of round.games ?? []) {
        const home = game.home?.id && game.home.name ? { id: game.home.id, name: game.home.name } : null;
        const away = game.away?.id && game.away.name ? { id: game.away.id, name: game.away.name } : null;
        for (const team of [home, away]) if (team) teams.set(team.id, { ...team, grade: grade.name });
        if (!game.date) continue;
        const venue = game.allocation?.court?.venue;
        games.push({
          id: game.id,
          date: game.date,
          time: game.allocation?.time ?? null,
          timezone: TIMEZONES[venue?.state ?? ''] ?? defaultTimezone,
          round: round.name ?? null,
          is_final: !!round.isFinalsRound,
          grade: grade.name,
          venue: venue?.name ?? null,
          court: game.allocation?.court?.name ?? null,
          status: game.status?.value ?? null,
          home,
          away,
        });
      }
      // A bye is a round with no game for that team.
      for (const bye of round.byes ?? []) {
        const date = (round.games ?? []).find((g) => g.date)?.date;
        if (!date) continue;
        games.push({
          id: `bye-${round.id}-${bye.id}`,
          date,
          time: null,
          timezone: defaultTimezone,
          round: round.name ?? null,
          is_final: !!round.isFinalsRound,
          grade: grade.name,
          venue: null,
          court: null,
          status: 'BYE',
          home: { id: bye.id, name: bye.name },
          away: null,
        });
      }
    }
  }
  return { teams, games };
}
