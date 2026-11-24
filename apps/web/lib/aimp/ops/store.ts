// P01 in-memory stores and the rate limiter. A database audit store is NOT built; these are the fixtures behind the interfaces.
import type { AuditEntry, AuditStore, LimitResult, RateLimiter, RecoveryRecord, RecoveryStore } from './types.ts';

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); }
  return v;
}

export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 200;
/** Most entries the unattributed list will hold. When full, new entries are refused and counted (never overwritten). */
export const MAX_UNATTRIBUTED = 500;

/** Any caller-supplied limit becomes an integer from 1 to MAX_AUDIT_LIMIT. NaN, Infinity and non-numbers give the default. */
export function boundedLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_AUDIT_LIMIT;
  return Math.min(MAX_AUDIT_LIMIT, Math.max(1, n));
}

export type MemoryAuditStore = AuditStore & { droppedUnattributed(): number };

export function createMemoryAuditStore(opts: { maxUnattributed?: number } = {}): MemoryAuditStore {
  const byTenant = new Map<string, AuditEntry[]>();
  const unattributed: AuditEntry[] = [];
  const cap = opts.maxUnattributed ?? MAX_UNATTRIBUTED;
  let dropped = 0;
  return {
    async append(entry) {
      const copy = deepFreeze(structuredClone(entry));
      const list = byTenant.get(copy.workspaceId) ?? [];
      list.push(copy);
      byTenant.set(copy.workspaceId, list);
    },
    async list(workspaceId, o) {
      const all = byTenant.get(workspaceId) ?? [];
      const rows = o.businessId === undefined ? all : all.filter((e) => e.businessId === o.businessId);
      // Entries are frozen copies, so handing them out cannot change what is stored.
      return rows.slice(-boundedLimit(o.limit)).reverse();
    },
    async appendUnattributed(entry) {
      if (unattributed.length >= cap) { dropped += 1; return false; }
      unattributed.push(deepFreeze(structuredClone(entry)));
      return true;
    },
    async listUnattributed(limit) { return unattributed.slice(-boundedLimit(limit)).reverse(); },
    droppedUnattributed: () => dropped,
  };
}

export function createMemoryRecoveryStore(): RecoveryStore {
  const map = new Map<string, RecoveryRecord>();
  const key = (w: string, j: string) => JSON.stringify([w, j]);
  return {
    async get(w, j) { const r = map.get(key(w, j)); return r ? { ...r } : null; },
    async put(rec) { map.set(key(rec.workspaceId, rec.jobId), { ...rec }); },
  };
}

export const RECOVERY_LIMIT = 10;
export const RECOVERY_WINDOW_MS = 60_000;
export const DEFAULT_MAX_LIMITER_KEYS = 1_000;

export interface RateLimiterOptions { now: () => number; limit: number; windowMs: number; maxKeys?: number }

/** Fixed window per (tenant, action). Expired windows are dropped on every check; at the key cap the oldest counter is evicted
 *  (a flood of new tenants cannot grow memory without bound; the cost is that an evicted tenant gets a fresh window). */
export function createRateLimiter(o: RateLimiterOptions): RateLimiter {
  const maxKeys = Math.max(1, o.maxKeys ?? DEFAULT_MAX_LIMITER_KEYS);
  const windows = new Map<string, { start: number; count: number }>();
  const sweep = (t: number) => { for (const [k, w] of windows) if (t >= w.start + o.windowMs) windows.delete(k); };
  return {
    check(tenantKey, action): LimitResult {
      const t = o.now();
      const key = JSON.stringify([tenantKey, action]);
      const w = windows.get(key);
      // A clock that steps backwards stays inside the current window: it must not reset the quota.
      if (w && t < w.start + o.windowMs) {
        if (w.count >= o.limit) return { ok: false, retryAfterSeconds: Math.min(Math.ceil(o.windowMs / 1000), Math.max(1, Math.ceil((w.start + o.windowMs - t) / 1000))) };
        w.count += 1;
        return { ok: true, remaining: o.limit - w.count };
      }
      windows.delete(key);
      sweep(t);
      while (windows.size >= maxKeys) { const oldest = windows.keys().next().value; if (oldest === undefined) break; windows.delete(oldest); }
      windows.set(key, { start: t, count: 1 });
      return { ok: true, remaining: o.limit - 1 };
    },
    size: () => windows.size,
  };
}
