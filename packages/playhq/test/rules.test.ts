import { describe, expect, it } from 'vitest';
import { pickSeason } from '../src/parse';
import { genderOf, gradeGenderOf, isFinished, localDate, PERIOD_NUMBER, positionOf, saysFinished, startOf, statCount } from '../src/rules';

const stat = (type: string, count: number | null) => ({ type: { value: type }, count });

describe('statCount', () => {
  it('finds a statistic by type, null when absent or null', () => {
    const list = [stat('TOTAL_SCORE', 31), stat('1_POINT_SCORE', 0), stat('MISS', null)];
    expect(statCount(list, 'TOTAL_SCORE')).toBe(31);
    expect(statCount(list, '1_POINT_SCORE')).toBe(0);
    expect(statCount(list, 'MISS')).toBeNull();
    expect(statCount(list, 'GOAL_ATTEMPT')).toBeNull();
    expect(statCount(null, 'TOTAL_SCORE')).toBeNull();
  });
});

describe('isFinished', () => {
  const now = new Date('2026-11-13T04:00:00Z');
  const game = (status: string | null, date: string | null, home: number | null, away: number | null) => ({ status, date, home: { score: home }, away: { score: away } });

  it('trusts a status that says finished or not', () => {
    for (const s of ['COMPLETE', 'FINAL', 'RESULT_CONFIRMED', 'FORFEIT', 'CLOSED', 'FINISHED', 'ENDED']) expect(isFinished(game(s, null, null, null), now)).toBe(true);
    for (const s of ['IN_PROGRESS', 'LIVE', 'STARTED', 'UPCOMING', 'SCHEDULED']) expect(isFinished(game(s, '2026-01-01', 30, 20), now)).toBe(false);
    expect(saysFinished(undefined)).toBe(false);
  });

  it('without a known status, counts a scored game on an earlier day as finished', () => {
    expect(isFinished(game(null, '2026-11-12', 30, 20), now)).toBe(true);
    expect(isFinished(game(null, '2026-11-13', 30, 20), now)).toBe(false);
    expect(isFinished(game(null, '2026-11-12', 30, null), now)).toBe(false);
    expect(isFinished(game(null, null, 30, 20), now)).toBe(false);
  });
});

describe('startOf and localDate', () => {
  it('reads the start as local time, null without a date or time', () => {
    expect(startOf({ date: '2026-11-13', time: '19:05:00' })).toBe(new Date(2026, 10, 13, 19, 5).getTime());
    expect(startOf({ date: '2026-11-13', time: '9:30' })).toBe(new Date(2026, 10, 13, 9, 30).getTime());
    expect(startOf({ date: null, time: '19:05' })).toBeNull();
    expect(startOf({ date: '2026-11-13', time: null })).toBeNull();
    expect(startOf({ date: null, time: '19:05' }, '2026-11-14')).toBe(new Date(2026, 10, 14, 19, 5).getTime());
  });

  it('gives the local calendar day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('genders', () => {
  it('reads a division gender', () => {
    expect(gradeGenderOf({ value: 'FEMALE' })).toBe('female');
    expect(gradeGenderOf("Women's")).toBe('female');
    expect(gradeGenderOf({ name: 'Girls' })).toBe('female');
    expect(gradeGenderOf('MENS')).toBe('male');
    expect(gradeGenderOf({ value: 'MIXED' })).toBe('');
    expect(gradeGenderOf(null)).toBe('');
  });

  it('reads a player gender however PlayHQ spells it', () => {
    expect(genderOf('FEMALE')).toBe('female');
    expect(genderOf({ value: 'F' })).toBe('female');
    expect(genderOf('Woman')).toBe('female');
    expect(genderOf('MALE')).toBe('male');
    expect(genderOf({ value: 'M' })).toBe('male');
    expect(genderOf('Boy')).toBe('male');
    expect(genderOf('')).toBe('');
    expect(genderOf(undefined)).toBe('');
  });
});

describe('positionOf', () => {
  it('gives GS..GK from short or long names', () => {
    expect(positionOf({ playerPosition: { shortName: 'GS' } })).toBe('GS');
    expect(positionOf({ playerPosition: { shortName: 'gk' } })).toBe('GK');
    expect(positionOf({ position: 'Goal Shooter' })).toBe('GS');
    expect(positionOf({ positionName: 'Wing Defense' })).toBe('WD');
    expect(positionOf({ positions: [{ name: 'Centre' }] })).toBe('C');
    expect(positionOf({ playerPosition: { abbreviation: 'G.A.' } })).toBe('GA');
  });

  it('passes other codes through and gives empty when there is none', () => {
    expect(positionOf({ playerPosition: { shortName: 'PG' } })).toBe('PG');
    expect(positionOf({ playerPosition: null })).toBe('');
    expect(positionOf({})).toBe('');
    expect(positionOf(null)).toBe('');
  });
});

describe('pickSeason', () => {
  const now = Date.parse('2026-11-13T04:00:00Z');
  const seasons = [
    { id: 'old', name: 'Autumn 2026', startDate: '2026-02-01', endDate: '2026-05-30', status: { value: 'COMPLETED' } },
    { id: 'now', name: 'Spring 2026', startDate: '2026-08-01', endDate: '2026-12-20', status: { value: 'UPCOMING' } },
    { id: 'next', name: 'Summer 2027', startDate: '2027-01-10', endDate: '2027-03-20', status: { value: 'UPCOMING' } },
  ];

  it('takes the named season first', () => {
    expect(pickSeason(seasons, 'autumn', now)?.id).toBe('old');
  });

  it('else one PlayHQ says is active, else the one running today, else the latest', () => {
    expect(pickSeason([...seasons, { id: 'live', name: 'X', startDate: '2025-01-01', endDate: null, status: { value: 'ACTIVE' } }], null, now)?.id).toBe('live');
    expect(pickSeason(seasons, 'no such season', now)?.id).toBe('now');
    expect(pickSeason(seasons, null, Date.parse('2030-01-01'))?.id).toBe('next');
    expect(pickSeason([], null, now)).toBeUndefined();
  });
});

it('numbers quarters and halves', () => {
  expect(PERIOD_NUMBER.FOURTH_QTR).toBe(4);
  expect(PERIOD_NUMBER.SECOND_HALF).toBe(2);
});
