// Deterministic fixture billing provider. No network, no keys, no env. It stands in for Stripe Billing until the owner
// supplies test keys (AMP-043-D). Ids count up; time comes from the clock you pass in; failures are switched on by the test.
import { BillingProviderError, planIds } from './types.ts';
import type { BillingEvent, BillingEventType, BillingProvider, PlanId, ProviderSubscription } from './types.ts';

export const DAY_MS = 86_400_000;
export const FIXTURE_PERIOD_MS = 30 * DAY_MS;

interface Record_ {
  planId: PlanId; priceMinor: number; periodStart: number; periodEnd: number; trialing: boolean;
  cancelAtPeriodEnd: boolean; scheduled: { planId: PlanId; priceMinor: number } | null;
}

export interface FixtureBillingProvider extends BillingProvider {
  readonly mode: 'fixture';
  /** Every call that reached the provider, in order (idempotent replays are not repeated). */
  readonly calls: readonly { method: string; planId?: PlanId; timing?: string; cancel?: boolean }[];
  /** The next provider call throws this error, once. */
  failNext(code: 'payment_failed' | 'unavailable'): void;
  /** What the provider believes about a subscription (for assertions). */
  inspect(providerSubscriptionId: string): Readonly<Record_> | null;
  /** Builds an event with a fresh id (or `id`), `created` = `at` (default: the clock). Nothing is sent anywhere. */
  event(type: BillingEventType, providerSubscriptionId: string, opts?: { id?: string; at?: number; amountMinor?: number; periodStart?: number; periodEnd?: number }): BillingEvent;
  /** The renewal event for the next period (applies a scheduled plan change, so the charge is the NEW plan's price). */
  renewalEvent(providerSubscriptionId: string, opts?: { id?: string; at?: number }): BillingEvent;
}

export function createFixtureBillingProvider(opts: { now?: () => number; periodMs?: number } = {}): FixtureBillingProvider {
  const now = opts.now ?? (() => 1_800_000_000_000);
  const periodMs = opts.periodMs ?? FIXTURE_PERIOD_MS;
  const subs = new Map<string, Record_>();
  // key -> what the first request was (method + every field except the key) and its answer.
  const replays = new Map<string, { fingerprint: string; out: ProviderSubscription }>();
  // Like a real provider: the same key with the same request replays the answer; with a DIFFERENT request it is refused.
  const fingerprint = (method: string, req: { idempotencyKey: string }): string => {
    const rest = Object.entries(req).filter(([k]) => k !== 'idempotencyKey');
    return JSON.stringify([method, rest.sort(([a], [b]) => (a < b ? -1 : 1))]);
  };
  const replayOf = (method: string, req: { idempotencyKey: string }): ProviderSubscription | null => {
    const hit = replays.get(req.idempotencyKey);
    if (!hit) return null;
    if (hit.fingerprint !== fingerprint(method, req)) throw new BillingProviderError('idempotency_conflict', 'That idempotency key was already used for a different request (fixture).');
    return { ...hit.out };
  };
  const remember = (method: string, req: { idempotencyKey: string }, out: ProviderSubscription) => {
    replays.set(req.idempotencyKey, { fingerprint: fingerprint(method, req), out });
  };
  const calls: { method: string; planId?: PlanId; timing?: string; cancel?: boolean }[] = [];
  let failure: 'payment_failed' | 'unavailable' | null = null;
  let subSeq = 0;
  let evtSeq = 0;

  const maybeFail = () => {
    if (failure) {
      const code = failure;
      failure = null;
      throw new BillingProviderError(code, code === 'payment_failed' ? 'The card was declined (fixture).' : 'The billing provider is unavailable (fixture).');
    }
  };
  const need = (id: string): Record_ => {
    const r = subs.get(id);
    if (!r) throw new BillingProviderError('not_found', 'No such subscription (fixture).');
    return r;
  };
  const snap = (id: string, r: Record_, chargedMinor: number): ProviderSubscription => ({
    providerSubscriptionId: id, status: r.trialing ? 'trialing' : 'active', currentPeriodStart: r.periodStart, currentPeriodEnd: r.periodEnd, chargedMinor,
  });

  return {
    mode: 'fixture',
    calls,
    failNext(code) { failure = code; },
    inspect(id) { const r = subs.get(id); return r ? structuredClone(r) : null; },
    async createSubscription(req) {
      const replay = replayOf('createSubscription', req);
      if (replay) return replay;
      calls.push({ method: 'createSubscription', planId: req.planId });
      maybeFail();
      if (!(planIds as readonly string[]).includes(req.planId)) throw new BillingProviderError('not_found', 'Unknown plan (fixture).');
      const start = now();
      const trialing = req.trialDays > 0;
      const id = `sub_fixture_${++subSeq}`;
      const r: Record_ = { planId: req.planId, priceMinor: req.priceMinor, periodStart: start, periodEnd: trialing ? start + req.trialDays * DAY_MS : start + periodMs, trialing, cancelAtPeriodEnd: false, scheduled: null };
      subs.set(id, r);
      const out = snap(id, r, trialing ? 0 : req.priceMinor);
      remember('createSubscription', req, out);
      return { ...out };
    },
    async changePlan(req) {
      const replay = replayOf('changePlan', req);
      if (replay) return replay;
      calls.push({ method: 'changePlan', planId: req.planId, timing: req.timing });
      maybeFail();
      const r = need(req.providerSubscriptionId);
      let charged = 0;
      if (req.timing === 'period_end') {
        r.scheduled = req.planId === r.planId ? null : { planId: req.planId, priceMinor: req.priceMinor };
      } else {
        r.scheduled = null;
        if (req.planId !== r.planId) {
          // Prorated by the time left in the period (an upgrade charges the difference; a trial charges nothing).
          const left = Math.max(0, r.periodEnd - now()) / Math.max(1, r.periodEnd - r.periodStart);
          if (!r.trialing) charged = Math.max(0, Math.round((req.priceMinor - r.priceMinor) * left));
          r.planId = req.planId;
          r.priceMinor = req.priceMinor;
        }
      }
      const out = snap(req.providerSubscriptionId, r, charged);
      remember('changePlan', req, out);
      return { ...out };
    },
    async setCancelAtPeriodEnd(req) {
      if (replayOf('setCancelAtPeriodEnd', req)) return;
      calls.push({ method: 'setCancelAtPeriodEnd', cancel: req.cancel });
      maybeFail();
      need(req.providerSubscriptionId).cancelAtPeriodEnd = req.cancel;
      remember('setCancelAtPeriodEnd', req, snap(req.providerSubscriptionId, need(req.providerSubscriptionId), 0));
    },
    event(type, providerSubscriptionId, o = {}) {
      const data: NonNullable<BillingEvent['data']> = {};
      if (o.amountMinor !== undefined) data.amountMinor = o.amountMinor;
      if (o.periodStart !== undefined) data.periodStart = o.periodStart;
      if (o.periodEnd !== undefined) data.periodEnd = o.periodEnd;
      return { id: o.id ?? `evt_fixture_${++evtSeq}`, type, created: o.at ?? now(), providerSubscriptionId, data };
    },
    renewalEvent(providerSubscriptionId, o = {}) {
      const r = need(providerSubscriptionId);
      if (r.scheduled) { r.planId = r.scheduled.planId; r.priceMinor = r.scheduled.priceMinor; r.scheduled = null; }
      r.trialing = false;
      r.periodStart = r.periodEnd;
      r.periodEnd = r.periodStart + periodMs;
      return { id: o.id ?? `evt_fixture_${++evtSeq}`, type: 'subscription.renewed', created: o.at ?? r.periodStart, providerSubscriptionId, data: { periodStart: r.periodStart, periodEnd: r.periodEnd, amountMinor: r.priceMinor } };
    },
  };
}
