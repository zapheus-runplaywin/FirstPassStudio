// A small cache for PlayHQ answers, in the way Studio has always kept them: an answer younger than
// maxAgeMs is given straight back; one request at a time per key; and when PlayHQ fails, the last
// good answer is given with `stale` saying why (graphics keep showing), and PlayHQ is asked again
// next time. Memory only: saving to disk is the product's choice.

export type Kept<V> = {
  value: V;
  /** When this value was read from PlayHQ (ms). */
  at: number;
  /** Set when PlayHQ failed and this is the last good answer instead. */
  stale?: Error;
};

export type Keeper<K, V> = ReturnType<typeof createKeeper<K, V>>;

export function createKeeper<K, V>(options: { now?: () => number; max?: number } = {}) {
  const now = options.now ?? Date.now;
  const kept = new Map<K, { at: number; value: V }>();
  const inFlight = new Map<K, Promise<{ at: number; value: V }>>();

  /**
   * The value for key: kept when younger than maxAgeMs, else loaded. A load that fails gives the
   * last good value with stale set, or throws when there is none.
   */
  async function get(key: K, maxAgeMs: number, load: () => Promise<V>): Promise<Kept<V>> {
    const hit = kept.get(key);
    if (hit && now() - hit.at < maxAgeMs) return { ...hit };
    let pending = inFlight.get(key);
    if (!pending) {
      pending = load().then((value) => {
        const entry = { at: now(), value };
        kept.delete(key); // newest last, for max
        kept.set(key, entry);
        if (options.max) while (kept.size > options.max) kept.delete(kept.keys().next().value as K);
        return entry;
      });
      const settle = () => { inFlight.delete(key); };
      pending.then(settle, settle);
      inFlight.set(key, pending);
    }
    try {
      return { ...(await pending) };
    } catch (err) {
      if (!hit) throw err;
      return { ...hit, stale: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return {
    get,
    /** The kept value, however old, without asking PlayHQ. */
    peek: (key: K): Kept<V> | undefined => {
      const hit = kept.get(key);
      return hit ? { ...hit } : undefined;
    },
    set: (key: K, value: V, at: number = now()) => { kept.set(key, { at, value }); },
    delete: (key: K) => kept.delete(key),
    clear: () => { kept.clear(); },
    get size() { return kept.size; },
  };
}
