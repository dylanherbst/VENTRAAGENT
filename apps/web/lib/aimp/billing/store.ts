// In-memory BillingStore (stand-in for the future subscription, usage, event and charge tables).
// Every method runs synchronously inside one JS turn, so two calls started together cannot interleave; a database gets the
// same guarantee from one conditional UPDATE (see the SQL notes in types.ts). Every read and write names a workspace.
// Seen event ids and usage keys are kept for the life of the process here; the database version expires them (G08 contract, "Expiry").
import type { PlatformSubscriptionCharge } from '../sellers/money.ts';
import type { BillingStore, Meter, Subscription } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function createMemoryBillingStore(): BillingStore {
  const subs = new Map<string, Subscription>();
  const byProvider = new Map<string, string>();
  const events = new Set<string>();
  const usage = new Map<string, number>();
  const usageKeys = new Set<string>();
  const charges = new Map<string, Map<string, PlatformSubscriptionCharge>>();
  const usageKey = (ws: string, meter: Meter, period: string) => `${ws}\u0000${meter}\u0000${period}`;

  return {
    async getSubscription(workspaceId) {
      const s = subs.get(workspaceId);
      return s ? clone(s) : null;
    },
    async putSubscription(sub, expectedVersion) {
      if (!nonEmpty(sub.workspaceId) || !nonEmpty(sub.providerSubscriptionId)) throw new Error('subscription needs workspaceId and providerSubscriptionId');
      const current = subs.get(sub.workspaceId);
      if (expectedVersion === null ? current !== undefined : current === undefined || current.version !== expectedVersion) return false;
      // One provider subscription belongs to one workspace, ever.
      const owner = byProvider.get(sub.providerSubscriptionId);
      if (owner !== undefined && owner !== sub.workspaceId) throw new Error('provider subscription already belongs to another workspace');
      if (current && current.providerSubscriptionId !== sub.providerSubscriptionId) byProvider.delete(current.providerSubscriptionId);
      subs.set(sub.workspaceId, { ...clone(sub), version: (current?.version ?? 0) + 1 });
      byProvider.set(sub.providerSubscriptionId, sub.workspaceId);
      return true;
    },
    async workspaceOfProviderSubscription(id) {
      return byProvider.get(id) ?? null;
    },
    async claimEvent(eventId) {
      if (events.has(eventId)) return false;
      events.add(eventId);
      return true;
    },
    async releaseEvent(eventId) {
      events.delete(eventId);
    },
    async getUsage(workspaceId, meter, periodKey) {
      return usage.get(usageKey(workspaceId, meter, periodKey)) ?? 0;
    },
    async addUsage(workspaceId, meter, periodKey, amount, limit, key) {
      const k = usageKey(workspaceId, meter, periodKey);
      const used = usage.get(k) ?? 0;
      // A usage key is scoped to workspace + meter, NOT to the period: a retry that arrives after a renewal is still a replay.
      const idem = key === undefined ? null : `${workspaceId}\u0000${meter}\u0000${key}`;
      if (idem !== null && usageKeys.has(idem)) return { applied: false, used, replay: true };
      if (used + amount > limit) return { applied: false, used, replay: false };
      usage.set(k, used + amount);
      if (idem !== null) usageKeys.add(idem);
      return { applied: true, used: used + amount, replay: false };
    },
    async recordCharge(workspaceId, chargeId, charge) {
      if (charge.workspaceId !== workspaceId) throw new Error('charge belongs to another workspace');
      const m = charges.get(workspaceId) ?? new Map<string, PlatformSubscriptionCharge>();
      if (!m.has(chargeId)) m.set(chargeId, clone(charge));
      charges.set(workspaceId, m);
    },
    async listCharges(workspaceId) {
      return [...(charges.get(workspaceId)?.values() ?? [])].map(clone);
    },
  };
}
