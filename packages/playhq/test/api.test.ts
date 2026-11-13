// The questions FirstPass asks PlayHQ, against the stand-in season (world.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { createPlayhqApi, type ApiOptions, type Learned } from '../src/api';
import { collectFixtures, type RawGradeRound } from '../src/parse';
import { createTransport } from '../src/transport';
import { createWorld, fakeFetch, NOW, ORG_ID, type World } from './world';

let world: World;
beforeEach(() => { world = createWorld(); });
const api = (options: ApiOptions = {}) => createPlayhqApi(createTransport({ fetch: fakeFetch(world), now: () => NOW }), options);
const asked = (op: string) => world.calls.filter((c) => c.operationName === op);
const refuseField = (field: string) => ({ status: 400, body: { errors: [{ message: `Cannot query field "${field}" on type "X".` }] } });

describe('competitions and seasons', () => {
  it('lists an organisation\'s competitions and seasons', async () => {
    const list = await api().competitions(ORG_ID);
    expect(list.map((c) => c.name)).toEqual(['Thunder League', 'Summer Social']);
    expect(list[0]!.seasons.map((s) => s.id)).toEqual(['season-old', 'season-now']);
    expect(list[0]!.organisation?.name).toBe('West Coast Mens and Mixed Netball Association');
    expect(await api().competitions('00000000')).toEqual([]);
  });

  it('reads a season\'s divisions in name order with their genders', async () => {
    const s = await api().season('season-now');
    expect(s.season).toEqual({ id: 'season-now', name: 'Spring 2026' });
    expect(s.competition).toEqual({ id: 'comp-tl', name: 'Thunder League' });
    expect(s.organisation?.id).toBe(ORG_ID);
    expect(s.grades).toEqual([
      { division: 1, id: 'grade-div1', name: 'Division 1', gender: '' },
      { division: 2, id: 'grade-div2', name: 'Division 2', gender: 'male' },
    ]);
  });

  it('reads the divisions without gender once PlayHQ refuses it, and remembers', async () => {
    const learnt: string[] = [];
    world.answers.gradeListDiscoverSeason = ({ query }) => /gender/.test(query) && refuseField('gender');
    const a = api({ onLearn: (_l, why) => learnt.push(why) });
    expect((await a.season('season-now')).grades.map((g) => g.gender)).toEqual(['', '']);
    await a.season('season-now');
    expect(asked('gradeListDiscoverSeason')).toHaveLength(3); // refused, without, without
    expect(a.learned().seasonGender).toBe(false);
    expect(learnt[0]).toMatch(/^Division gender unavailable/);
  });

  it('fails clearly when there is no such season, or PlayHQ refuses for another reason', async () => {
    world.answers.gradeListDiscoverSeason = () => ({ body: { data: { discoverSeason: null } } });
    await expect(api().season('nope')).rejects.toThrow('PlayHQ has no season with id nope.');
    world.answers.gradeListDiscoverSeason = () => ({ status: 500, body: 'down' });
    await expect(api({ learned: { seasonGender: false } }).season('x')).rejects.toThrow('HTTP 500');
  });
});

describe('ladder', () => {
  it('reads each pool\'s standings with PlayHQ\'s team ids', async () => {
    const l = await api().ladder('grade-div1');
    expect(l.grade).toBe('Division 1');
    expect(l.pools).toHaveLength(1);
    const top = l.pools[0]![0]!;
    expect(top).toMatchObject({ position: 1, team: 'Blizzardz', teamId: 'team-blizzardz', played: 2, won: 2, lost: 0, points: 8 });
    expect(l.pools[0]!.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it('drops a column PlayHQ doesn\'t know for the sport, and starts without it next time', async () => {
    world.answers.gradeLadder = ({ query }) => /\bforfeits\b/.test(query) && refuseField('forfeits');
    let saved: Learned | undefined;
    const l = await api({ onLearn: (learned) => { saved = learned; } }).ladder('grade-div1');
    expect(l.pools[0]![0]!.forfeits).toBeUndefined();
    expect(l.pools[0]![0]!.won).toBe(2);
    expect(saved?.unknownLadderFields).toEqual(['forfeits']);
    world.calls.length = 0;
    await api({ learned: saved! }).ladder('grade-div1');
    expect(asked('gradeLadder')).toHaveLength(1);
  });

  it('gives up on an error that names no ladder column', async () => {
    world.answers.gradeLadder = () => refuseField('standings');
    await expect(api().ladder('grade-div1')).rejects.toThrow('Cannot query field "standings"');
    world.answers.gradeLadder = () => ({ status: 503, body: 'x' });
    await expect(api().ladder('grade-div1')).rejects.toThrow('HTTP 503');
  });

  it('gives empty pools for a division with no ladder', async () => {
    expect(await api().ladder('grade-none')).toEqual({ grade: '', pools: [] });
    world.answers.gradeLadder = () => ({ body: { data: { discoverGrade: { name: 'D', ladder: { standings: [{ team: { id: 't', name: 'T' }, played: null }] } } } } });
    expect(await api().ladder('x')).toEqual({ grade: 'D', pools: [[{ position: 1, team: 'T', teamId: 't', played: null }]] });
  });
});

describe('rounds and fixtures', () => {
  it('reads a division\'s rounds', async () => {
    const rounds = await api().rounds('grade-div1');
    expect(rounds.map((r) => [r.name, r.number, r.current])).toEqual([['Round 1', 1, false], ['Round 2', 2, false], ['Round 3', 3, true], ['Round 4', 4, false]]);
    expect(await api().rounds('nope')).toEqual([]);
  });

  it('reads a round\'s games with venue, court, scores and outcomes', async () => {
    const games = await api().roundGames('grade-div1-r1');
    expect(games[0]).toEqual({
      id: 'game-d1-r1-1', roundId: 'grade-div1-r1', status: 'FINAL', date: '2026-10-30', time: '03:00:00', court: 'Court 1', venue: 'Gold Netball Centre',
      home: { name: 'Blizzardz', id: 'team-blizzardz', score: 30, outcome: 'WON' },
      away: { name: 'Knights', id: 'team-knights', score: 25, outcome: 'LOST' },
    });
    const today = await api().roundGames('grade-div1-r3');
    expect(today[0]!.home).toEqual({ name: 'Blizzardz', id: 'team-blizzardz', score: null, outcome: null });
  });

  it('names an undecided final\'s team TBC, and takes the first of several dates', async () => {
    world.answers.discoverFixtureByRound = () => ({ body: { data: { discoverFixtureByRound: { games: [
      { id: 'f1', date: null, dates: ['2026-12-01', '2026-12-02'], status: null, home: { __typename: 'ProvisionalTeam', name: '' }, away: null, result: null, allocation: null },
    ] } } } });
    expect(await api().roundGames('r')).toEqual([{
      id: 'f1', roundId: 'r', status: null, date: '2026-12-01', time: null, court: '', venue: '',
      home: { name: 'TBC', id: null, score: null, outcome: null }, away: { name: 'TBC', id: null, score: null, outcome: null },
    }]);
    world.answers.discoverFixtureByRound = () => ({ body: { data: { discoverFixtureByRound: null } } });
    expect(await api().roundGames('r')).toEqual([]);
  });
});

describe('one game in detail', () => {
  it('reads line ups in court order with positions, captains and shooting', async () => {
    const g = await api().game('game-d1-r1-1');
    expect(g).toMatchObject({ id: 'game-d1-r1-1', status: 'FINAL', date: '2026-10-30' });
    expect(g.home).toMatchObject({ name: 'Blizzardz', id: 'team-blizzardz', score: 30, totals: null });
    expect(g.home.players.map((p) => p.position)).toEqual(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
    expect(g.home.players[0]).toEqual({
      name: 'Blizzardz GS', number: '1', playhqId: 'Blizzardz-GS', gender: 'male', position: 'GS', private: false, captain: false, viceCaptain: false,
      shooting: { goals: 14, superGoals: 1, shots: 18, points: 16 },
    });
    expect(g.home.players[2]).toMatchObject({ position: 'WA', captain: true, shooting: { goals: 0, superGoals: 0, shots: null, points: 0 } });
    expect(g.away.score).toBe(25);
  });

  it('gives a game being scored its running total, and none before any score', async () => {
    world.live['game-d1-r3-1']!.home = 7;
    const g = await api().game('game-d1-r3-1');
    expect(g.home.score).toBe(7);
    const later = await api().game('game-d1-r4-1');
    expect(later.home).toEqual({ name: 'Knights', id: 'team-knights', score: null, totals: null, players: [] });
  });

  it('adds up team goals when there is no total, keeps team counts, and marks private and vice-captain players', async () => {
    world.answers.discoverGame = () => ({ body: { data: { discoverGame: {
      id: 'g', date: null, status: { value: 'IN_PROGRESS' }, home: { id: 'h', name: 'H' }, away: { name: 'A' }, result: null,
      statistics: {
        home: {
          statistics: [{ type: { value: '1_POINT_SCORE' }, count: 10 }, { type: { value: '2_POINT_SCORE' }, count: 2 }, { type: { value: 'GOAL_ATTEMPT' }, count: 19 }],
          players: [
            { playerNumber: 12, player: { __typename: 'DiscoverAnonymousParticipant', id: 'p1', name: 'Private Player' }, statistics: [], playerPosition: { shortName: 'Goal Keeper' }, captain: { name: 'Vice Captain' } },
            { player: { __typename: 'DiscoverRegularFillInPlayer', id: 'p2', name: 'Fill In' }, playerPosition: null, captain: null },
            { player: { __typename: 'DiscoverParticipant', id: 'p3', profile: { firstName: '', lastName: '' } } },
          ],
        },
        away: null,
      },
    } } } });
    const g = await api().game('g');
    expect(g.home.score).toBe(14);
    expect(g.home.totals).toEqual({ goals: 10, superGoals: 2, shots: 19 });
    expect(g.home.players.map((p) => [p.name, p.position, p.private, p.captain, p.viceCaptain, p.number])).toEqual([
      ['Private Player', 'GK', true, false, true, '12'],
      ['Fill In', '', false, false, false, ''],
    ]);
    expect(g.away).toEqual({ name: 'A', id: null, score: null, totals: null, players: [] });
  });

  it('takes the product\'s position rule', async () => {
    const g = await api({ positionOf: () => 'X' }).game('game-d1-r1-1');
    expect(new Set(g.home.players.map((p) => p.position))).toEqual(new Set(['X']));
  });

  it('tries each player gender spelling until PlayHQ accepts one, and remembers it', async () => {
    world.answers.discoverGame = ({ query }) => (/profile \{ firstName lastName gender \}/.test(query) || /gender \{ value \}/.test(query)) && refuseField('gender');
    const learnt: Learned[] = [];
    const a = api({ onLearn: (l) => learnt.push(l) });
    const g = await a.game('game-d1-r1-1');
    expect(g.home.players).toHaveLength(7);
    expect(asked('discoverGame')).toHaveLength(3);
    expect(asked('discoverGame')[2]!.query).not.toMatch(/gender/);
    expect(a.learned().genderField).toBe('');
    expect(learnt.map((l) => l.genderField)).toEqual(['gender { value }', '']);
    world.calls.length = 0;
    await api({ learned: { genderField: '' } }).game('game-d1-r1-1');
    expect(asked('discoverGame')).toHaveLength(1);
  });

  it('fails once every spelling is refused, or when there is no such game', async () => {
    world.answers.discoverGame = () => refuseField('players');
    await expect(api({ learned: { genderField: '' } }).game('g')).rejects.toThrow('Cannot query field "players"');
    world.answers.discoverGame = () => null;
    await expect(api().game('nope')).rejects.toThrow('PlayHQ has no game nope');
    // A learned spelling that isn't one of ours starts from the first.
    await api({ learned: { genderField: 'sex' } }).game('game-d1-r1-1');
    expect(world.calls.at(-1)!.query).toMatch(/lastName gender \}/);
  });
});

describe('live feed', () => {
  it('reads the running score, counts, clock and quarter of a game being scored', async () => {
    Object.assign(world.live['game-d1-r3-1']!, { home: 9, homeGoals: 7, homeSuper: 1, period: 'SECOND_QTR' });
    const l = await api().live('game-d1-r3-1');
    expect(l).toEqual({
      id: 'game-d1-r3-1', status: 'IN_PROGRESS', period: 'SECOND_QTR', break: null,
      home: { score: 9, goals: 7, superGoals: 1, shots: 11, misses: 3 },
      away: { score: 0, goals: 0, superGoals: 0, shots: 3, misses: 3 },
      clock: { period: 'SECOND_QTR', periodValue: 'SECOND_QTR', status: 'RESUME', time: '07:30', lastUpdatedAt: String(NOW) },
    });
  });

  it('takes the period from the result when there is no clock (a finished game)', async () => {
    const l = await api().live('game-d1-r1-1');
    expect(l.clock).toBeNull();
    expect(l.period).toBe('FOURTH_QTR');
    expect(l.home.score).toBe(30);
  });

  it('says when PlayHQ isn\'t scoring a game yet, apart from other errors', async () => {
    await expect(api().live('game-d1-r4-1')).rejects.toMatchObject({ notScored: true, message: "PlayHQ isn't scoring this game yet." });
    world.answers.live = () => ({ body: { errors: [{ message: 'Internal' }, { message: 'Oops' }] } });
    await expect(api().live('g')).rejects.toMatchObject({ message: 'Internal; Oops' });
    world.answers.live = () => ({ body: { data: { game: null } } });
    await expect(api().live('g')).rejects.toThrow('PlayHQ live feed has no game g');
  });

  it('falls back to the team total when the result has none', async () => {
    world.answers.live = () => ({ body: { data: { game: { id: 'g', statistics: { home: { statisticsV2: [{ type: { value: 'TOTAL_SCORE' }, count: 4 }] } }, result: null } } } });
    const l = await api().live('g');
    expect(l.home.score).toBe(4);
    expect(l.away).toEqual({ score: null, goals: null, superGoals: null, shots: null, misses: null });
    expect(l.period).toBeNull();
  });
});

// HQ's fixture import (supabase/functions/playhq): the cases from its fixtures.test.ts.
describe('season fixtures (HQ import)', () => {
  const round = (over: Partial<RawGradeRound> = {}): RawGradeRound => ({ id: 'r1', name: 'Round 1', isFinalsRound: false, byes: [], games: [], ...over });

  it('turns rounds into teams and dated games, with the venue state\'s time zone', () => {
    const { teams, games } = collectFixtures([{ grade: { id: 'g', name: '17/U Girls' }, rounds: [round({
      games: [
        { id: 'm1', status: { value: 'UPCOMING' }, date: '2026-05-02', home: { id: 't1', name: 'Thunder' }, away: { id: 't2', name: 'Lightning' }, allocation: { time: '09:00:00', court: { name: 'Court 3', venue: { name: 'Arena', state: 'VIC' } } } },
        { id: 'm2', date: '2026-05-02', home: { id: 't3', name: 'Storm' }, away: { id: 't4', name: 'Rain' }, allocation: { time: null, court: { name: 'C1', venue: { name: 'Hall', state: 'XX' } } } },
        { id: 'm3', date: null, home: { id: 't5', name: 'Late' }, away: { id: 't1', name: 'Thunder' } },
      ],
    })] }]);
    expect(games[0]).toEqual({
      id: 'm1', date: '2026-05-02', time: '09:00:00', timezone: 'Australia/Melbourne', round: 'Round 1', is_final: false,
      grade: '17/U Girls', venue: 'Arena', court: 'Court 3', status: 'UPCOMING', home: { id: 't1', name: 'Thunder' }, away: { id: 't2', name: 'Lightning' },
    });
    expect(games[1]!.timezone).toBe('Australia/Perth');
    expect(games.map((g) => g.id)).toEqual(['m1', 'm2']); // undated m3 skipped
    expect([...teams.keys()]).toEqual(['t1', 't2', 't3', 't4', 't5']); // but its teams kept
  });

  it('adds a row per bye dated the round\'s first game, and leaves undecided finals teams out', () => {
    const { teams, games } = collectFixtures([{ grade: { id: 'g', name: 'Open' }, rounds: [
      round({ id: 'r9', name: 'Grand Final', isFinalsRound: true, byes: [{ id: 't9', name: 'Bye Team' }], games: [
        { id: 'gf', date: '2026-09-01', home: { name: 'Winner SF1' }, away: { name: 'Winner SF2' } },
      ] }),
      round({ id: 'r10', byes: [{ id: 't9', name: 'Bye Team' }], games: [] }),
    ] }]);
    expect(games).toEqual([
      expect.objectContaining({ id: 'gf', is_final: true, home: null, away: null }),
      { id: 'bye-r9-t9', date: '2026-09-01', time: null, timezone: 'Australia/Perth', round: 'Grand Final', is_final: true, grade: 'Open', venue: null, court: null, status: 'BYE', home: { id: 't9', name: 'Bye Team' }, away: null },
    ]);
    expect([...teams.values()]).toEqual([{ id: 't9', name: 'Bye Team', grade: 'Open' }]);
  });

  it('reads a whole season through PlayHQ, every division\'s fixture', async () => {
    world.answers.gradeFixture = ({ variables }) => ({ body: { data: { discoverGradeFixture: variables.gradeID === 'grade-div1'
      ? [round({ games: [{ id: 'm1', date: '2026-05-02', home: { id: 'b', name: 'Blizzardz' }, away: { id: 'a', name: 'Knights' } }] })]
      : null } } });
    const s = await api().seasonFixtures('ec69e46d');
    expect(s.id).toBe('ec69e46d');
    expect(s.name).toBe('Thunder League · Spring 2026');
    expect(s.teams.map((t) => t.name)).toEqual(['Blizzardz', 'Knights']);
    expect(s.games.map((g) => g.id)).toEqual(['m1']);
    expect(s.grades).toEqual([{ id: 'grade-div1', name: 'Division 1', rounds: 1, games: 1 }, { id: 'grade-div2', name: 'Division 2', rounds: 0, games: 0 }]);
  });
});
