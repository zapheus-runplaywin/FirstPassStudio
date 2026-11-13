// The questions FirstPass asks PlayHQ, each giving the shared model. Stateless apart from what it
// learns about PlayHQ's schema (ladder columns and the player gender spelling it refuses), which a
// product can save and give back on the next start with `learned`.
//
// Caching, keeping the last good answer while PlayHQ is down and saving finished games are the
// product's choice: wrap these calls with createKeeper (keep.ts) or your own.

import type { Competition, FixtureGame, GameDetail, Ladder, LiveGame, Round, SeasonGrades } from './model';
import {
  collectFixtures, parseCompetitions, parseGame, parseLadder, parseLive, parseRoundGames, parseRounds, parseSeason,
  type ParseGameOptions, type RawCompetition, type RawFixtureGame, type RawGame, type RawGradeRound,
  type RawLadderGrade, type RawLiveGame, type RawRound, type RawSeason,
} from './parse';
import {
  GENDER_FIELDS, Q_COMPETITIONS, Q_GRADE_FIXTURE, Q_LIVE, Q_ROUND_GAMES, Q_ROUNDS, qGame, qLadder, qSeason, STANDING_FIELDS,
} from './queries';
import { PlayhqError, type Transport } from './transport';

/** What the client has learned PlayHQ refuses. Save it and pass it back to skip refused queries after a restart. */
export type Learned = {
  /** Ladder columns PlayHQ doesn't know for this sport. */
  unknownLadderFields: string[];
  /** The player gender spelling PlayHQ accepted, one of GENDER_FIELDS ('' asks for none). */
  genderField: string;
  /** false once PlayHQ refused a division's gender. */
  seasonGender: boolean;
};

export type ApiOptions = ParseGameOptions & {
  learned?: Partial<Learned>;
  /** Told when the client learns something (to save it), and why. */
  onLearn?: (learned: Learned, why: string) => void;
};

const notFound = (what: string) => new PlayhqError(what);

export type PlayhqApi = ReturnType<typeof createPlayhqApi>;

export function createPlayhqApi(transport: Transport, options: ApiOptions = {}) {
  const unknownFields = new Set(options.learned?.unknownLadderFields ?? []);
  const startGender = GENDER_FIELDS.indexOf((options.learned?.genderField ?? 'gender') as (typeof GENDER_FIELDS)[number]);
  let genderField = startGender === -1 ? 0 : startGender;
  let seasonGender = options.learned?.seasonGender ?? true;

  const learned = (): Learned => ({
    unknownLadderFields: [...unknownFields],
    genderField: GENDER_FIELDS[genderField] ?? '',
    seasonGender,
  });
  const learn = (why: string) => options.onLearn?.(learned(), why);

  /** An organisation's competitions and their seasons (organisation links give the id). */
  async function competitions(orgId: string): Promise<Competition[]> {
    const data = await transport.gql<{ discoverCompetitions?: RawCompetition[] | null }>('discoverCompetitions', Q_COMPETITIONS, { organisationID: orgId });
    return parseCompetitions(data.discoverCompetitions);
  }

  /** A season's divisions. Asks for each division's gender, and once without it if PlayHQ refuses. */
  async function season(seasonId: string): Promise<SeasonGrades> {
    let s: RawSeason | null | undefined;
    try {
      s = (await transport.gql<{ discoverSeason?: RawSeason | null }>('gradeListDiscoverSeason', qSeason(seasonGender), { id: seasonId })).discoverSeason;
    } catch (err) {
      if (!(err instanceof PlayhqError) || !err.graphql || !seasonGender) throw err;
      seasonGender = false;
      learn(`Division gender unavailable, reading divisions without it: ${err.message}`);
      s = (await transport.gql<{ discoverSeason?: RawSeason | null }>('gradeListDiscoverSeason', qSeason(false), { id: seasonId })).discoverSeason;
    }
    if (!s) throw notFound(`PlayHQ has no season with id ${seasonId}.`);
    return parseSeason(s);
  }

  /** A division's ladder. A column PlayHQ doesn't know for the sport is dropped and the ladder asked again. */
  async function ladder(gradeId: string): Promise<Ladder> {
    for (let attempt = 0; attempt <= STANDING_FIELDS.length; attempt++) {
      const fields = STANDING_FIELDS.filter((f) => !unknownFields.has(f));
      try {
        const data = await transport.gql<{ discoverGrade?: RawLadderGrade }>('gradeLadder', qLadder(fields), { gradeID: gradeId });
        return parseLadder(data.discoverGrade);
      } catch (err) {
        const bad = (err instanceof PlayhqError ? err.graphql ?? [] : [])
          .map((e) => (e.message.match(/Cannot query field "(\w+)"/) ?? [])[1])
          .filter((f): f is string => !!f && (STANDING_FIELDS as readonly string[]).includes(f) && !unknownFields.has(f));
        if (!bad.length) throw err;
        bad.forEach((f) => unknownFields.add(f));
        learn(`Ladder columns PlayHQ doesn't have: ${bad.join(', ')}`);
      }
    }
    throw new PlayhqError('Could not read the ladder fields from PlayHQ');
  }

  /** A division's rounds. */
  async function rounds(gradeId: string): Promise<Round[]> {
    const data = await transport.gql<{ discoverGrade?: { rounds?: RawRound[] | null } | null }>('gradeRounds', Q_ROUNDS, { gradeID: gradeId });
    return parseRounds(data.discoverGrade?.rounds);
  }

  /** A round's games, with scores once there are results. */
  async function roundGames(roundId: string): Promise<FixtureGame[]> {
    const data = await transport.gql<{ discoverFixtureByRound?: { games?: RawFixtureGame[] | null } | null }>('discoverFixtureByRound', Q_ROUND_GAMES, { roundID: roundId });
    return parseRoundGames(roundId, data.discoverFixtureByRound?.games);
  }

  /**
   * One game in detail: line ups, positions, captains and each player's shooting. PlayHQ's player
   * gender field isn't documented, so each spelling is tried until one is accepted (the last asks for none).
   */
  async function game(gameId: string, parseOptions: ParseGameOptions = options): Promise<GameDetail> {
    for (;;) {
      try {
        const g = (await transport.gql<{ discoverGame?: RawGame | null }>('discoverGame', qGame(GENDER_FIELDS[genderField] ?? ''), { gameID: gameId })).discoverGame;
        if (!g) throw notFound(`PlayHQ has no game ${gameId}`);
        return parseGame(g, parseOptions);
      } catch (err) {
        // PlayHQ may answer HTTP 400 with an error that doesn't name the field, so any refused query moves on.
        if (!(err instanceof PlayhqError) || !err.graphql || genderField >= GENDER_FIELDS.length - 1) throw err;
        genderField++;
        learn(`Player gender: trying "${GENDER_FIELDS[genderField] || 'none'}" after: ${err.message}`);
      }
    }
  }

  /**
   * The live scoring feed for a game being scored. Throws a PlayhqError with notScored when PlayHQ
   * says the game isn't being scored electronically (before the scorer starts, or never).
   */
  async function live(gameId: string): Promise<LiveGame> {
    const json = await transport.live(gameId, Q_LIVE);
    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join('; ');
      if (/not electronically scored/i.test(message)) {
        throw new PlayhqError("PlayHQ isn't scoring this game yet.", { notScored: true, graphql: json.errors });
      }
      throw new PlayhqError(message, { graphql: json.errors });
    }
    const g = json.data?.game as RawLiveGame | null | undefined;
    if (!g) throw notFound(`PlayHQ live feed has no game ${gameId}`);
    return parseLive(g);
  }

  /** A division's whole fixture by round, with byes and venue states. */
  async function gradeFixture(gradeId: string): Promise<RawGradeRound[]> {
    const data = await transport.gql<{ discoverGradeFixture?: RawGradeRound[] | null }>('gradeFixture', Q_GRADE_FIXTURE, { gradeID: gradeId });
    return data.discoverGradeFixture ?? [];
  }

  /**
   * HQ's fixture import: every division of a season (from a season link's code), as the teams and
   * fixture rows HQ saves. name is "Competition · Season".
   */
  async function seasonFixtures(seasonCode: string) {
    const s = await season(seasonCode);
    const grades = await Promise.all(s.grades.map(async (grade) => ({ grade, rounds: await gradeFixture(grade.id) })));
    const { teams, games } = collectFixtures(grades);
    return {
      id: s.season.id,
      name: [s.competition?.name, s.season.name].filter(Boolean).join(' · '),
      teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
      games,
      grades: grades.map(({ grade, rounds: r }) => ({ id: grade.id, name: grade.name, rounds: r.length, games: r.reduce((n, x) => n + (x.games?.length ?? 0), 0) })),
    };
  }

  return { transport, competitions, season, ladder, rounds, roundGames, game, live, gradeFixture, seasonFixtures, learned };
}
