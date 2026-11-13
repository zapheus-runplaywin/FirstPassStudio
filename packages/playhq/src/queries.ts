// The GraphQL PlayHQ's own pages send, as FirstPass asks them. api.playhq.com answers everything but
// the live feed, which comes from spectator.playhq.com. Field names PlayHQ might not know for a sport
// (ladder columns, gender spellings) are built per request, so a refused one can be dropped.

export const API_URL = 'https://api.playhq.com/graphql';
export const SPECTATOR_URL = 'https://spectator.playhq.com/graphql';

/** Asked first to get a guest session cookie: the first that sets one wins. */
export const SESSION_QUERIES = [
  { operationName: 'ProfileSearch', variables: { fullName: 'a' }, query: 'query ProfileSearch($fullName: String!) { profileSearch(fullName: $fullName) { result { id } } }' },
  { operationName: 'TenantConfig', variables: {}, query: 'query TenantConfig { tenantConfiguration { label } }' },
] as const;

/** The sport's short label ("na" for netball-australia), which the live feed takes as its tenant. */
export const Q_TENANT_LABEL = 'query tenantLabel { tenantConfiguration { label } }';

/** An organisation's competitions and their seasons. */
export const Q_COMPETITIONS = `query discoverCompetitions($organisationID: ID!) {
    discoverCompetitions(organisationID: $organisationID) {
      id name
      seasons(organisationID: $organisationID) { id name startDate endDate status { name value } }
      organisation { id name }
    }
  }`;

/** A season's divisions, with each division's gender when PlayHQ accepts it. */
export const qSeason = (withGender: boolean) => `query gradeListDiscoverSeason($id: String!) {
    discoverSeason(seasonID: $id) {
      id name
      competition { id name organisation { id name } }
      grades { id name${withGender ? ' gender { value }' : ''} }
    }
  }`;

/** Ladder columns. One PlayHQ doesn't know for a sport is dropped and the ladder asked for again. */
export const STANDING_FIELDS = ['played', 'won', 'lost', 'drawn', 'byes', 'forfeits', 'pointsFor', 'pointsAgainst', 'percentage', 'competitionPoints'] as const;

export const qLadder = (fields: readonly string[]) => `query gradeLadder($gradeID: ID!) {
    discoverGrade(gradeID: $gradeID) {
      id name
      ladder { standings { team { id name } ${fields.join(' ')} } }
    }
  }`;

export const Q_ROUNDS = `query gradeRounds($gradeID: ID!) {
    discoverGrade(gradeID: $gradeID) { id name rounds { id name current number } }
  }`;

const TEAM = '__typename ... on DiscoverTeam { id name } ... on ProvisionalTeam { name }';
const SIDE = 'outcome { value } statistics { count type { value } }';

export const Q_ROUND_GAMES = `query discoverFixtureByRound($roundID: ID!) {
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

/** A whole division's fixture, with byes and venue states: HQ's fixture import. */
export const Q_GRADE_FIXTURE = `query gradeFixture($gradeID: ID!) {
    discoverGradeFixture(gradeID: $gradeID) {
      id
      name
      isFinalsRound
      byes { id name }
      games {
        id
        status { value }
        date
        home { ... on DiscoverTeam { id name } ... on ProvisionalTeam { name } }
        away { ... on DiscoverTeam { id name } ... on ProvisionalTeam { name } }
        allocation {
          time
          court { name venue { name suburb state } }
        }
      }
    }
  }`;

/** Ways PlayHQ might spell a player's gender, tried in turn; the last asks for none. */
export const GENDER_FIELDS = ['gender', 'gender { value }', ''] as const;

const STATS = 'statistics { count type { value } }';

/** One side's line up: who played, where, captaincy and their scoring. */
export const lineupFields = (genderField: string) => {
  const profile = `profile { firstName lastName ${genderField} }`;
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

/** One game in detail: the same request playhq.com's game page makes. */
export const qGame = (genderField: string) => `query discoverGame($gameID: ID!) {
    discoverGame(gameID: $gameID) {
      id date status { value }
      home { ${TEAM} }
      away { ${TEAM} }
      result { home { score ${STATS} } away { score ${STATS} } }
      statistics { home { ${lineupFields(genderField)} ${STATS} } away { ${lineupFields(genderField)} ${STATS} } }
    }
  }`;

const LIVE_STATS = 'statistics { type { value } count }';

/** The live scoring feed for one game (spectator.playhq.com). */
export const Q_LIVE = `query game($id: ID!) {
      game(id: $id) {
        id status updatedAt break
        statistics { home { statisticsV2 { type { value } count } } away { statisticsV2 { type { value } count } } }
        result { home { ${LIVE_STATS} } away { ${LIVE_STATS} } currentPeriod { value } }
        clock { period periodValue status time lastUpdatedAt }
      }
    }`;
