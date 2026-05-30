// A tiny short-TTL in-memory cache for the Fastify server layer.
//
// This is purely a UI/transport-layer optimization: it memoizes the result of
// expensive read fan-outs (e.g. /api/status, /api/discover) for a few seconds so
// repeat dashboard loads are instant, and is wiped whenever the server performs a
// state-changing mutation. core/modules stay completely unaware of caching.

export interface TtlCache {
  /** Returns the cached value for `key`, or computes + caches it if absent/expired. */
  getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T>;
  /** Drops every cached entry (call after any state-changing mutation). */
  invalidateAll(): void;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export function createTtlCache(ttlMs: number, now: () => number = Date.now): TtlCache {
  const entries = new Map<string, Entry>();

  return {
    async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        return existing.value as T;
      }
      const value = await compute();
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    },

    invalidateAll(): void {
      entries.clear();
    },
  };
}
