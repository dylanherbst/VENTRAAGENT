// G08 software billing service (AMP-044 fixture slice). Subscriptions, entitlements, usage allowances.
// Reads and writes ONLY billing state. It never touches seller accounts, orders or payouts (see ../sellers/money.ts for the
// two kinds of money). Every question that cannot be answered because storage failed is answered "no", with a reason.
import type { OperationContext } from '../contracts.ts';
import { platformSubscriptionCharge } from '../sellers/money.ts';
import { FREE_PLAN_ID, getPlan, isPlanId } from './plans.ts';
import { BillingProviderError, eventTypes, subscriptionStatuses, features as allFeatures, meters as allMeters } from './types.ts';
import type {
  BillingEvent, BillingProvider, BillingStore, BillingView, Effective, EntitlementResult, EventOutcome, Feature, Meter, PlanId, RefusalCode,
  RemainingResult, Result, Subscription, SubscriptionState, UsageResult, UsageSnapshot, ViewResult,
} from './types.ts';

const DAY = 86_400_000;
export const DEFAULT_GRACE_MS = 7 * DAY;
/** No free trial until the owner decides (open decision). */
export const DEFAULT_TRIAL_DAYS = 0;
export const MAX_USAGE_AMOUNT = 1000;
const MAX_ID = 100;
const CONTROL = /\p{Cc}|\p{Cf}/u;
const validId = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_ID && !CONTROL.test(s);

const MESSAGES: Record<RefusalCode, string> = {
  invalid: 'That request is not valid.',
  unknown_plan: 'That plan does not exist.',
  already_subscribed: 'This workspace already has a plan. Change it instead.',
  no_subscription: 'There is no active plan to change. Choose a plan first.',
  not_cancelling: 'The plan is not set to end, so there is nothing to resume.',
  past_due: 'The last payment did not go through. Update payment before changing plan.',
  payment_failed: 'The payment did not go through, so nothing was changed.',
  provider_unavailable: 'Billing is not available right now. Nothing was changed.',
  conflict: 'Something else changed this plan at the same moment. Try again.',
  unavailable: 'That could not be done right now.',
};
const refuse = (code: RefusalCode): { ok: false; code: RefusalCode; message: string } => ({ ok: false, code, message: MESSAGES[code] });

/** The subscription as it is at `now`. A period that ended without a renewal becomes past_due (grace from its end); expired grace or an ended cancel becomes cancelled. */
export function effectiveOf(sub: Subscription | null, now: number, graceMs: number): Effective {
  if (!sub) return { status: 'none', planId: FREE_PLAN_ID, graceEndsAt: null };
  if (sub.status === 'cancelled') return { status: 'cancelled', planId: FREE_PLAN_ID, graceEndsAt: null };
  const ended: Effective = { status: 'cancelled', planId: FREE_PLAN_ID, graceEndsAt: null };
  if (sub.cancelAtPeriodEnd && now >= sub.currentPeriodEnd) return ended;
  let status = sub.status;
  let grace = sub.graceEndsAt;
  if (status !== 'past_due' && now >= sub.currentPeriodEnd) { status = 'past_due'; grace = sub.currentPeriodEnd + graceMs; }
  if (status === 'past_due') {
    grace ??= sub.currentPeriodEnd + graceMs;
    if (now >= grace) return ended;
    return { status, planId: sub.planId, graceEndsAt: grace };
  }
  return { status, planId: sub.planId, graceEndsAt: null };
}

function stateOf(sub: Subscription | null, eff: Effective): SubscriptionState {
  if (!sub || eff.status === 'none') return 'none';
  if (eff.status === 'cancelled') return 'cancelled';
  if (eff.status === 'past_due') return 'past_due';
  if (sub.cancelAtPeriodEnd) return 'cancel_at_period_end';
  return eff.status;
}

function viewOf(workspaceId: string, sub: Subscription | null, eff: Effective): BillingView {
  const plan = getPlan(eff.planId);
  const live = sub !== null && eff.status !== 'cancelled' && eff.status !== 'none';
  return {
    workspaceId, state: stateOf(sub, eff), planId: plan.id, planName: plan.name, priceMinor: plan.priceMinor, currency: 'AUD',
    cancelAtPeriodEnd: live && sub.cancelAtPeriodEnd, pendingPlanId: live ? sub.pendingPlanId : null,
    currentPeriodEnd: live ? sub.currentPeriodEnd : null, graceEndsAt: eff.graceEndsAt, features: plan.features,
  };
}

/** Usage period: the subscription's billing period while it lasts, otherwise the UTC calendar month. */
function periodOf(sub: Subscription | null, eff: Effective, now: number): { key: string; resetsAt: number } {
  if (sub && (eff.status === 'trialing' || eff.status === 'active' || eff.status === 'past_due')) return { key: `p${sub.currentPeriodStart}`, resetsAt: sub.currentPeriodEnd };
  const d = new Date(now);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, resetsAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

export interface BillingDeps {
  store: BillingStore;
  provider: BillingProvider;
  now?: () => number;
  /** How long access continues after a failed payment. */
  graceMs?: number;
  /** Free trial days for a workspace's first paid subscription. */
  trialDays?: number;
}

export interface BillingService {
  /** What the workspace is on right now (no write). */
  getSubscription(workspaceId: string): Promise<Result<{ view: BillingView }>>;
  /** Choose a plan for a workspace with none (or a cancelled one). Choosing Discover is a no-op (free needs no subscription). */
  startPlan(ctx: OperationContext, req: { planId: PlanId }): Promise<ViewResult>;
  /** Upgrade = now (the provider charges the prorated difference). Downgrade = at the next renewal. To Discover = cancel at period end. */
  changePlan(ctx: OperationContext, req: { planId: PlanId }): Promise<ViewResult>;
  /** Ends the plan at the end of the paid period; access stays until then. Idempotent. */
  cancel(ctx: OperationContext): Promise<ViewResult>;
  /** Undoes a cancel that has not taken effect yet. */
  resume(ctx: OperationContext): Promise<ViewResult>;
  /** Writes down time-based changes (lapsed period, expired grace, ended cancel). Reads give the same answers without it. */
  reconcile(workspaceId: string): Promise<Result<{ view: BillingView }>>;
  /**
   * Webhook path. Trusts its input: the real adapter MUST verify the provider signature on the raw body first (AMP-043-D).
   * Idempotent per event id; an event older than the newest applied one is dropped.
   */
  applyEvent(event: BillingEvent): Promise<EventOutcome>;
  can(workspaceId: string, feature: Feature): Promise<EntitlementResult>;
  remaining(workspaceId: string, meter: Meter): Promise<RemainingResult>;
  /** Spends `amount` (default 1) of the plan allowance for the current period, atomically. `key` makes a retry spend once. */
  recordUsage(req: { workspaceId: string; meter: Meter; amount?: number; key?: string }): Promise<UsageResult>;
}

export function createBillingService(deps: BillingDeps): BillingService {
  const now = deps.now ?? Date.now;
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const trialDays = deps.trialDays ?? DEFAULT_TRIAL_DAYS;
  const { store, provider } = deps;
  // Workspaces with a change running. Checked and set before any await, so two simultaneous changes cannot both run.
  const busy = new Set<string>();

  const validCtx = (c: OperationContext): boolean => !!c && validId(c.workspaceId) && validId(c.actorUserId) && validId(c.idempotencyKey);
  const pkey = (c: OperationContext, op: string) => `${c.workspaceId}:${op}:${c.idempotencyKey}`;

  /** A record that cannot be trusted (unknown plan, bad times) is treated like an unreadable one: fail closed. */
  function intact(s: Subscription | null): s is Subscription {
    if (s === null) return true;
    const t = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    return isPlanId(s.planId) && (s.pendingPlanId === null || isPlanId(s.pendingPlanId)) && (subscriptionStatuses as readonly string[]).includes(s.status) &&
      typeof s.cancelAtPeriodEnd === 'boolean' && t(s.currentPeriodStart) && t(s.currentPeriodEnd) && (s.graceEndsAt === null || t(s.graceEndsAt)) &&
      t(s.lastEventAt) && typeof s.version === 'number';
  }
  async function load(ws: string): Promise<{ ok: true; sub: Subscription | null } | { ok: false }> {
    try {
      const sub = await store.getSubscription(ws);
      return intact(sub) ? { ok: true, sub } : { ok: false };
    } catch { return { ok: false }; }
  }

  function providerRefusal(e: unknown) {
    if (e instanceof BillingProviderError && e.code === 'idempotency_conflict') return refuse('invalid');
    return refuse(e instanceof BillingProviderError && e.code === 'payment_failed' ? 'payment_failed' : 'provider_unavailable');
  }

  /** Runs one mutating operation with the shared checks and the per-workspace guard. */
  async function mutate(ctx: OperationContext, body: (sub: Subscription | null, eff: Effective) => Promise<ViewResult>): Promise<ViewResult> {
    if (!validCtx(ctx)) return refuse('invalid');
    if (busy.has(ctx.workspaceId)) return refuse('conflict');
    busy.add(ctx.workspaceId);
    try {
      const l = await load(ctx.workspaceId);
      if (!l.ok) return refuse('unavailable');
      return await body(l.sub, effectiveOf(l.sub, now(), graceMs));
    } catch {
      return refuse('unavailable');
    } finally {
      busy.delete(ctx.workspaceId);
    }
  }

  async function write(next: Subscription, expected: number | null): Promise<boolean> {
    return store.putSubscription({ ...next, updatedAt: now() }, expected);
  }

  async function okView(ws: string, changed: boolean): Promise<ViewResult> {
    const l = await load(ws);
    if (!l.ok) return refuse('unavailable');
    return { ok: true, changed, view: viewOf(ws, l.sub, effectiveOf(l.sub, now(), graceMs)) };
  }

  async function charge(ws: string, id: string, planId: PlanId, amountMinor: number | undefined) {
    if (typeof amountMinor === 'number' && Number.isInteger(amountMinor) && amountMinor > 0) {
      await store.recordCharge(ws, id, platformSubscriptionCharge({ workspaceId: ws, planId, amountMinor, currency: 'AUD' }));
    }
  }

  const svc: BillingService = {
    async getSubscription(workspaceId) {
      if (!validId(workspaceId)) return refuse('invalid');
      const l = await load(workspaceId);
      if (!l.ok) return refuse('unavailable');
      return { ok: true, view: viewOf(workspaceId, l.sub, effectiveOf(l.sub, now(), graceMs)) };
    },

    async startPlan(ctx, req) {
      if (!isPlanId(req?.planId)) return validCtx(ctx) ? refuse('unknown_plan') : refuse('invalid');
      const plan = getPlan(req.planId);
      return mutate(ctx, async (sub, eff) => {
        if (eff.status === 'trialing' || eff.status === 'active' || eff.status === 'past_due') {
          return sub!.planId === plan.id ? okView(ctx.workspaceId, false) : refuse('already_subscribed');
        }
        if (plan.priceMinor === 0) return okView(ctx.workspaceId, false);
        // One trial per workspace: only when it has never had a subscription.
        const days = sub === null ? trialDays : 0;
        // The old record may have been ended only by OUR clock (or never reconciled): the provider can still be billing it.
        // End it there first, so a second subscription never runs beside it. Owner- and provider-ended ones are already ended.
        if (sub !== null && !sub.cancelAtPeriodEnd && sub.cancelledBy !== 'owner' && sub.cancelledBy !== 'provider') {
          try {
            await provider.setCancelAtPeriodEnd({ providerSubscriptionId: sub.providerSubscriptionId, cancel: true, idempotencyKey: pkey(ctx, 'replace') });
          } catch (e) {
            if (!(e instanceof BillingProviderError && e.code === 'not_found')) return providerRefusal(e);
          }
        }
        let created;
        try {
          created = await provider.createSubscription({ workspaceId: ctx.workspaceId, planId: plan.id, priceMinor: plan.priceMinor, trialDays: days, idempotencyKey: pkey(ctx, 'start') });
        } catch (e) { return providerRefusal(e); }
        const t = now();
        const next: Subscription = {
          workspaceId: ctx.workspaceId, planId: plan.id, status: created.status, cancelAtPeriodEnd: false, pendingPlanId: null,
          currentPeriodStart: created.currentPeriodStart, currentPeriodEnd: created.currentPeriodEnd, graceEndsAt: null,
          providerSubscriptionId: created.providerSubscriptionId, lastEventAt: 0, version: 0, createdAt: sub?.createdAt ?? t, updatedAt: t,
        };
        // The charge is filed BEFORE the subscription, under a key the retry repeats, so a retry files it exactly once.
        await charge(ctx.workspaceId, `start:${created.providerSubscriptionId}`, plan.id, created.chargedMinor);
        if (!(await write(next, sub ? sub.version : null))) return refuse('conflict');
        return okView(ctx.workspaceId, true);
      });
    },

    async changePlan(ctx, req) {
      if (!isPlanId(req?.planId)) return validCtx(ctx) ? refuse('unknown_plan') : refuse('invalid');
      const target = getPlan(req.planId);
      if (target.priceMinor === 0) return svc.cancel(ctx); // moving to the free plan = leave at the end of the period
      return mutate(ctx, async (sub, eff) => {
        if (!sub || eff.status === 'none' || eff.status === 'cancelled') return refuse('no_subscription');
        const current = getPlan(sub.planId);
        if (target.id === current.id) {
          if (sub.pendingPlanId === null) return okView(ctx.workspaceId, false);
          try { await provider.changePlan({ providerSubscriptionId: sub.providerSubscriptionId, planId: target.id, priceMinor: target.priceMinor, timing: 'immediate', idempotencyKey: pkey(ctx, 'change') }); } catch (e) { return providerRefusal(e); }
          if (!(await write({ ...sub, pendingPlanId: null }, sub.version))) return refuse('conflict');
          return okView(ctx.workspaceId, true);
        }
        if (target.rank > current.rank) {
          if (eff.status === 'past_due') return refuse('past_due');
          let res;
          try { res = await provider.changePlan({ providerSubscriptionId: sub.providerSubscriptionId, planId: target.id, priceMinor: target.priceMinor, timing: 'immediate', idempotencyKey: pkey(ctx, 'change') }); } catch (e) { return providerRefusal(e); }
          await charge(ctx.workspaceId, `change:${pkey(ctx, 'change')}`, target.id, res.chargedMinor);
          if (!(await write({ ...sub, planId: target.id, pendingPlanId: null }, sub.version))) return refuse('conflict');
          return okView(ctx.workspaceId, true);
        }
        // Downgrade: keep what was paid for until the period ends.
        try { await provider.changePlan({ providerSubscriptionId: sub.providerSubscriptionId, planId: target.id, priceMinor: target.priceMinor, timing: 'period_end', idempotencyKey: pkey(ctx, 'change') }); } catch (e) { return providerRefusal(e); }
        if (!(await write({ ...sub, pendingPlanId: target.id }, sub.version))) return refuse('conflict');
        return okView(ctx.workspaceId, true);
      });
    },

    async cancel(ctx) {
      return mutate(ctx, async (sub, eff) => {
        if (!sub || eff.status === 'none' || eff.status === 'cancelled') return refuse('no_subscription');
        if (sub.cancelAtPeriodEnd) return okView(ctx.workspaceId, false);
        try { await provider.setCancelAtPeriodEnd({ providerSubscriptionId: sub.providerSubscriptionId, cancel: true, idempotencyKey: pkey(ctx, 'cancel') }); } catch (e) { return providerRefusal(e); }
        if (!(await write({ ...sub, cancelAtPeriodEnd: true, pendingPlanId: null }, sub.version))) return refuse('conflict');
        return okView(ctx.workspaceId, true);
      });
    },

    async resume(ctx) {
      return mutate(ctx, async (sub, eff) => {
        if (!sub || eff.status === 'none' || eff.status === 'cancelled') return refuse('no_subscription');
        if (!sub.cancelAtPeriodEnd) return refuse('not_cancelling');
        try { await provider.setCancelAtPeriodEnd({ providerSubscriptionId: sub.providerSubscriptionId, cancel: false, idempotencyKey: pkey(ctx, 'resume') }); } catch (e) { return providerRefusal(e); }
        if (!(await write({ ...sub, cancelAtPeriodEnd: false }, sub.version))) return refuse('conflict');
        return okView(ctx.workspaceId, true);
      });
    },

    async reconcile(workspaceId) {
      if (!validId(workspaceId)) return refuse('invalid');
      const l = await load(workspaceId);
      if (!l.ok) return refuse('unavailable');
      const { sub } = l;
      const eff = effectiveOf(sub, now(), graceMs);
      if (sub && sub.status !== 'cancelled') {
        const next: Subscription | null =
          eff.status === 'cancelled' ? { ...sub, status: 'cancelled', graceEndsAt: null, pendingPlanId: null, cancelledBy: sub.cancelAtPeriodEnd ? 'owner' : 'clock' } :
          eff.status === 'past_due' && sub.status !== 'past_due' ? { ...sub, status: 'past_due', graceEndsAt: eff.graceEndsAt } : null;
        if (next) {
          try { await write(next, sub.version); } catch { return refuse('unavailable'); }
        }
      }
      const again = await load(workspaceId);
      if (!again.ok) return refuse('unavailable');
      return { ok: true, view: viewOf(workspaceId, again.sub, effectiveOf(again.sub, now(), graceMs)) };
    },

    async applyEvent(event) {
      if (!event || !validId(event.id) || !(eventTypes as readonly string[]).includes(event.type) || !validId(event.providerSubscriptionId) ||
        !Number.isInteger(event.created) || event.created < 0) return 'invalid';
      const d = event.data ?? {};
      if (event.type === 'subscription.renewed' && (!Number.isInteger(d.periodStart) || !Number.isInteger(d.periodEnd) || (d.periodEnd as number) <= (d.periodStart as number))) return 'invalid';
      let claimed = false;
      try {
        const ws = await store.workspaceOfProviderSubscription(event.providerSubscriptionId);
        // Unknown subscription: never create one from a webhook, and do not record the id.
        if (ws === null) return 'unknown_subscription';
        if (!(await store.claimEvent(event.id))) return 'duplicate';
        claimed = true;
        for (let attempt = 0; attempt < 3; attempt++) {
          const sub = await store.getSubscription(ws);
          if (!sub) { claimed = false; await store.releaseEvent(event.id); return 'unknown_subscription'; }
          if (!intact(sub)) throw new Error('unreadable subscription');
          if (event.created < sub.lastEventAt) return 'stale';
          const next = applyTo(sub, event, graceMs);
          const stamped: Subscription | null = next === 'ignored' ? { ...sub, lastEventAt: event.created } : { ...next, lastEventAt: event.created };
          // The charge is filed BEFORE the subscription is changed, keyed by the event id (filing it twice stores one). If anything
          // fails the claim is released and the retry runs the whole step again: never zero charges, never two.
          if (next !== 'ignored' && event.type === 'subscription.renewed') await charge(ws, `event:${event.id}`, next.planId, d.amountMinor);
          if (await write(stamped, sub.version)) return next === 'ignored' ? 'ignored' : 'applied';
        }
        throw new Error('conflict');
      } catch {
        if (claimed) { try { await store.releaseEvent(event.id); } catch { /* the provider will retry; the claim stays */ } }
        return 'unavailable';
      }
    },

    async can(workspaceId, feature) {
      if (!validId(workspaceId) || !(allFeatures as readonly string[]).includes(feature)) {
        const unknown = validId(workspaceId);
        return { allowed: false, reason: unknown ? 'unknown_feature' : 'invalid_request', planId: null, message: unknown ? 'Unknown feature.' : MESSAGES.invalid };
      }
      const l = await load(workspaceId);
      if (!l.ok) return { allowed: false, reason: 'subscription_unreadable', planId: null, message: 'The plan could not be checked, so this is not allowed right now.' };
      const eff = effectiveOf(l.sub, now(), graceMs);
      const plan = getPlan(eff.planId);
      if (!plan.features.includes(feature)) return { allowed: false, reason: 'not_in_plan', planId: plan.id, message: `${plan.name} does not include this.` };
      return { allowed: true, reason: 'in_plan', planId: plan.id };
    },

    async remaining(workspaceId, meter) {
      const r = await snapshot(workspaceId, meter);
      return r.ok ? { ok: true, ...r.usage } : { ok: false, reason: r.reason, message: r.message };
    },

    async recordUsage(req) {
      if (!req) return { allowed: false, reason: 'invalid_request', message: MESSAGES.invalid };
      const amount = req.amount ?? 1;
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_USAGE_AMOUNT || (req.key !== undefined && !validId(req.key))) {
        return { allowed: false, reason: 'invalid_request', message: MESSAGES.invalid };
      }
      const s = await snapshot(req.workspaceId, req.meter);
      if (!s.ok) return { allowed: false, reason: s.reason === 'invalid_request' ? 'invalid_request' : 'unavailable', message: s.message };
      if (s.usage.limit <= 0) return { allowed: false, reason: 'not_in_plan', message: 'Your plan does not include this.', usage: s.usage };
      try {
        // The check and the add are ONE store step, so two calls at the limit cannot both pass.
        const r = await store.addUsage(req.workspaceId, req.meter, s.usage.periodKey, amount, s.usage.limit, req.key);
        const usage: UsageSnapshot = { ...s.usage, used: r.used, remaining: Math.max(0, s.usage.limit - r.used) };
        if (r.applied || r.replay) return { allowed: true, replay: r.replay, ...usage };
        return { allowed: false, reason: 'limit_reached', message: 'You have used this period’s allowance.', usage };
      } catch {
        return { allowed: false, reason: 'unavailable', message: 'Usage could not be recorded, so this is not allowed right now.' };
      }
    },
  };

  async function snapshot(workspaceId: string, meter: Meter): Promise<{ ok: true; usage: UsageSnapshot } | { ok: false; reason: 'invalid_request' | 'unavailable'; message: string }> {
    if (!validId(workspaceId) || !(allMeters as readonly string[]).includes(meter)) return { ok: false, reason: 'invalid_request', message: MESSAGES.invalid };
    const l = await load(workspaceId);
    if (!l.ok) return { ok: false, reason: 'unavailable', message: 'The plan could not be read, so this is not allowed right now.' };
    const t = now();
    const eff = effectiveOf(l.sub, t, graceMs);
    const period = periodOf(l.sub, eff, t);
    const limit = getPlan(eff.planId).allowances[meter];
    try {
      const used = await store.getUsage(workspaceId, meter, period.key);
      return { ok: true, usage: { meter, limit, used, remaining: Math.max(0, limit - used), periodKey: period.key, resetsAt: period.resetsAt } };
    } catch {
      return { ok: false, reason: 'unavailable', message: 'Usage could not be read, so this is not allowed right now.' };
    }
  }

  return svc;
}

/** The state change one provider event causes, or 'ignored' when it changes nothing. Pure. */
function applyTo(sub: Subscription, e: BillingEvent, graceMs: number): Subscription | 'ignored' {
  const start = e.data?.periodStart as number;
  const end = e.data?.periodEnd as number;
  if (sub.status === 'cancelled') {
    // Cancelled only by the clock (grace ran out): a genuine renewal of a newer period means the customer paid, so reopen.
    // Cancelled by the provider or by the owner: stays cancelled.
    if (e.type === 'subscription.renewed' && sub.cancelledBy === 'clock' && end > sub.currentPeriodEnd) {
      return { ...sub, status: 'active', cancelledBy: null, cancelAtPeriodEnd: false, pendingPlanId: null, graceEndsAt: null, currentPeriodStart: start, currentPeriodEnd: end };
    }
    return 'ignored';
  }
  switch (e.type) {
    case 'subscription.renewed': {
      // A cancelling subscription is not renewed; an old period replayed under a new id changes nothing.
      if (sub.cancelAtPeriodEnd || end <= sub.currentPeriodEnd) return 'ignored';
      return { ...sub, planId: sub.pendingPlanId ?? sub.planId, pendingPlanId: null, status: 'active', graceEndsAt: null, currentPeriodStart: start, currentPeriodEnd: end };
    }
    case 'payment.failed':
      // The first failure starts the grace clock; later retries do not extend it.
      return sub.status === 'past_due' ? 'ignored' : { ...sub, status: 'past_due', graceEndsAt: e.created + graceMs };
    case 'payment.succeeded':
      return sub.status === 'past_due' ? { ...sub, status: 'active', graceEndsAt: null } : 'ignored';
    case 'subscription.cancelled':
      return { ...sub, status: 'cancelled', cancelledBy: 'provider', graceEndsAt: null, pendingPlanId: null, cancelAtPeriodEnd: false };
  }
}
