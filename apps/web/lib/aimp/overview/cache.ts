// AMP-091 cached overview snapshot. Build once, serve from cache, say when it was refreshed, and call it stale after a set age so the
// `data_stale` state can show. Keyed per workspace + business. The clock is injected. In-memory (per server process).
//
// Policy: a cached snapshot is served as is; it is replaced only by `refresh()` or, when `refreshAfterMs` is set, by the next `get()`
// after that age. If an automatic refresh fails and an older snapshot exists, the older one is served (and ages into `data_stale`);
// an explicit `refresh()` that fails throws. A failed first build is never cached.
import { buildBusinessOverview } from './build.ts';
import { collectOverviewSnapshot } from './collect.ts';
import { isPlainId, OverviewError } from './errors.ts';
import { STALE_AFTER_MS } from './types.ts';
import type { BusinessOverview, OverviewDeps, OverviewScope, OverviewSnapshot } from './types.ts';

export interface CachedOverview {
  overview: BusinessOverview;
  /** ISO time this snapshot was read from the sources (when the cache entry was filled). */
  refreshedAt: string;
  /** Milliseconds since `refreshedAt`. */
  ageMs: number;
  /** Older than the configured stale age. Same as `overview.flags.stale` unless the data's own time (`freshness`) is older. */
  stale: boolean;
  fromCache: boolean;
  /** The latest automatic re-read failed and this is the older snapshot being served. Cleared by the next successful read. */
  refreshFailed: boolean;
  /** ISO time of that failed re-read, else null. No error text is kept. */
  lastRefreshErrorAt: string | null;
}

export interface OverviewCacheOptions {
  deps: OverviewDeps;
  /** Stale after this many ms. Default STALE_AFTER_MS (15 minutes). Must be a positive finite number. */
  staleAfterMs?: number;
  /** When set, `get()` re-reads once the entry is this old. Default: never (explicit `refresh()` only). */
  refreshAfterMs?: number;
  /** Most businesses kept; the oldest entry is dropped past this. Default 500. */
  maxEntries?: number;
  /** Defaults to `deps.now`. */
  now?: () => Date;
}

export interface OverviewCache {
  get(scope: OverviewScope): Promise<CachedOverview>;
  refresh(scope: OverviewScope): Promise<CachedOverview>;
  /** Drop one business's entry (the next `get()` rebuilds). */
  invalidate(scope: OverviewScope): void;
  size(): number;
}

interface Entry { snapshot: OverviewSnapshot; refreshedAtMs: number }

const keyOf = (s: OverviewScope) => `${s.workspaceId}/${s.businessId}`;

export function createOverviewCache(opts: OverviewCacheOptions): OverviewCache {
  const staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error('staleAfterMs must be a positive number');
  if (opts.refreshAfterMs !== undefined && (!Number.isFinite(opts.refreshAfterMs) || opts.refreshAfterMs <= 0)) throw new Error('refreshAfterMs must be a positive number');
  const maxEntries = opts.maxEntries ?? 500;
  const now = opts.now ?? opts.deps.now;
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<Entry>>();

  const checked = (scope: OverviewScope): OverviewScope => {
    if (!scope || !isPlainId(scope.workspaceId) || !isPlainId(scope.businessId)) throw new OverviewError('A workspace and a business are required.');
    return { workspaceId: scope.workspaceId, businessId: scope.businessId };
  };

  // Per-key generation: invalidate() and refresh() bump it, so a load that started earlier cannot write over newer state.
  const generation = new Map<string, number>();
  // Time (ms) of the latest failed automatic re-read per key. Time only, never error text.
  const refreshFailedAt = new Map<string, number>();
  const gen = (k: string) => generation.get(k) ?? 0;

  const load = (s: OverviewScope, force = false): Promise<Entry> => {
    const k = keyOf(s);
    const running = inflight.get(k);
    if (running && !force) return running; // concurrent callers share one read
    if (force) generation.set(k, gen(k) + 1); // an older in-flight load must not overwrite this one
    const myGen = gen(k);
    const p: Promise<Entry> = (async () => {
      const snapshot = await collectOverviewSnapshot({ ...opts.deps, now }, s);
      const entry: Entry = { snapshot: structuredClone(snapshot), refreshedAtMs: now().getTime() };
      if (gen(k) !== myGen) return entry; // superseded by invalidate()/refresh(): serve to our callers, do not store
      entries.delete(k);
      entries.set(k, entry);
      refreshFailedAt.delete(k);
      while (entries.size > maxEntries) { const oldest = entries.keys().next().value; if (oldest === undefined) break; entries.delete(oldest); refreshFailedAt.delete(oldest); generation.delete(oldest); }
      return entry;
    })().finally(() => { if (inflight.get(k) === p) inflight.delete(k); });
    inflight.set(k, p);
    return p;
  };

  const present = (e: Entry, fromCache: boolean, k: string): CachedOverview => {
    const at = now();
    const ageMs = Math.max(0, at.getTime() - e.refreshedAtMs);
    // The overview is built from the cached snapshot: nothing is re-read, so `generatedAt` moves but the data does not.
    const overview = buildBusinessOverview(structuredClone(e.snapshot), at, { staleAfterMs });
    const failedAt = refreshFailedAt.get(k);
    return {
      overview, refreshedAt: new Date(e.refreshedAtMs).toISOString(), ageMs, stale: overview.flags.stale || ageMs > staleAfterMs, fromCache,
      refreshFailed: fromCache && failedAt !== undefined,
      lastRefreshErrorAt: fromCache && failedAt !== undefined ? new Date(failedAt).toISOString() : null,
    };
  };

  return {
    async get(scope) {
      const s = checked(scope); const k = keyOf(s);
      const cached = entries.get(k);
      if (!cached) return present(await load(s), false, k);
      if (opts.refreshAfterMs !== undefined && now().getTime() - cached.refreshedAtMs > opts.refreshAfterMs) {
        try { return present(await load(s), false, k); } catch { refreshFailedAt.set(k, now().getTime()); return present(cached, true, k); }
      }
      return present(cached, true, k);
    },
    async refresh(scope) { const s = checked(scope); return present(await load(s, true), false, keyOf(s)); },
    invalidate(scope) { const k = keyOf(checked(scope)); generation.set(k, gen(k) + 1); entries.delete(k); refreshFailedAt.delete(k); inflight.delete(k); },
    size: () => entries.size,
  };
}
