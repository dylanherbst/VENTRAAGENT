// In-memory AssetStore for tests and the demo page (AMP-051), following campaigns/store.ts. Every read and write is keyed by
// workspace AND business AND campaign, so one business can never see or change another's assets. Reads return copies.
import type { ArchivedAssetSet, AssetSet, AssetStore } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryAssetStore(): AssetStore {
  const map = new Map<string, AssetSet>();
  const archive = new Map<string, ArchivedAssetSet[]>();
  const key = (ws: string, biz: string, campaign: string) => `${ws}\u0000${biz}\u0000${campaign}`;
  const wrongScope = (s: AssetSet, ws: string, biz: string, campaign: string) => s.workspaceId !== ws || s.businessId !== biz || s.campaignId !== campaign;
  return {
    kind: 'memory',
    async get(ws, biz, campaign) {
      const s = map.get(key(ws, biz, campaign));
      return s ? clone(s) : null;
    },
    async archived(ws, biz, campaign) {
      return clone(archive.get(key(ws, biz, campaign)) ?? []);
    },
    async mutate(ws, biz, campaign, change) {
      const k = key(ws, biz, campaign);
      const cur = map.get(k);
      const out = change(cur ? clone(cur) : null);
      const s = out.set;
      if (s && wrongScope(s, ws, biz, campaign)) throw new Error('An asset set belongs to a different workspace, business or campaign.');
      if (out.archive && wrongScope(out.archive, ws, biz, campaign)) throw new Error('An archived asset set belongs to a different workspace, business or campaign.');
      if (s) map.set(k, clone(s)); else map.delete(k);
      if (out.archive) archive.set(k, [...(archive.get(k) ?? []), clone(out.archive)]);
      return out.result;
    },
  };
}
