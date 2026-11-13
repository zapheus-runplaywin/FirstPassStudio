import { describe, expect, it } from 'vitest';
import { createKeeper } from '../src/keep';

describe('createKeeper', () => {
  it('gives a value younger than maxAgeMs without loading, and loads again once it is older', async () => {
    let t = 1000;
    const keep = createKeeper<string, number>({ now: () => t });
    let loads = 0;
    const load = async () => ++loads;
    expect(await keep.get('a', 5000, load)).toEqual({ value: 1, at: 1000 });
    t += 4999;
    expect((await keep.get('a', 5000, load)).value).toBe(1);
    t += 1;
    expect(await keep.get('a', 5000, load)).toEqual({ value: 2, at: 6000 });
  });

  it('asks once for the same key at the same time', async () => {
    const keep = createKeeper<string, string>();
    let loads = 0;
    let release!: (v: string) => void;
    const load = () => { loads++; return new Promise<string>((r) => { release = r; }); };
    const a = keep.get('k', 0, load);
    const b = keep.get('k', 0, load);
    release('x');
    expect((await a).value).toBe('x');
    expect((await b).value).toBe('x');
    expect(loads).toBe(1);
  });

  it('gives the last good value marked stale when a load fails, and loads again next time', async () => {
    let t = 0;
    const keep = createKeeper<string, string>({ now: () => t });
    await keep.get('k', 0, async () => 'good');
    t = 10;
    const kept = await keep.get('k', 0, async () => { throw new Error('PlayHQ answered HTTP 503'); });
    expect(kept.value).toBe('good');
    expect(kept.at).toBe(0);
    expect(kept.stale?.message).toBe('PlayHQ answered HTTP 503');
    const fresh = await keep.get('k', 0, async () => 'better');
    expect(fresh).toEqual({ value: 'better', at: 10 });
  });

  it('throws when a load fails and nothing was kept', async () => {
    const keep = createKeeper<string, string>();
    await expect(keep.get('k', 0, async () => { throw new Error('down'); })).rejects.toThrow('down');
    // A non-Error is still given as an Error when stale.
    await keep.get('j', 0, async () => 'ok');
    expect((await keep.get('j', 0, () => Promise.reject('plain'))).stale?.message).toBe('plain');
  });

  it('keeps at most max values, dropping the oldest read', async () => {
    const keep = createKeeper<number, number>({ max: 2 });
    for (const k of [1, 2, 3]) await keep.get(k, 1e9, async () => k);
    expect(keep.size).toBe(2);
    expect(keep.peek(1)).toBeUndefined();
    expect(keep.peek(3)?.value).toBe(3);
  });

  it('can be set, peeked, deleted and cleared', () => {
    const keep = createKeeper<string, number>({ now: () => 5 });
    keep.set('a', 1);
    keep.set('b', 2, 1);
    expect(keep.peek('a')).toEqual({ value: 1, at: 5 });
    expect(keep.peek('b')).toEqual({ value: 2, at: 1 });
    keep.delete('a');
    expect(keep.peek('a')).toBeUndefined();
    keep.clear();
    expect(keep.size).toBe(0);
  });
});
