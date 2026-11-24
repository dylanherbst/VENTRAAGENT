// In-memory CatalogueStore and cover asset registry for tests and the demo page (AMP-023), following branding/store.ts.
// Every read and write is scoped by workspace, so one workspace can never see or change another's listing. `mutate` runs the
// change on a fresh copy synchronously, so two calls started together cannot interleave; if it throws, nothing is saved.
import { CatalogueError } from './types.ts';
import type { CatalogueListing, CatalogueStore, CoverAsset, CoverAssetSource } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryCatalogueStore(): CatalogueStore {
  const map = new Map<string, CatalogueListing[]>();
  const key = (ws: string, id: string) => `${ws}\u0000${id}`;
  return {
    kind: 'memory',
    async list(ws, id) { return clone(map.get(key(ws, id)) ?? []); },
    async listByBusiness(ws, businessId) {
      return clone([...map.values()].flat().filter((v) => v.workspaceId === ws && v.businessId === businessId));
    },
    async mutate(ws, id, change) {
      const out = change(clone(map.get(key(ws, id)) ?? []));
      const vs = out.versions;
      if (vs.some((v) => v.workspaceId !== ws || v.listingId !== id)) throw new CatalogueError('conflict', 'A listing version belongs to a different workspace or listing.');
      if (vs.filter((v) => v.status === 'approved').length > 1) throw new CatalogueError('conflict', 'A listing can have only one approved version.');
      if (vs.filter((v) => v.status === 'draft').length > 1) throw new CatalogueError('conflict', 'A listing can have only one open draft.');
      if (new Set(vs.map((v) => v.version)).size !== vs.length) throw new CatalogueError('conflict', 'Two versions of a listing cannot share a number.');
      for (const v of vs) {
        if (!Number.isInteger(v.priceMinor) || v.priceMinor < 0) throw new CatalogueError('conflict', 'A stored price must be whole cents.');
        if (v.status === 'approved' && !(v.cover && v.cover.role !== 'master' && v.approvedAt && v.approvedBy)) throw new CatalogueError('conflict', 'An approved listing needs a public cover and its approval record.');
      }
      map.set(key(ws, id), clone(vs));
      return out.result;
    },
  };
}

/** Registry of public images per product. Production: the files service's preview/cover rows. */
export function createMemoryCoverAssets(): CoverAssetSource & { add(asset: CoverAsset): void } {
  const assets = new Map<string, CoverAsset>();
  const key = (ws: string, id: string) => `${ws}\u0000${id}`;
  return {
    add(asset) { assets.set(key(asset.workspaceId, asset.id), clone(asset)); },
    async get(ws, id) { const a = assets.get(key(ws, id)); return a ? clone(a) : null; },
    async listForProduct(ws, productId) { return clone([...assets.values()].filter((a) => a.workspaceId === ws && a.productId === productId)); },
  };
}
