// The one fixture, line up, ladder and live model every FirstPass product reads PlayHQ into.
// It starts from Studio's shapes (the richest, and what its graphics already read) and adds
// PlayHQ's ids where Studio had only names, so Vantage and HQ can match on ids. Fields are only
// ever added, never renamed or removed (see the README's versioning rule).

/** 'female', 'male', or '' for mixed, open or not given. */
export type Gender = 'female' | 'male' | '';

/** A netball position code, or '' when PlayHQ has none. Other sports' codes pass through as given. */
export type Position = 'GS' | 'GA' | 'WA' | 'C' | 'WD' | 'GD' | 'GK' | (string & {});

export type Season = { id: string; name: string; startDate?: string | null; endDate?: string | null; status?: unknown };

export type Competition = {
  id: string;
  name: string;
  seasons: Season[];
  organisation: { id: string; name: string } | null;
};

/** A division ("grade" in PlayHQ). division is its 1-based place after sorting by name. */
export type Grade = { division: number; id: string; name: string; gender: Gender };

export type SeasonGrades = {
  season: { id: string; name: string };
  competition: { id: string; name: string } | null;
  organisation: { id: string; name: string } | null;
  grades: Grade[];
};

export type LadderRow = {
  position: number;
  team: string;
  teamId: string | null;
  played?: number | null;
  won?: number | null;
  lost?: number | null;
  drawn?: number | null;
  byes?: number | null;
  forfeits?: number | null;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
  percentage?: number | null;
  /** PlayHQ's competitionPoints. */
  points?: number | null;
};

/** A ladder: one list of rows per pool (most divisions have one pool). */
export type Ladder = { grade: string; pools: LadderRow[][] };

export type Round = { id: string; name: string; current: boolean | null; number: number | null };

export type FixtureSide = {
  /** 'TBC' while a final's team isn't decided. */
  name: string;
  /** PlayHQ's team id; null for a provisional (undecided) team. */
  id: string | null;
  score: number | null;
  /** WON, LOST, DRAWN... null before a result. */
  outcome: string | null;
};

/** A game in a round's fixture. date is the venue's local day, time its local time (HH:MM:SS). */
export type FixtureGame = {
  id: string;
  roundId: string;
  status: string | null;
  date: string | null;
  time: string | null;
  court: string;
  venue: string;
  home: FixtureSide;
  away: FixtureSide;
};

export type Shooting = { goals: number; superGoals: number; shots: number | null; points: number };

export type Player = {
  name: string;
  /** Bib number as PlayHQ gives it, '' when none. */
  number: string;
  playhqId: string;
  gender: Gender;
  position: Position;
  /** PlayHQ hides this player's name from the public (an anonymous participant). */
  private: boolean;
  captain: boolean;
  viceCaptain: boolean;
  shooting: Shooting;
};

/** The team's own counts. A team total is never the players added up: PlayHQ can give a goal to no player. */
export type TeamTotals = { goals: number; superGoals: number; shots: number | null };

export type GameSide = { name: string; id: string | null; score: number | null; totals: TeamTotals | null; players: Player[] };

/** One game in detail, as playhq.com's game page reads it (discoverGame). */
export type GameDetail = { id: string; status: string | null; date: string | null; home: GameSide; away: GameSide };

export type LiveSide = {
  score: number | null;
  goals: number | null;
  superGoals: number | null;
  shots: number | null;
  misses: number | null;
};

export type LiveClock = {
  period?: string | null;
  periodValue?: string | null;
  /** RESUME, PAUSE... as PlayHQ sends it. */
  status?: string | null;
  /** The scorer's clock, MM:SS. */
  time?: string | null;
  lastUpdatedAt?: string | null;
};

/** The live scoring feed (spectator.playhq.com) for a game being scored. */
export type LiveGame = {
  id: string;
  status: string | null;
  home: LiveSide;
  away: LiveSide;
  clock: LiveClock | null;
  break: unknown;
  /** FIRST_QTR... (see PERIOD_NUMBER), null before the first. */
  period: string | null;
};

/** One row of HQ's fixtures import (supabase/functions/playhq): a game, or a team's bye. */
export type FixtureRow = {
  id: string;
  date: string;
  time: string | null;
  timezone: string;
  round: string | null;
  is_final: boolean;
  grade: string;
  venue: string | null;
  court: string | null;
  status: string | null;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
};

export type FixtureTeam = { id: string; name: string; grade: string };
