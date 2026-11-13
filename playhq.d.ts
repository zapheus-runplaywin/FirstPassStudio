// FirstPass Studio - the types of the PlayHQ client (playhq.js), for the TypeScript modules that use it.
//
// playhq.js (Studio's own layer on the shared PlayHQ package, @firstpass/playhq in packages/playhq) is still JavaScript;
// it moves to TypeScript in a change of its own, and until then this file says what it hands over.

import type { Log } from './types';

/** 'female', 'male', or '' for mixed, open or not given. */
export type Gender = 'female' | 'male' | '';

/** A division ("grade" in PlayHQ). division is its 1-based place after sorting by name. */
export interface Grade { division: number; id: string; name: string; gender: Gender }

/** A division as a page can name it: findGrade gives { id, name } alone for ?gradeId=. */
export type GradeRef = Pick<Grade, 'id' | 'name'> & Partial<Grade>;

/** The season's divisions, and the names the graphics show (getStructure). */
export interface Structure {
  organisation: string; competition: string; season: { id: string; name: string }; grades: Grade[]; otherCompetitions: string[];
}

export interface LadderRow {
  position: number; team: string;
  played?: number | null; won?: number | null; lost?: number | null; drawn?: number | null; byes?: number | null; forfeits?: number | null;
  pointsFor?: number | null; pointsAgainst?: number | null; percentage?: number | null; points?: number | null;
}
/** A ladder: one list of rows per pool (most divisions have one pool). stale and error: the last good one, kept while PlayHQ fails. */
export interface Ladder { grade: string; pools: LadderRow[][]; updatedAt: string; stale?: boolean; error?: string }

export interface Round { id: string; name: string; current: boolean | null; number: number | null }

export interface FixtureSide { name: string; score: number | null; outcome: string | null }
/** A game in a round's fixture. date is the venue's local day, time its local time (HH:MM:SS). */
export interface FixtureGame {
  id: string; roundId: string; status: string | null; date: string | null; time: string | null; court: string; venue: string;
  home: FixtureSide; away: FixtureSide;
}
/** A round's games; stale says why they're the last ones read rather than fresh. */
export type RoundGames = FixtureGame[] & { stale?: string };

export interface Shooting { goals: number; superGoals: number; shots: number | null; points: number }
export interface Player {
  name: string; number: string; playhqId: string; gender: Gender; position: string; private: boolean; captain: boolean; viceCaptain: boolean;
  shooting: Shooting;
}
/** The team's own counts. A team total is never the players added up: PlayHQ can give a goal to no player. */
export interface TeamTotals { goals: number; superGoals: number; shots: number | null }
export interface GameSide { name: string; logo: string | null; score: number | null; totals: TeamTotals | null; players: Player[] }
/** One game in detail (line ups and player stats), as playhq.com's game page reads it. */
export interface GameDetail { id: string; status: string | null; home: GameSide; away: GameSide }

export interface LiveSide { score: number | null; goals: number | null; superGoals: number | null; shots: number | null; misses: number | null }
export interface LiveClock { period?: string | null; periodValue?: string | null; status?: string | null; time?: string | null; lastUpdatedAt?: string | number | null }
/** The live scoring feed (spectator.playhq.com) for a game being scored. */
export interface LiveGame {
  id: string; status: string | null; home: LiveSide; away: LiveSide; clock: LiveClock | null; break: string | null; period: string | null;
}
/** A live score for any game (liveScore): the live feed's when it has one (live), else the game page's. */
export interface LiveScore { home: number; away: number; status: string | null; live?: LiveGame }
/** What a game's live feed last said (board.ts playhqTrouble). */
export interface LiveSeen { okAt: number; notScoredAt: number; changedAt: number; sig: string; live?: LiveGame }

/** A game as the time helpers read it: a fixture game, or anything with a status, a day and a time. */
export interface Timed { status?: string | null; date?: string | null; time?: string | null }
/** A game as isFinished reads it. */
export interface Scored extends Timed { home?: { score?: number | null }; away?: { score?: number | null } }

/** One item's outcome from eachLimited. */
export type Each<T> = { value: T; error?: undefined } | { value?: undefined; error: unknown };

export interface Deps {
  log: Log; apiUrl: string; cacheMs: number; linkBase: string;
  config(): import('./types').Config; leadMs(): number;
  logoFor(teamName: string): string | null; positionOf(player: unknown): string;
  record?: { playhq(...args: unknown[]): void; live(gameId: string, json: unknown): void };
  practice?: { active(): boolean; answer?(operationName: string, variables: unknown): unknown; live?(gameId: string): unknown };
}

export interface Client {
  setOrganisation(url: string | null | undefined): { tenant: string; orgId: string | null };
  resetCaches(): void;
  organisation(): { tenant: string; orgId: string | null };
  structureNow(): Structure | null;
  competitions(orgId: string, tenant: string): Promise<import('@firstpass/playhq').Competition[]>;
  getStructure(): Promise<Structure>;
  getLadder(gradeId: string): Promise<Ladder>;
  findGrade(st: Structure, q: { gradeId?: string; division?: string }): GradeRef | undefined;
  pickSeason<S extends { name: string; startDate?: string | null; endDate?: string | null; status?: unknown }>(seasons: S[]): S | undefined;
  getRounds(gradeId: string): Promise<Round[]>;
  getRoundGames(roundId: string, maxAgeMs: number): Promise<RoundGames>;
  getGame(gameId: string, maxAgeMs: number): Promise<GameDetail>;
  readGame(g: Scored & { id: string }, maxAgeMs: number): Promise<GameDetail>;
  eachLimited<I, T>(items: I[], limit: number, fn: (item: I, i: number) => Promise<T>): Promise<Each<T>[]>;
  PLAYHQ_AT_ONCE: number;
  POSITION_RANK: string[];
  getLive(gameId: string, maxAgeMs: number): Promise<LiveGame>;
  liveScore(game: { id: string }, maxAgeMs: number): Promise<LiveScore | null>;
  scoringNotYet(game: (Timed & { id?: string }) | string): string;
  PERIOD_NUMBER: Record<string, number | undefined>;
  lastLive: { at: number; error: string; errorAt: number };
  liveSeenFor(id: string): LiveSeen;
}

export function create(deps: Deps): Client;
export function parsePlayhqUrl(url: unknown): { tenant: string; orgId: string } | null;
export function isFinished(g: Scored): boolean;
export function startOf(g: Timed, date?: string | null): number | null;
export function localDate(d?: Date): string;
