// In-memory BrandStore for tests and the demo page (AMP-020), following selection/memory-store.ts. Every read and write is
// scoped by workspace AND business, so one workspace can never see or change another's brand. `mutate` runs the change on a
// fresh copy synchronously, so two calls started together cannot interleave; if the change throws, nothing is saved.
import type { BrandProfile } from './types.ts';

/** Identifies one business across workspaces. */
export interface BusinessRef { workspaceId: string; businessId: string }

/** Thrown by `mutate` when saving would give two businesses the same approved store address. */
export class SlugTakenError extends Error {
  readonly slug: string;
  constructor(slug: string) { super(`The store address "${slug}" is already used by another business.`); this.name = 'SlugTakenError'; this.slug = slug; }
}

/** The storage seam: this memory store now, database tables later. Each method must be atomic per (workspace, business). */
export interface BrandStore {
  readonly kind: 'memory' | 'database';
  /** All versions of one business's brand, oldest first. Empty for an unknown business or another workspace. */
  list(workspaceId: string, businessId: string): Promise<BrandProfile[]>;
  /**
   * Run `change` on the current versions and save what it returns. A throw saves nothing and propagates.
   * Must throw SlugTakenError if the result gives an approved slug that another business already holds (a database store: a unique index on approved slugs).
   */
  mutate<T>(workspaceId: string, businessId: string, change: (versions: BrandProfile[]) => { versions: BrandProfile[]; result: T }): Promise<T>;
  /**
   * Is this store address held by the approved brand of any business in ANY workspace, other than `except`?
   * Store addresses are global (they become subdomains), so this is the one deliberate cross-workspace read; it returns a yes/no only.
   */
  isSlugTaken(slug: string, except: BusinessRef): Promise<boolean>;
}

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryBrandStore(): BrandStore {
  const map = new Map<string, BrandProfile[]>();
  const key = (ws: string, biz: string) => `${ws}\u0000${biz}`;
  const holder = (slug: string, ws: string, biz: string): boolean => {
    for (const [k, versions] of map) if (k !== key(ws, biz) && versions.some((v) => v.status === 'approved' && v.slug === slug)) return true;
    return false;
  };
  return {
    kind: 'memory',
    async list(ws, biz) { return clone(map.get(key(ws, biz)) ?? []); },
    async mutate(ws, biz, change) {
      const k = key(ws, biz);
      const out = change(clone(map.get(k) ?? []));
      const approved = out.versions.filter((v) => v.status === 'approved');
      if (approved.length > 1) throw new Error('A business can have only one approved brand.');
      if (out.versions.some((v) => v.workspaceId !== ws || v.businessId !== biz)) throw new Error('A brand version belongs to a different workspace or business.');
      if (approved[0] && holder(approved[0].slug, ws, biz)) throw new SlugTakenError(approved[0].slug);
      map.set(k, clone(out.versions));
      return out.result;
    },
    async isSlugTaken(slug, except) { return holder(slug, except.workspaceId, except.businessId); },
  };
}
