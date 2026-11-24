// In-memory SelectionStore for tests and the demo page. Operations are synchronous inside, so createOnce is atomic
// per key within one JS context even when two calls start together (double-click). With a Storage-like object
// (localStorage) it persists in the browser and is labelled kind "browser"; that is demo storage only, not a database.
// Storage is re-read before every operation and written back after changes, so two stores (two tabs) on one storage
// agree on what exists. Stored records are shape-checked on load and bad ones are dropped.
import type { SelectionRecord, SelectionStore } from './select.ts';

/** The part of the Web Storage API the store needs. */
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

const STORAGE_KEY = 'aimp.selection.demo.v1';
const clone = <T>(v: T): T => structuredClone(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown) => typeof v === 'string' && v.length > 0;

/** Does this look like a SelectionRecord we wrote? Used to drop corrupt or foreign data from storage. */
export function isSelectionRecord(v: unknown): v is SelectionRecord {
  if (!isObj(v) || !s(v.key) || !s(v.workspaceId) || !s(v.ideaId) || !isObj(v.business) || !isObj(v.job) || !isObj(v.inputs)) return false;
  if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 1 || !s(v.updatedAt)) return false;
  const b = v.business, j = v.job;
  return s(b.id) && b.workspaceId === v.workspaceId && s(b.blueprintId) && typeof b.blueprintVersion === 'number' && s(b.niche) && s(b.model) && b.status === 'draft'
    && s(j.id) && j.type === 'build_business' && j.businessId === b.id && j.idempotencyKey === v.key && v.key === `select:${v.workspaceId}:${v.ideaId}`;
}

export function createMemoryStore(opts: { storage?: StorageLike } = {}): SelectionStore {
  const map = new Map<string, SelectionRecord>();
  const { storage } = opts;
  const load = () => {
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      map.clear();
      for (const r of parsed) if (isSelectionRecord(r)) map.set(r.key, r);
    } catch { /* corrupt demo data is ignored; keep what is in memory */ }
  };
  const persist = () => { if (storage) { try { storage.setItem(STORAGE_KEY, JSON.stringify([...map.values()])); } catch { /* storage full or blocked: keep working in memory */ } } };
  load();
  return {
    kind: storage ? 'browser' : 'memory',
    async createOnce(key, make) {
      load();
      const existing = map.get(key);
      if (existing) return { record: clone(existing), created: false };
      const record = make();
      map.set(key, clone(record));
      persist();
      return { record: clone(record), created: true };
    },
    async get(key) { load(); const r = map.get(key); return r ? clone(r) : undefined; },
    async update(key, change) {
      load();
      const cur = map.get(key);
      if (!cur) return undefined;
      const next = change(clone(cur));
      map.set(key, clone(next));
      persist();
      return clone(next);
    },
    async list(workspaceId) { load(); return [...map.values()].filter((r) => r.workspaceId === workspaceId).map(clone); },
  };
}
