// In-memory CampaignStore for tests and the demo page (AMP-050), following branding/store.ts. Every read and write is scoped
// by workspace AND business, so one workspace can never see or change another's campaign. `mutate` runs the change on a
// fresh copy synchronously, so two calls started together cannot interleave; if the change throws, nothing is saved.
import type { CampaignRecord, CampaignStore } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryCampaignStore(): CampaignStore {
  const map = new Map<string, CampaignRecord>();
  const key = (ws: string, biz: string) => `${ws}\u0000${biz}`;
  return {
    kind: 'memory',
    async get(ws, biz) {
      const r = map.get(key(ws, biz));
      return r ? clone(r) : null;
    },
    async mutate(ws, biz, change) {
      const k = key(ws, biz);
      const cur = map.get(k);
      const out = change(cur ? clone(cur) : null);
      const r = out.record;
      if (r && (r.workspaceId !== ws || r.businessId !== biz || r.plan.workspaceId !== ws || r.plan.businessId !== biz)) {
        throw new Error('A campaign belongs to a different workspace or business.');
      }
      if (r) map.set(k, clone(r)); else map.delete(k);
      return out.result;
    },
  };
}
