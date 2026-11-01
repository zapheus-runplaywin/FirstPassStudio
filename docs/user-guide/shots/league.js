// The Elite Netball League: the made-up competition the user guide's screenshots show. It is a season for
// the tests' stand-in PlayHQ (test/support/playhq.js), in the same shape as its own Thunder League one, with
// the answers that name the competition, venue and players replaced, and the competition's template
// (settings, team logos and its own logo) for Studio to import.
//   Rounds 1 to 8 were played on the last eight Saturdays; Round 9 is tonight: Panthers v Falcons
//   (Premier, Court 1) is in the third quarter, the rest of the night is still to come. Round 10 is next week.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { localZone, POSITIONS, discoverGame } = require('../../../test/support/playhq');

const ASSETS = path.join(__dirname, 'assets');
const ORG_ID = 'e7a1b2c3';
const ORG_NAME = 'Elite Netball Association';
const ORG_URL = `https://www.playhq.com/netball-australia/org/elite-netball-association/${ORG_ID}`;
const COMP = 'Elite Netball League';
const SEASON = 'Spring 2026';
const VENUE = 'Metro Arena';

const CLUBS = {
  Panthers: '#3b1a5e', Falcons: '#1c4f8f', Stingrays: '#0a7f8c', Wolves: '#1f4fd1',
  Rhinos: '#5b6670', Cobras: '#1a6b3a', Grizzlies: '#7a3d12', Hawks: '#b3122a',
};
// Each division's clubs, the first two playing each other on Court 1 tonight.
const DIVISIONS = [
  { id: 'grade-premier', name: 'Premier', gender: 'FEMALE', suffix: '', clubs: ['Panthers', 'Falcons', 'Stingrays', 'Wolves', 'Rhinos', 'Cobras', 'Grizzlies', 'Hawks'] },
  { id: 'grade-mens', name: "Men's", gender: 'MALE', suffix: ' Men', clubs: ['Wolves', 'Falcons', 'Hawks', 'Cobras', 'Panthers', 'Rhinos'] },
  { id: 'grade-u21', name: 'Under 21', gender: 'MIXED', suffix: ' 21U', clubs: ['Panthers', 'Stingrays', 'Hawks', 'Falcons', 'Grizzlies', 'Wolves'] },
];
const ROUNDS = 10, TONIGHT = 8; // index of Round 9
// Minutes from now that each division's games start tonight (court 1 first): Premier is under way.
const TONIGHT_STARTS = [[-38, 52], [142, 142, 142], [232, 232, 232]];

// Who plays who, round by round (the circle method), as indexes into the division's clubs, arranged so
// that tonight 0 plays 1, 2 plays 3 and so on.
function draw(n) {
  const rounds = [];
  const ring = [...Array(n).keys()];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([ring[i], ring[n - 1 - i]]);
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop());
  }
  const all = Array.from({ length: ROUNDS }, (_, r) => rounds[r % rounds.length]);
  // Relabel so tonight's pairs are (0,1), (2,3), ...
  const map = new Map();
  all[TONIGHT].forEach(([h, a], i) => { map.set(h, 2 * i); map.set(a, 2 * i + 1); });
  return all.map((pairs, r) => pairs.map(([h, a]) => (r % 2 ? [map.get(a), map.get(h)] : [map.get(h), map.get(a)])));
}

// A steady pseudo-random number, so every run makes the same season.
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

const FIRST = ['Mia', 'Ava', 'Zara', 'Chloe', 'Isla', 'Ruby', 'Grace', 'Sienna', 'Leah', 'Tahlia', 'Jade', 'Maddie', 'Kira', 'Ella', 'Nina', 'Paige',
  'Josh', 'Liam', 'Kai', 'Ethan', 'Noah', 'Jack', 'Ryan', 'Sam', 'Luca', 'Ben', 'Tom', 'Harvey'];
const LAST = ['Thompson', 'Nguyen', 'Walker', 'Okafor', 'Kelly', 'Brennan', 'Patel', 'Morgan', 'Fraser', 'Hughes', 'Rossi', 'Tanaka', 'Clarke', 'Bailey',
  'Moana', 'Davies', 'Reid', 'Sullivan', 'Hart', 'Campbell', 'Price', 'Ward', 'Ellis', 'Lowe'];

function createWorld({ now = Date.now() } = {}) {
  const { offset } = localZone(now);
  const local = ms => new Date(ms + offset * 3600000).toISOString();
  const dateAt = ms => local(ms).slice(0, 10);
  const timeAt = ms => local(ms).slice(11, 16) + ':00';
  const rand = rng(9);
  const divisions = DIVISIONS.map(d => ({ id: d.id, name: d.name, gender: d.gender, teams: d.clubs.map(c => c + d.suffix) }));
  const world = { now, today: dateAt(now), orgId: ORG_ID, orgUrl: ORG_URL, divisions, calls: [], live: {}, games: {}, rounds: {}, fail: {}, answers: {} };

  for (const [d, div] of divisions.entries()) {
    const pairs = draw(div.teams.length);
    div.rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      const days = (r - TONIGHT) * 7;
      const round = { id: `${div.id}-r${r + 1}`, name: `Round ${r + 1}`, number: r + 1, current: r === TONIGHT, gradeId: div.id, games: [] };
      for (const [i, [h, a]] of pairs[r].entries()) {
        const slot = TONIGHT_STARTS[d][Math.floor(i / 2)] ?? TONIGHT_STARTS[d][0];
        const start = now + days * 86400000 + slot * 60000;
        const id = `game-${div.id.slice(6)}-r${r + 1}-${i + 1}`;
        const finished = r < TONIGHT;
        const live = r === TONIGHT && slot < 0;
        const hs = 38 + Math.round(rand() * 20), as = 38 + Math.round(rand() * 20);
        const game = {
          id, roundId: round.id, gradeId: div.id, division: div.name,
          date: dateAt(start), time: timeAt(start), court: `Court ${d === 0 ? (i % 2) + 1 : i + 1}`,
          status: finished ? 'FINAL' : live ? 'IN_PROGRESS' : 'UPCOMING',
          home: div.teams[h], away: div.teams[a],
          score: finished ? { home: hs, away: hs === as ? as + 1 : as } : null,
        };
        round.games.push(game);
        world.games[id] = game;
      }
      div.rounds.push(round);
      world.rounds[round.id] = round;
    }
  }
  // Tonight's Premier games under way: Panthers v Falcons in the third quarter, with super shots on.
  const [first, second] = divisions[0].rounds[TONIGHT].games;
  world.live[first.id] = { home: 32, away: 28, homeGoals: 26, awayGoals: 24, homeSuper: 3, awaySuper: 2, homeShots: 38, awayShots: 35,
    period: 'THIRD_QTR', clock: { status: 'RESUME', time: '04:53', lastUpdatedAt: String(now) }, break: null };
  world.live[second.id] = { home: 30, away: 31, homeGoals: 26, awayGoals: 27, homeSuper: 2, awaySuper: 2,
    period: 'THIRD_QTR', clock: { status: 'RESUME', time: '05:40', lastUpdatedAt: String(now) }, break: null };
  world.gameNow = () => first;

  // Players: seven a team with made-up names, no two alike, the same every run.
  const names = new Map();
  const pairs = {};
  const shuffled = pool => {
    const r = rng(17), all = [];
    for (const f of pool) for (const l of LAST) all.push({ firstName: f, lastName: l });
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all;
  };
  for (const div of divisions) {
    const key = div.gender;
    pairs[key] = pairs[key] || shuffled(key === 'MALE' ? FIRST.slice(16) : key === 'FEMALE' ? FIRST.slice(0, 16) : FIRST);
    for (const team of div.teams) names.set(team, POSITIONS.map(() => pairs[key].shift()));
  }

  const org = { id: ORG_ID, name: ORG_NAME };
  const competition = { id: 'comp-enl', name: COMP, organisation: org };
  const stat = (type, count) => ({ type: { value: type }, count });
  const teamRef = name => ({ __typename: 'DiscoverTeam', id: `team-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name });
  const ok = data => ({ body: { data } });
  world.answers = {
    discoverCompetitions: ({ variables }) => variables.organisationID === ORG_ID && ok({ discoverCompetitions: [{ ...competition, seasons: [
      { id: 'season-old', name: 'Autumn 2026', startDate: '2026-02-01', endDate: '2026-05-30', status: { name: 'Completed', value: 'COMPLETED' } },
      { id: 'season-now', name: SEASON, startDate: '2026-08-01', endDate: '2026-12-20', status: { name: 'Active', value: 'ACTIVE' } },
    ] }] }),
    gradeListDiscoverSeason: ({ variables, query }) => ok({ discoverSeason: { id: variables.id, name: SEASON, competition,
      grades: divisions.map(d => ({ id: d.id, name: d.name, ...(/\bgender\b/.test(query) && { gender: { value: d.gender } }) })) } }),
    discoverFixtureByRound: ({ variables }) => {
      const round = world.rounds[variables.roundID];
      return ok({ discoverFixtureByRound: round ? { games: round.games.map(g => {
        const side = k => g.score ? { outcome: { value: g.score[k] > g.score[k === 'home' ? 'away' : 'home'] ? 'WON' : 'LOST' }, statistics: [stat('TOTAL_SCORE', g.score[k])] }
          : { outcome: null, statistics: [] };
        return { id: g.id, date: g.date, dates: [g.date], status: { value: g.status }, home: teamRef(g.home), away: teamRef(g.away),
          result: { home: side('home'), away: side('away') },
          allocation: { time: g.time, court: { name: g.court, venue: { name: VENUE } } } };
      }) } : null });
    },
    discoverGame: ({ variables }) => {
      const game = discoverGame(world, variables.gameID);
      const g = world.games[variables.gameID];
      for (const k of ['home', 'away']) {
        for (const [i, p] of (game?.statistics?.[k]?.players || []).entries()) {
          const nm = names.get(g[k])[i];
          p.player.profile = { ...p.player.profile, ...nm, gender: 'FEMALE' };
          p.player.id = `${g[k]}-${nm.firstName}-${nm.lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          p.playerNumber = String([3, 7, 11, 5, 9, 14, 22][i]);
        }
      }
      return ok({ discoverGame: game });
    },
  };
  return world;
}

// The competition's template, as Competitions setup's Export as template makes it.
function template() {
  const logos = {};
  for (const f of fs.readdirSync(path.join(ASSETS, 'logos'))) logos[f] = fs.readFileSync(path.join(ASSETS, 'logos', f)).toString('base64');
  const clubs = Object.fromEntries(Object.entries(CLUBS).map(([name, colour]) => [name, { logo: `${name}.png`, colour }]));
  return {
    format: 'firstpass-studio-competition', version: 1,
    settings: {
      name: COMP, organisationUrl: ORG_URL, competitionName: COMP, seasonName: '', displayName: '', organisationName: ORG_NAME, venueName: VENUE,
      periodType: 'quarters', quarterMinutes: 15, superShots: true, superShotMinutes: 5, divisionSuperShots: { 'Under 21': false },
      quarterBreakMinutes: 3, halfTimeMinutes: 6, threeQuarterBreakMinutes: 3,
      finalsFormat: 'top4-page', divisionFinals: {}, defaultCourt: '1', autoSelectGame: true, autoSelectMinutesBefore: 15, roundLookaheadDays: 5,
      colours: { main: '#1e7cf0', dark: '#0b2a6f', panel: '#081a3f', panelAlt: '#0f2d63', highlight: '#ffd54a', accent: '#ff3d7f',
        text: '#ffffff', textOnHighlight: '#0b2a6f', muted: '#c7d8f5' },
      brandColours: [{ hex: '#1e7cf0', name: 'Elite blue' }, { hex: '#ffd54a', name: 'Gold' }, { hex: '#ff3d7f', name: 'Pink' }],
      panelOpacity: 0.92, font: 'Montserrat', competitionLogo: 'Elite Netball League.png', competitionLogoDark: '',
      clubs, teamClubs: {}, apiKey: '', apiTenant: '',
    },
    logos,
    brand: {},
  };
}

module.exports = { createWorld, template, ASSETS, COMP, CLUBS };
