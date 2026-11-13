// Small rules about PlayHQ's data that every product needs: statistic counts, statuses, genders,
// positions, periods, dates and time zones. No network and no clock except where `now` is passed.

import type { Gender, Position } from './model';

type Stat = { count?: number | null; type?: { value?: string | null } | null } | null | undefined;

/** The count of one statistic type (TOTAL_SCORE, 1_POINT_SCORE, 2_POINT_SCORE, GOAL_ATTEMPT, MISS...), null when absent. */
export function statCount(list: readonly Stat[] | null | undefined, type: string): number | null {
  const x = (list ?? []).find((s) => s?.type?.value === type);
  return x && x.count !== undefined && x.count !== null ? x.count : null;
}

/** PlayHQ's status names aren't documented: these are the ones that mean a game is over. */
export const saysFinished = (status: string | null | undefined): boolean =>
  /COMPLETE|FINAL|RESULT|FORFEIT|CLOSED|FINISH|ENDED/i.test(status ?? '');

const SAYS_NOT_FINISHED = /PROGRESS|LIVE|STARTED|UPCOMING|SCHEDULED/i;

/** The local calendar day of `d` (YYYY-MM-DD) where this code runs. */
export const localDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A game counts as finished when its status says so, or when both sides have scores, it isn't marked
 * live and its date has passed (UTC day, as Studio has always compared it).
 */
export function isFinished(
  g: { status?: string | null; date?: string | null; home: { score: number | null }; away: { score: number | null } },
  now: Date = new Date(),
): boolean {
  const st = g.status ?? '';
  if (saysFinished(st)) return true;
  if (SAYS_NOT_FINISHED.test(st)) return false;
  const today = now.toISOString().slice(0, 10);
  return g.home.score !== null && g.away.score !== null && !!g.date && g.date < today;
}

/** When a game starts, in ms, read as local time where this code runs; null without a date or time. */
export function startOf(g: { date?: string | null; time?: string | null }, date: string | null | undefined = g.date): number | null {
  const m = String(g.time ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!date || !m || !m[1] || !m[2]) return null;
  return new Date(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime();
}

/** A division's gender from PlayHQ's grade gender ("FEMALE", { value: "WOMENS" }...). */
export function gradeGenderOf(v: unknown): Gender {
  const raw = v && typeof v === 'object' ? (v as { value?: unknown; name?: unknown }).value || (v as { name?: unknown }).name : v;
  const s = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (/^(FEMALE|WOMEN|WOMENS|WOMAN|GIRLS?|LADIES)$/.test(s)) return 'female';
  if (/^(MALE|MEN|MENS|MAN|BOYS?)$/.test(s)) return 'male';
  return '';
}

/** A player's gender from whatever PlayHQ sends ("FEMALE", { value: "F" }, "Woman"...). */
export function genderOf(v: unknown): Gender {
  const raw = v && typeof v === 'object' ? (v as { value?: unknown }).value || (v as { name?: unknown }).name : v;
  const s = String(raw || '').toUpperCase();
  if (/^(F|W|G)|FEMALE|WOMAN|GIRL/.test(s)) return 'female';
  if (/^(M|B)|MAN|BOY/.test(s)) return 'male';
  return '';
}

/** Netball positions in court order, shooters first. */
export const POSITION_RANK: readonly string[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

const LONG_POSITIONS: Record<string, string> = {
  GOALSHOOTER: 'GS', GOALATTACK: 'GA', WINGATTACK: 'WA', CENTRE: 'C', CENTER: 'C',
  WINGDEFENCE: 'WD', WINGDEFENSE: 'WD', GOALDEFENCE: 'GD', GOALDEFENSE: 'GD', GOALKEEPER: 'GK',
};

/**
 * A line-up entry's position code: GS..GK, with full names ("Goal Shooter") and odd spellings tidied.
 * Anything else is passed through as given, '' when PlayHQ has none. (Studio's teams.js positionOf.)
 */
export function positionOf(p: unknown): Position {
  const e = (p ?? {}) as Record<string, unknown>;
  const first = Array.isArray(e.positions) ? e.positions[0] : undefined;
  const raw = e.playerPosition || e.position || e.positionName || first || '';
  const v = typeof raw === 'object' && raw !== null
    ? ((raw as Record<string, unknown>).abbreviation || (raw as Record<string, unknown>).shortName
      || (raw as Record<string, unknown>).value || (raw as Record<string, unknown>).name || '')
    : raw;
  const s = String(v).toUpperCase().replace(/[^A-Z]/g, '');
  return LONG_POSITIONS[s] ?? (POSITION_RANK.includes(s) ? s : String(v || ''));
}

/** PlayHQ's period names, as quarter or half numbers. */
export const PERIOD_NUMBER: Readonly<Record<string, number>> = {
  FIRST_QTR: 1, SECOND_QTR: 2, THIRD_QTR: 3, FOURTH_QTR: 4, FIRST_HALF: 1, SECOND_HALF: 2,
};

/** PlayHQ gives game times in the venue's local time without a zone: the zone for each Australian state. */
export const TIMEZONES: Readonly<Record<string, string>> = {
  WA: 'Australia/Perth',
  SA: 'Australia/Adelaide',
  NT: 'Australia/Darwin',
  QLD: 'Australia/Brisbane',
  NSW: 'Australia/Sydney',
  ACT: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  TAS: 'Australia/Hobart',
};
