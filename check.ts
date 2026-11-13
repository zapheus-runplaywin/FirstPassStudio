// FirstPass Studio - reading values that come from outside unchecked: a request's body, a saved file, PlayHQ's
// answers. Each gives a value of the type asked for, or the fallback.

import type { Body } from './types';

// A plain object (not null, not an array), else an empty one.
export function obj(v: unknown): Body {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Body : {};
}
// An array, else an empty one.
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
// Text: a string as it is, a number or boolean as text, anything else ''.
export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}
// A finite number (a numeric string counts), else fallback.
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
// Whether v is a plain object.
export function isObj(v: unknown): v is Body {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
