// G08 / AMP-044: software billing on in-memory stores and the fixture provider. No network, no secrets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { site } from '../lib/aimp/site-config.ts';
import {
  DAY_MS, FIXTURE_PERIOD_MS, PLANS, PRICE_SNAPSHOT, createBillingService, createFixtureBillingProvider, createMemoryBillingStore, effectiveOf, listPlans,
  BillingProviderError, type BillingStore, type PlanId,
} from '../lib/aimp/billing/index.ts';

const T0 = 1_800_000_000_000;

function world(opts: { trialDays?: number; graceMs?: number; store?: BillingStore } = {}) {
  const clock = { t: T0 };
  const store = opts.store ?? createMemoryBillingStore();
  const provider = createFixtureBillingProvider({ now: () => clock.t });
  const billing = createBillingService({ store, provider, now: () => clock.t, trialDays: opts.trialDays, graceMs: opts.graceMs });
  let n = 0;
  const ctx = (workspaceId = 'ws-a') => ({ workspaceId, actorUserId: 'user-1', idempotencyKey: `k${++n}` });
  const psid = async (ws = 'ws-a') => (await store.getSubscription(ws))!.providerSubscriptionId;
  return { clock, store, provider, billing, ctx, psid };
}
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.equal(r.ok, true, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

test('G08 AMP-166: billing charges its own price snapshot; the public pricing page drifting fails this test loudly', () => {
  const plans = listPlans();
  // The literal numbers that are charged. Changing a price is a deliberate edit of PRICE_SNAPSHOT AND this line.
  assert.deepEqual(plans.map((p) => [p.id, p.name, p.priceMinor]), [['discover', 'Discover', 0], ['launch', 'Launch', 7900], ['autopilot', 'Autopilot', 14900], ['scale', 'Scale', 24900]]);
  assert.deepEqual(Object.keys(PRICE_SNAPSHOT), site.plans.map((p) => p.id));
  // DRIFT CHECK: the public page must still show what billing charges. If the owner edits the public price, this fails until billing is updated on purpose.
  assert.deepEqual(site.plans.map((p) => [p.id, p.name, p.priceAud]), Object.entries(PRICE_SNAPSHOT).map(([id, p]) => [id, p.name, p.priceAud]),
    'the public pricing config no longer matches the billing price snapshot (apps/web/lib/aimp/billing/plans.ts)');
  assert.throws(() => { (PRICE_SNAPSHOT.launch as { priceAud: number }).priceAud = 1; });
  assert.equal(PLANS.launch.priceMinor, 7900);
});

test('G08: plan names and prices are the billing snapshot, ranked low to high', () => {
  const plans = listPlans();
  assert.deepEqual(plans.map((p) => p.rank), [0, 1, 2, 3]);
  assert.equal(PLANS.discover.priceMinor, 0);
  assert.ok(plans.every((p) => p.placeholder === true));
  // Each bigger plan includes everything the smaller one does.
  for (let i = 1; i < plans.length; i++) assert.ok(plans[i - 1].features.every((f) => plans[i].features.includes(f)));
  assert.throws(() => { (PLANS.launch as { name: string }).name = 'x'; });
});

test('G08: a workspace with no subscription is on Discover and fails closed on paid features', async () => {
  const { billing } = world();
  const v = must(await billing.getSubscription('ws-a')).view;
  assert.equal(v.state, 'none');
  assert.equal(v.planId, 'discover');
  assert.deepEqual(await billing.can('ws-a', 'sample_preview'), { allowed: true, reason: 'in_plan', planId: 'discover' });
  const store = await billing.can('ws-a', 'store');
  assert.equal(store.allowed, false);
  assert.equal(!store.allowed && store.reason, 'not_in_plan');
  const unknown = await billing.can('ws-a', 'time_travel' as never);
  assert.equal(!unknown.allowed && unknown.reason, 'unknown_feature');
  const bad = await billing.can('', 'store');
  assert.equal(!bad.allowed && bad.reason, 'invalid_request');
});

test('G08: startPlan activates a paid plan, records one software charge, and is idempotent', async () => {
  const { billing, ctx, store, provider } = world();
  const r = must(await billing.startPlan(ctx(), { planId: 'launch' }));
  assert.equal(r.changed, true);
  assert.equal(r.view.state, 'active');
  assert.equal(r.view.planId, 'launch');
  assert.equal(r.view.currentPeriodEnd, T0 + FIXTURE_PERIOD_MS);
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
  assert.equal((await billing.can('ws-a', 'social_publishing')).allowed, false);
  const charges = await store.listCharges('ws-a');
  assert.deepEqual(charges.map((c) => [c.flow, c.planId, c.amountMinor, c.currency]), [['platform_subscription', 'launch', 7900, 'AUD']]);
  // Same plan again: nothing changes and the provider is not called twice.
  const again = must(await billing.startPlan(ctx(), { planId: 'launch' }));
  assert.equal(again.changed, false);
  assert.equal(provider.calls.filter((c) => c.method === 'createSubscription').length, 1);
  assert.equal((await store.listCharges('ws-a')).length, 1);
  // A different plan goes through changePlan.
  const other = await billing.startPlan(ctx(), { planId: 'scale' });
  assert.equal(!other.ok && other.code, 'already_subscribed');
});

test('G08: startPlan refuses bad input and treats Discover as free (no subscription)', async () => {
  const { billing, ctx, store, provider } = world();
  const unknown = await billing.startPlan(ctx(), { planId: 'platinum' as PlanId });
  assert.equal(!unknown.ok && unknown.code, 'unknown_plan');
  const noCtx = await billing.startPlan({ workspaceId: '', actorUserId: 'u', idempotencyKey: 'k' }, { planId: 'launch' });
  assert.equal(!noCtx.ok && noCtx.code, 'invalid');
  const free = must(await billing.startPlan(ctx(), { planId: 'discover' }));
  assert.equal(free.view.state, 'none');
  assert.equal(await store.getSubscription('ws-a'), null);
  assert.equal(provider.calls.length, 0);
});

test('G08: trial is one per workspace and charges nothing', async () => {
  const { billing, ctx, store, clock } = world({ trialDays: 7 });
  const r = must(await billing.startPlan(ctx(), { planId: 'launch' }));
  assert.equal(r.view.state, 'trialing');
  assert.equal(r.view.currentPeriodEnd, T0 + 7 * DAY_MS);
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
  assert.equal((await store.listCharges('ws-a')).length, 0);
  must(await billing.cancel(ctx()));
  clock.t = T0 + 8 * DAY_MS;
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'cancelled');
  // Coming back later is a paid start with no second trial.
  const back = must(await billing.startPlan(ctx(), { planId: 'launch' }));
  assert.equal(back.view.state, 'active');
  assert.equal((await store.listCharges('ws-a')).length, 1);
});

test('G08: upgrade is immediate (entitlements and allowance), charges the prorated difference', async () => {
  const { billing, ctx, store, clock } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  assert.equal((await billing.can('ws-a', 'daily_checks')).allowed, false);
  clock.t = T0 + 15 * DAY_MS; // half way through the period
  const r = must(await billing.changePlan(ctx(), { planId: 'autopilot' }));
  assert.equal(r.view.planId, 'autopilot');
  assert.equal(r.view.pendingPlanId, null);
  assert.equal((await billing.can('ws-a', 'daily_checks')).allowed, true);
  const amounts = (await store.listCharges('ws-a')).map((c) => c.amountMinor);
  assert.deepEqual(amounts, [7900, 3500]); // (14900 - 7900) / 2
  const rem = await billing.remaining('ws-a', 'ai_generations');
  assert.equal(rem.ok && rem.limit, 80);
});

test('G08: downgrade waits for the renewal; paid entitlements stay until then', async () => {
  const { billing, ctx, store, provider, psid, clock } = world();
  must(await billing.startPlan(ctx(), { planId: 'autopilot' }));
  const r = must(await billing.changePlan(ctx(), { planId: 'launch' }));
  assert.equal(r.view.planId, 'autopilot');
  assert.equal(r.view.pendingPlanId, 'launch');
  assert.equal((await billing.can('ws-a', 'daily_checks')).allowed, true);
  clock.t = T0 + FIXTURE_PERIOD_MS;
  assert.equal(await billing.applyEvent(provider.renewalEvent(await psid())), 'applied');
  const v = must(await billing.getSubscription('ws-a')).view;
  assert.equal(v.planId, 'launch');
  assert.equal(v.pendingPlanId, null);
  assert.equal((await billing.can('ws-a', 'daily_checks')).allowed, false);
  assert.deepEqual((await store.listCharges('ws-a')).map((c) => [c.planId, c.amountMinor]), [['autopilot', 14900], ['launch', 7900]]);
});

test('G08: choosing the current plan again cancels a scheduled downgrade', async () => {
  const { billing, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'scale' }));
  must(await billing.changePlan(ctx(), { planId: 'launch' }));
  const r = must(await billing.changePlan(ctx(), { planId: 'scale' }));
  assert.equal(r.changed, true);
  assert.equal(r.view.pendingPlanId, null);
  assert.equal(must(await billing.changePlan(ctx(), { planId: 'scale' })).changed, false);
});

test('G08: changePlan with no plan, to Discover, or with a bad plan', async () => {
  const { billing, ctx } = world();
  const none = await billing.changePlan(ctx(), { planId: 'launch' });
  assert.equal(!none.ok && none.code, 'no_subscription');
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const free = must(await billing.changePlan(ctx(), { planId: 'discover' }));
  assert.equal(free.view.state, 'cancel_at_period_end');
  const bad = await billing.changePlan(ctx(), { planId: 'nope' as PlanId });
  assert.equal(!bad.ok && bad.code, 'unknown_plan');
});

test('G08: cancel keeps access to the period end, is idempotent, and resume undoes it', async () => {
  const { billing, ctx, clock, provider } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const c = must(await billing.cancel(ctx()));
  assert.equal(c.view.state, 'cancel_at_period_end');
  assert.equal(c.view.cancelAtPeriodEnd, true);
  assert.equal(must(await billing.cancel(ctx())).changed, false);
  assert.equal(provider.calls.filter((x) => x.method === 'setCancelAtPeriodEnd').length, 1);
  clock.t = T0 + 29 * DAY_MS;
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
  const r = must(await billing.resume(ctx()));
  assert.equal(r.view.state, 'active');
  assert.equal((await billing.resume(ctx())).ok, false);
  const notCancelling = await billing.resume(ctx());
  assert.equal(!notCancelling.ok && notCancelling.code, 'not_cancelling');
  assert.equal(must(await billing.cancel(ctx())).changed, true);
});

test('G08: a cancelled plan ends at the period end with no event needed, and cannot be resumed', async () => {
  const { billing, ctx, clock, store } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  must(await billing.cancel(ctx()));
  clock.t = T0 + FIXTURE_PERIOD_MS;
  assert.equal((await billing.can('ws-a', 'store')).allowed, false);
  assert.equal((await billing.can('ws-a', 'sample_preview')).allowed, true); // back on Discover
  assert.equal((await store.getSubscription('ws-a'))!.status, 'active'); // reads did not write
  const v = must(await billing.reconcile('ws-a')).view;
  assert.equal(v.state, 'cancelled');
  assert.equal((await store.getSubscription('ws-a'))!.status, 'cancelled');
  const resume = await billing.resume(ctx());
  assert.equal(!resume.ok && resume.code, 'no_subscription');
  const cancel = await billing.cancel(ctx());
  assert.equal(!cancel.ok && cancel.code, 'no_subscription');
  // A new start after cancellation works and replaces the old record.
  assert.equal(must(await billing.startPlan(ctx(), { planId: 'launch' })).view.state, 'active');
});

test('G08: payment failed -> past_due keeps access in grace -> cancelled when grace ends', async () => {
  const { billing, provider, psid, clock, ctx } = world({ graceMs: 3 * DAY_MS });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const id = await psid();
  clock.t = T0 + 31 * DAY_MS;
  assert.equal(await billing.applyEvent(provider.event('payment.failed', id)), 'applied');
  const v = must(await billing.getSubscription('ws-a')).view;
  assert.equal(v.state, 'past_due');
  assert.equal(v.graceEndsAt, T0 + 34 * DAY_MS);
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
  // A retry failure does not extend the grace.
  clock.t = T0 + 32 * DAY_MS;
  await billing.applyEvent(provider.event('payment.failed', id));
  assert.equal(must(await billing.getSubscription('ws-a')).view.graceEndsAt, T0 + 34 * DAY_MS);
  // Upgrading while payment is failing is refused, nothing is charged.
  const up = await billing.changePlan(ctx(), { planId: 'scale' });
  assert.equal(!up.ok && up.code, 'past_due');
  clock.t = T0 + 34 * DAY_MS;
  assert.equal((await billing.can('ws-a', 'store')).allowed, false);
  assert.equal(must(await billing.reconcile('ws-a')).view.state, 'cancelled');
});

test('G08: a payment that recovers during grace returns the plan to active', async () => {
  const { billing, provider, psid, clock, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const id = await psid();
  clock.t = T0 + 31 * DAY_MS;
  await billing.applyEvent(provider.event('payment.failed', id));
  clock.t = T0 + 33 * DAY_MS;
  assert.equal(await billing.applyEvent(provider.event('payment.succeeded', id)), 'applied');
  const v = must(await billing.getSubscription('ws-a')).view;
  assert.equal(v.state, 'past_due'); // period still lapsed: the renewal event has not arrived yet
  assert.equal(await billing.applyEvent(provider.renewalEvent(id, { at: clock.t })), 'applied');
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'active');
});

test('G08: payment.succeeded after a failure inside the period goes straight back to active', async () => {
  const { billing, provider, psid, clock, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const id = await psid();
  clock.t = T0 + 5 * DAY_MS;
  await billing.applyEvent(provider.event('payment.failed', id));
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'past_due');
  clock.t = T0 + 6 * DAY_MS;
  await billing.applyEvent(provider.event('payment.succeeded', id));
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'active');
});

test('G08: a period that ends with no renewal event is treated as past_due, then cancelled after grace', () => {
  const sub = {
    workspaceId: 'w', planId: 'launch', status: 'active', cancelAtPeriodEnd: false, pendingPlanId: null, currentPeriodStart: 0, currentPeriodEnd: 1000,
    graceEndsAt: null, providerSubscriptionId: 'p', lastEventAt: 0, version: 1, createdAt: 0, updatedAt: 0,
  } as const;
  assert.equal(effectiveOf(sub, 999, 500).status, 'active');
  assert.deepEqual(effectiveOf(sub, 1000, 500), { status: 'past_due', planId: 'launch', graceEndsAt: 1500 });
  assert.equal(effectiveOf(sub, 1500, 500).status, 'cancelled');
  assert.equal(effectiveOf(sub, 1500, 500).planId, 'discover');
  assert.equal(effectiveOf(null, 5, 500).status, 'none');
});

test('G08: provider events are idempotent by id', async () => {
  const { billing, provider, psid, store, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const e = provider.event('payment.failed', await psid(), { id: 'evt_same' });
  assert.equal(await billing.applyEvent(e), 'applied');
  const v1 = (await store.getSubscription('ws-a'))!.version;
  assert.equal(await billing.applyEvent(e), 'duplicate');
  assert.equal(await billing.applyEvent({ ...e }), 'duplicate');
  assert.equal((await store.getSubscription('ws-a'))!.version, v1);
  // A renewal delivered twice is charged once.
  const r = provider.renewalEvent(await psid());
  await billing.applyEvent(r);
  await billing.applyEvent(r);
  assert.equal((await store.listCharges('ws-a')).length, 2); // start + one renewal
});

test('G08: an older event arriving late is ignored', async () => {
  const { billing, provider, psid, clock, store, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const id = await psid();
  clock.t = T0 + 10 * DAY_MS;
  const fail = provider.event('payment.failed', id, { at: T0 + 10 * DAY_MS });
  const ok = provider.event('payment.succeeded', id, { at: T0 + 11 * DAY_MS });
  const lateFail = provider.event('payment.failed', id, { at: T0 + 9 * DAY_MS });
  assert.equal(await billing.applyEvent(fail), 'applied');
  assert.equal(await billing.applyEvent(ok), 'applied');
  assert.equal(await billing.applyEvent(lateFail), 'stale');
  assert.equal((await store.getSubscription('ws-a'))!.status, 'active');
  // Delivered out of order from the start: the newer wins whichever arrives first.
  assert.equal(await billing.applyEvent(provider.event('payment.failed', id, { at: T0 + 8 * DAY_MS })), 'stale');
});

test('G08: bad, unknown and ignorable events', async () => {
  const { billing, provider, psid, store, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const id = await psid();
  assert.equal(await billing.applyEvent(null as never), 'invalid');
  assert.equal(await billing.applyEvent({ ...provider.event('payment.failed', id), type: 'x' as never }), 'invalid');
  assert.equal(await billing.applyEvent({ ...provider.event('payment.failed', id), created: -1 }), 'invalid');
  assert.equal(await billing.applyEvent(provider.event('subscription.renewed', id)), 'invalid'); // no period data
  const unknown = provider.event('payment.failed', 'sub_nobody', { id: 'evt_u' });
  assert.equal(await billing.applyEvent(unknown), 'unknown_subscription');
  assert.equal(await store.claimEvent('evt_u'), true); // the unknown event did not use up its id
  // payment.succeeded on an active plan changes nothing; a renewal for a cancelling plan is not applied.
  assert.equal(await billing.applyEvent(provider.event('payment.succeeded', id)), 'ignored');
  must(await billing.cancel(ctx()));
  const before = (await store.getSubscription('ws-a'))!.currentPeriodEnd;
  assert.equal(await billing.applyEvent(provider.renewalEvent(id)), 'ignored');
  assert.equal((await store.getSubscription('ws-a'))!.currentPeriodEnd, before);
  // The provider says it ended: cancelled, and later events do nothing.
  assert.equal(await billing.applyEvent(provider.event('subscription.cancelled', id, { at: T0 + 31 * DAY_MS })), 'applied');
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'cancelled');
  assert.equal(await billing.applyEvent(provider.event('payment.succeeded', id, { at: T0 + 32 * DAY_MS })), 'ignored');
});

test('G08: a store failure while applying an event gives the event id back so a retry works', async () => {
  const base = createMemoryBillingStore();
  let failWrites = false;
  const store: BillingStore = { ...base, putSubscription: async (s, v) => { if (failWrites) throw new Error('db down'); return base.putSubscription(s, v); } };
  const { billing, provider, psid, ctx } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const e = provider.event('payment.failed', await psid());
  failWrites = true;
  assert.equal(await billing.applyEvent(e), 'unavailable');
  failWrites = false;
  assert.equal(await billing.applyEvent(e), 'applied');
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'past_due');
});

test('G08: one workspace can never read or change another workspace\'s subscription', async () => {
  const { billing, ctx, store, provider } = world();
  must(await billing.startPlan(ctx('ws-a'), { planId: 'scale' }));
  // ws-b sees nothing of ws-a.
  assert.equal(must(await billing.getSubscription('ws-b')).view.state, 'none');
  assert.equal((await billing.can('ws-b', 'multiple_businesses')).allowed, false);
  assert.equal((await billing.can('ws-a', 'multiple_businesses')).allowed, true);
  // ws-b's own cancel, change and resume find no subscription and leave ws-a alone.
  for (const r of [await billing.cancel(ctx('ws-b')), await billing.changePlan(ctx('ws-b'), { planId: 'launch' }), await billing.resume(ctx('ws-b'))]) {
    assert.equal(!r.ok && r.code, 'no_subscription');
  }
  const a = (await store.getSubscription('ws-a'))!;
  assert.equal(a.cancelAtPeriodEnd, false);
  assert.equal(a.planId, 'scale');
  assert.equal(await store.getSubscription('ws-b'), null);
  // A second workspace on its own plan; events reach only the owner of that provider subscription.
  must(await billing.startPlan(ctx('ws-b'), { planId: 'launch' }));
  const bId = (await store.getSubscription('ws-b'))!.providerSubscriptionId;
  await billing.applyEvent(provider.event('payment.failed', bId));
  assert.equal(must(await billing.getSubscription('ws-b')).view.state, 'past_due');
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'active');
  // Usage is per workspace.
  assert.equal((await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', amount: 5 })).allowed, true);
  const rb = await billing.remaining('ws-b', 'products');
  assert.equal(rb.ok && rb.used, 0);
  // The store cannot attach one provider subscription to two workspaces.
  await assert.rejects(() => store.putSubscription({ ...a, workspaceId: 'ws-c' }, null));
});

test('G08: fail closed when the subscription cannot be read', async () => {
  const base = createMemoryBillingStore();
  let broken = false;
  const calls: string[] = [];
  const store: BillingStore = {
    ...base,
    getSubscription: async (w) => { if (broken) throw new Error('db down'); return base.getSubscription(w); },
    addUsage: async (...a) => { calls.push('addUsage'); return base.addUsage(...a); },
  };
  const { billing, ctx } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'scale' }));
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
  broken = true;
  const can = await billing.can('ws-a', 'store');
  assert.equal(can.allowed, false);
  assert.equal(!can.allowed && can.reason, 'subscription_unreadable');
  // Even a feature the free plan has is refused: an unreadable answer is never a silent allow.
  assert.equal((await billing.can('ws-a', 'sample_preview')).allowed, false);
  const rem = await billing.remaining('ws-a', 'products');
  assert.equal(rem.ok, false);
  const used = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' });
  assert.equal(used.allowed, false);
  assert.equal(!used.allowed && used.reason, 'unavailable');
  assert.deepEqual(calls, []);
  for (const r of [await billing.cancel(ctx()), await billing.changePlan(ctx(), { planId: 'launch' }), await billing.startPlan(ctx(), { planId: 'launch' }), await billing.resume(ctx())]) {
    assert.equal(!r.ok && r.code, 'unavailable');
  }
  assert.equal((await billing.getSubscription('ws-a')).ok, false);
});

test('G08: fail closed when usage cannot be read or written', async () => {
  const base = createMemoryBillingStore();
  const modes = { read: false, write: false };
  const store: BillingStore = {
    ...base,
    getUsage: async (...a) => { if (modes.read) throw new Error('db down'); return base.getUsage(...a); },
    addUsage: async (...a) => { if (modes.write) throw new Error('db down'); return base.addUsage(...a); },
  };
  const { billing, ctx } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  modes.write = true;
  const w = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' });
  assert.equal(!w.allowed && w.reason, 'unavailable');
  modes.write = false;
  modes.read = true;
  const r = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' });
  assert.equal(!r.allowed && r.reason, 'unavailable');
  assert.equal((await billing.remaining('ws-a', 'products')).ok, false);
  modes.read = false;
  const ok = await billing.remaining('ws-a', 'products');
  assert.equal(ok.ok && ok.used, 0); // nothing was counted by the failed calls
});

test('G08: usage counts against the plan allowance and stops at the limit', async () => {
  const { billing, ctx } = world();
  const free = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' });
  assert.equal(!free.allowed && free.reason, 'not_in_plan');
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const limit = PLANS.launch.allowances.ai_generations;
  const r = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations', amount: limit - 1 });
  assert.equal(r.allowed && r.remaining, 1);
  assert.equal((await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations' })).allowed, true);
  const over = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations' });
  assert.equal(!over.allowed && over.reason, 'limit_reached');
  assert.equal(!over.allowed && over.usage?.used, limit);
  for (const amount of [0, -1, 1.5, 1001, Number.NaN]) {
    const bad = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations', amount });
    assert.equal(!bad.allowed && bad.reason, 'invalid_request');
  }
  const noMeter = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'nope' as never });
  assert.equal(!noMeter.allowed && noMeter.reason, 'invalid_request');
  const rem = await billing.remaining('ws-a', 'ai_generations');
  assert.equal(rem.ok && rem.remaining, 0);
});

test('G08: two simultaneous recordings at the limit cannot both pass', async () => {
  const { billing, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const limit = PLANS.launch.allowances.ai_generations;
  await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations', amount: limit - 1 });
  const two = await Promise.all([billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations' }), billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations' })]);
  assert.equal(two.filter((r) => r.allowed).length, 1);
  // A crowd from a clean meter: exactly `limit` succeed.
  const crowd = await Promise.all(Array.from({ length: 100 }, () => billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' })));
  assert.equal(crowd.filter((r) => r.allowed).length, PLANS.launch.allowances.products);
  const rem = await billing.remaining('ws-a', 'products');
  assert.equal(rem.ok && rem.used, PLANS.launch.allowances.products);
});

test('G08: a repeated usage key spends once', async () => {
  const { billing, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const a = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', key: 'job-1' });
  const b = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', key: 'job-1' });
  assert.equal(a.allowed && a.replay, false);
  assert.equal(b.allowed && b.replay, true);
  const rem = await billing.remaining('ws-a', 'products');
  assert.equal(rem.ok && rem.used, 1);
});

test('G08: the allowance resets on renewal; an upgrade raises the limit and keeps what was used', async () => {
  const { billing, ctx, provider, psid, clock } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const lim = PLANS.launch.allowances.products;
  await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', amount: lim });
  assert.equal((await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' })).allowed, false);
  must(await billing.changePlan(ctx(), { planId: 'autopilot' }));
  const after = await billing.remaining('ws-a', 'products');
  assert.equal(after.ok && after.used, lim);
  assert.equal(after.ok && after.remaining, PLANS.autopilot.allowances.products - lim);
  clock.t = T0 + FIXTURE_PERIOD_MS;
  await billing.applyEvent(provider.renewalEvent(await psid()));
  const fresh = await billing.remaining('ws-a', 'products');
  assert.equal(fresh.ok && fresh.used, 0);
  assert.equal(fresh.ok && fresh.resetsAt, T0 + 2 * FIXTURE_PERIOD_MS);
});

test('G08: free-plan usage resets on the UTC calendar month', async () => {
  const { billing, clock } = world();
  clock.t = Date.UTC(2026, 10, 20);
  await billing.recordUsage({ workspaceId: 'ws-a', meter: 'opportunity_suggestions', amount: 5 });
  assert.equal((await billing.recordUsage({ workspaceId: 'ws-a', meter: 'opportunity_suggestions' })).allowed, false);
  clock.t = Date.UTC(2026, 11, 1);
  const r = await billing.remaining('ws-a', 'opportunity_suggestions');
  assert.equal(r.ok && r.used, 0);
  assert.equal(r.ok && r.periodKey, '2026-12');
});

test('G08: provider failures change nothing', async () => {
  const { billing, ctx, provider, store } = world();
  provider.failNext('payment_failed');
  const declined = await billing.startPlan(ctx(), { planId: 'launch' });
  assert.equal(!declined.ok && declined.code, 'payment_failed');
  assert.equal(await store.getSubscription('ws-a'), null);
  provider.failNext('unavailable');
  const down = await billing.startPlan(ctx(), { planId: 'launch' });
  assert.equal(!down.ok && down.code, 'provider_unavailable');
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  provider.failNext('payment_failed');
  const up = await billing.changePlan(ctx(), { planId: 'scale' });
  assert.equal(!up.ok && up.code, 'payment_failed');
  assert.equal((await store.getSubscription('ws-a'))!.planId, 'launch');
  provider.failNext('unavailable');
  assert.equal((await billing.cancel(ctx())).ok, false);
  assert.equal((await store.getSubscription('ws-a'))!.cancelAtPeriodEnd, false);
  assert.equal((await store.listCharges('ws-a')).length, 1);
});

test('G08: two simultaneous plan changes for one workspace: one wins, one is a conflict', async () => {
  const { billing, ctx, store } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const [x, y] = await Promise.all([billing.changePlan(ctx(), { planId: 'autopilot' }), billing.changePlan(ctx(), { planId: 'scale' })]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  const loser = [x, y].find((r) => !r.ok);
  assert.equal(loser && !loser.ok && loser.code, 'conflict');
  assert.ok(['autopilot', 'scale'].includes((await store.getSubscription('ws-a'))!.planId));
});

test('G08: the fixture provider is deterministic and replays an idempotency key', async () => {
  const mk = () => createFixtureBillingProvider({ now: () => T0 });
  const run = async () => {
    const p = mk();
    const a = await p.createSubscription({ workspaceId: 'w', planId: 'launch', priceMinor: 7900, trialDays: 0, idempotencyKey: 'k' });
    const b = await p.createSubscription({ workspaceId: 'w', planId: 'launch', priceMinor: 7900, trialDays: 0, idempotencyKey: 'k' });
    assert.deepEqual(a, b);
    assert.equal(p.calls.length, 1);
    return a;
  };
  assert.deepEqual(await run(), await run());
});

// ---- fix round (AMP-044 review) ----------------------------------------------------------------------------------------

test('G08 fix 1: a renewal whose charge fails to store is applied on the retry with exactly one charge', async () => {
  const base = createMemoryBillingStore();
  let failCharge = 0;
  const store: BillingStore = { ...base, recordCharge: async (...a) => { if (failCharge > 0) { failCharge--; throw new Error('db down'); } return base.recordCharge(...a); } };
  const { billing, provider, psid, ctx, clock } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const e = provider.renewalEvent(await psid());
  clock.t = T0 + 30 * DAY_MS;
  failCharge = 1;
  assert.equal(await billing.applyEvent(e), 'unavailable');
  assert.equal((await store.listCharges('ws-a')).length, 1); // only the start charge so far
  assert.equal(await billing.applyEvent(e), 'applied'); // the provider's retry
  assert.equal((await store.listCharges('ws-a')).length, 2);
  assert.equal(await billing.applyEvent(e), 'duplicate');
  assert.equal((await store.listCharges('ws-a')).length, 2);
});

test('G08 fix 1: a renewal whose subscription write fails after the charge is stored still ends with one charge', async () => {
  const base = createMemoryBillingStore();
  let failWrite = 0;
  const store: BillingStore = { ...base, putSubscription: async (s, v) => { if (failWrite > 0) { failWrite--; throw new Error('db down'); } return base.putSubscription(s, v); } };
  const { billing, provider, psid, ctx } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const e = provider.renewalEvent(await psid());
  failWrite = 1;
  assert.equal(await billing.applyEvent(e), 'unavailable');
  assert.equal(await billing.applyEvent(e), 'applied');
  assert.deepEqual((await store.listCharges('ws-a')).map((c) => c.amountMinor), [7900, 7900]);
});

test('G08 fix 1: start and upgrade file their charge once when the first attempt fails to store it', async () => {
  const base = createMemoryBillingStore();
  let failCharge = 0;
  const store: BillingStore = { ...base, recordCharge: async (...a) => { if (failCharge > 0) { failCharge--; throw new Error('db down'); } return base.recordCharge(...a); } };
  const { billing, ctx } = world({ store });
  const startCtx = ctx();
  failCharge = 1;
  assert.equal((await billing.startPlan(startCtx, { planId: 'launch' })).ok, false);
  assert.equal((await store.getSubscription('ws-a')), null); // nothing half done
  must(await billing.startPlan(startCtx, { planId: 'launch' })); // same key: the provider replays, the charge is filed now
  assert.equal((await store.listCharges('ws-a')).length, 1);
  const upCtx = ctx();
  failCharge = 1;
  assert.equal((await billing.changePlan(upCtx, { planId: 'autopilot' })).ok, false);
  assert.equal((await store.getSubscription('ws-a'))!.planId, 'launch');
  must(await billing.changePlan(upCtx, { planId: 'autopilot' }));
  assert.equal((await store.getSubscription('ws-a'))!.planId, 'autopilot');
  assert.equal((await store.listCharges('ws-a')).length, 2);
});

test('G08 fix 2: a genuine renewal after the clock cancelled the plan reopens it, whether or not reconcile ran', async () => {
  for (const reconcileFirst of [true, false]) {
    const { billing, provider, psid, ctx, clock, store } = world({ graceMs: 3 * DAY_MS });
    must(await billing.startPlan(ctx(), { planId: 'launch' }));
    const id = await psid();
    clock.t = T0 + 40 * DAY_MS; // 30 day period + 3 day grace is long gone
    assert.equal((await billing.can('ws-a', 'store')).allowed, false);
    if (reconcileFirst) assert.equal(must(await billing.reconcile('ws-a')).view.state, 'cancelled');
    assert.equal(await billing.applyEvent(provider.renewalEvent(id, { at: clock.t })), 'applied');
    assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'active');
    assert.equal((await billing.can('ws-a', 'store')).allowed, true);
    assert.equal((await store.getSubscription('ws-a'))!.cancelledBy ?? null, null);
    assert.equal((await store.listCharges('ws-a')).length, 2);
  }
});

test('G08 fix 2: a plan the provider (or the owner) cancelled is not reopened by a later renewal', async () => {
  const a = world();
  must(await a.billing.startPlan(a.ctx(), { planId: 'launch' }));
  const id = await a.psid();
  assert.equal(await a.billing.applyEvent(a.provider.event('subscription.cancelled', id, { at: T0 + DAY_MS })), 'applied');
  assert.equal(await a.billing.applyEvent(a.provider.renewalEvent(id, { at: T0 + 31 * DAY_MS })), 'ignored');
  assert.equal(must(await a.billing.getSubscription('ws-a')).view.state, 'cancelled');

  const b = world();
  must(await b.billing.startPlan(b.ctx(), { planId: 'launch' }));
  must(await b.billing.cancel(b.ctx()));
  b.clock.t = T0 + 31 * DAY_MS;
  must(await b.billing.reconcile('ws-a'));
  assert.equal(await b.billing.applyEvent(b.provider.renewalEvent(await b.psid(), { at: b.clock.t })), 'ignored');
  assert.equal(must(await b.billing.getSubscription('ws-a')).view.state, 'cancelled');

  // A clock-cancelled plan is not reopened by a replay of the OLD period.
  const c = world({ graceMs: DAY_MS });
  must(await c.billing.startPlan(c.ctx(), { planId: 'launch' }));
  c.clock.t = T0 + 40 * DAY_MS;
  must(await c.billing.reconcile('ws-a'));
  const old = c.provider.event('subscription.renewed', await c.psid(), { at: c.clock.t, periodStart: T0, periodEnd: T0 + 30 * DAY_MS, amountMinor: 7900 });
  assert.equal(await c.billing.applyEvent(old), 'ignored');
});

test('G08 fix 3: plan prices must be whole cents', async () => {
  const { toMinor } = await import('../lib/aimp/billing/index.ts');
  assert.equal(toMinor(79), 7900);
  assert.equal(toMinor(79.99), 7999);
  assert.equal(toMinor(0), 0);
  assert.equal(toMinor(1.1), 110);
  for (const bad of [79.999, 0.005, -1, Number.NaN, Number.POSITIVE_INFINITY, '79', null, undefined, 1e300]) assert.throws(() => toMinor(bad), `${String(bad)}`);
  assert.ok(listPlans().every((p) => Number.isSafeInteger(p.priceMinor) && p.priceMinor >= 0));
});

test('G08 fix 4: a stored record that cannot be trusted fails closed, never throws, never silently allows', async () => {
  const base = createMemoryBillingStore();
  let corrupt: 'none' | 'plan' | 'end' | 'pending' = 'none';
  const store: BillingStore = {
    ...base,
    getSubscription: async (w) => {
      const s = await base.getSubscription(w);
      if (!s) return s;
      if (corrupt === 'plan') return { ...s, planId: 'bogus' as never };
      if (corrupt === 'end') return { ...s, currentPeriodEnd: Number.NaN };
      if (corrupt === 'pending') return { ...s, pendingPlanId: 'bogus' as never };
      return s;
    },
  };
  const { billing, provider, psid, ctx } = world({ store });
  must(await billing.startPlan(ctx(), { planId: 'scale' }));
  const id = await psid();
  for (const kind of ['plan', 'end', 'pending'] as const) {
    corrupt = kind;
    const can = await billing.can('ws-a', 'sample_preview');
    assert.equal(can.allowed, false, kind);
    assert.equal(!can.allowed && can.reason, 'subscription_unreadable');
    assert.equal((await billing.remaining('ws-a', 'products')).ok, false);
    const used = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products' });
    assert.equal(!used.allowed && used.reason, 'unavailable');
    assert.equal((await billing.getSubscription('ws-a')).ok, false);
    assert.equal((await billing.reconcile('ws-a')).ok, false);
    for (const r of [await billing.cancel(ctx()), await billing.resume(ctx()), await billing.changePlan(ctx(), { planId: 'launch' })]) assert.equal(!r.ok && r.code, 'unavailable');
    const e = provider.event('payment.failed', id);
    assert.equal(await billing.applyEvent(e), 'unavailable');
    assert.equal(await base.claimEvent(e.id), true); // the claim was given back, so the retry can work later
    await base.releaseEvent(e.id);
  }
  corrupt = 'none';
  assert.equal((await billing.can('ws-a', 'store')).allowed, true);
});

test('G08 fix 5: odd workspace ids such as __proto__ and constructor are fully isolated', async () => {
  const { billing, ctx, store } = world();
  for (const ws of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal((await billing.can(ws, 'store')).allowed, false);
    must(await billing.startPlan(ctx(ws), { planId: 'launch' }));
    assert.equal((await billing.can(ws, 'store')).allowed, true);
    assert.equal((await billing.recordUsage({ workspaceId: ws, meter: 'products', amount: 4 })).allowed, true);
  }
  // Nothing leaked to ordinary workspaces or to each other.
  assert.equal((await billing.can('ws-a', 'store')).allowed, false);
  assert.equal(must(await billing.getSubscription('ws-a')).view.state, 'none');
  const c = await billing.remaining('constructor', 'products');
  assert.equal(c.ok && c.used, 4);
  must(await billing.cancel(ctx('__proto__')));
  assert.equal((await store.getSubscription('constructor'))!.cancelAtPeriodEnd, false);
  assert.equal(({} as Record<string, unknown>).planId, undefined);
  assert.equal((await billing.recordUsage({ workspaceId: '__proto__', meter: 'products' })).allowed, true);
  const ps = (await store.getSubscription('__proto__'))!.providerSubscriptionId;
  assert.notEqual(ps, (await store.getSubscription('constructor'))!.providerSubscriptionId);
});

// ---- AMP-166 hardening ---------------------------------------------------------------------------------------------------

test('G08 AMP-166: the fixture provider refuses a reused idempotency key that arrives with a different request', async () => {
  const p = createFixtureBillingProvider({ now: () => T0 });
  const base = { workspaceId: 'w', planId: 'launch' as PlanId, priceMinor: 7900, trialDays: 0, idempotencyKey: 'k' };
  const first = await p.createSubscription(base);
  assert.deepEqual(await p.createSubscription({ ...base }), first); // identical request still replays
  await assert.rejects(() => p.createSubscription({ ...base, planId: 'scale', priceMinor: 24900 }), (e: unknown) => e instanceof BillingProviderError && e.code === 'idempotency_conflict');
  await assert.rejects(() => p.createSubscription({ ...base, workspaceId: 'other' }), /different request/);
  // Across methods too: the same key cannot be a plan change or a cancel.
  await assert.rejects(() => p.changePlan({ providerSubscriptionId: first.providerSubscriptionId, planId: 'scale', priceMinor: 24900, timing: 'immediate', idempotencyKey: 'k' }), /different request/);
  await assert.rejects(() => p.setCancelAtPeriodEnd({ providerSubscriptionId: first.providerSubscriptionId, cancel: true, idempotencyKey: 'k' }), /different request/);
  assert.equal(p.calls.length, 1, 'no refused request reached the provider');
  assert.equal(p.inspect(first.providerSubscriptionId)?.planId, 'launch');
  // changePlan / cancel keys: same key, different target is refused; same request replays.
  const chg = { providerSubscriptionId: first.providerSubscriptionId, planId: 'autopilot' as PlanId, priceMinor: 14900, timing: 'immediate' as const, idempotencyKey: 'c1' };
  await p.changePlan(chg);
  await assert.rejects(() => p.changePlan({ ...chg, planId: 'scale', priceMinor: 24900 }), /different request/);
  await p.setCancelAtPeriodEnd({ providerSubscriptionId: first.providerSubscriptionId, cancel: true, idempotencyKey: 'x1' });
  await assert.rejects(() => p.setCancelAtPeriodEnd({ providerSubscriptionId: first.providerSubscriptionId, cancel: false, idempotencyKey: 'x1' }), /different request/);
  assert.equal(p.inspect(first.providerSubscriptionId)?.cancelAtPeriodEnd, true);
});

test('G08 AMP-166: the service turns a provider idempotency conflict into a safe invalid refusal and changes nothing', async () => {
  const store = createMemoryBillingStore();
  const real = createFixtureBillingProvider({ now: () => T0 });
  const provider = { ...real, createSubscription: async () => { throw new BillingProviderError('idempotency_conflict', 'reused key'); } };
  const billing = createBillingService({ store, provider, now: () => T0 });
  const r = await billing.startPlan({ workspaceId: 'ws-a', actorUserId: 'u', idempotencyKey: 'k1' }, { planId: 'launch' });
  assert.equal(!r.ok && r.code, 'invalid');
  assert.equal(await store.getSubscription('ws-a'), null);
  assert.deepEqual(await store.listCharges('ws-a'), []);
});

test('G08 AMP-166: a usage key replayed across a period boundary does not spend twice', async () => {
  const { billing, ctx, provider, psid, clock } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const first = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', key: 'job-9' });
  assert.equal(first.allowed && first.replay, false);
  clock.t = T0 + FIXTURE_PERIOD_MS;
  await billing.applyEvent(provider.renewalEvent(await psid())); // a new period starts: allowance reset
  const fresh = await billing.remaining('ws-a', 'products');
  assert.equal(fresh.ok && fresh.used, 0);
  const again = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', key: 'job-9' }); // the retry arrives late
  assert.equal(again.allowed && again.replay, true, 'a replay, not a second spend');
  const after = await billing.remaining('ws-a', 'products');
  assert.equal(after.ok && after.used, 0, 'nothing was spent in the new period');
  // A different key still spends; the same key on another meter or workspace is independent.
  assert.equal((await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', key: 'job-10' })).allowed, true);
  const other = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'ai_generations', key: 'job-9' });
  assert.equal(other.allowed && other.replay, false);
});

test('G08 AMP-166: starting a plan over a clock-cancelled subscription ends the old provider subscription (no double billing)', async () => {
  const { billing, ctx, provider, store, psid, clock } = world({ graceMs: DAY_MS });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const oldId = await psid();
  clock.t = T0 + 40 * DAY_MS; // the period and the grace are gone, no renewal and no cancel event ever arrived
  assert.equal(provider.inspect(oldId)?.cancelAtPeriodEnd, false, 'the provider still has it live');
  must(await billing.startPlan(ctx(), { planId: 'autopilot' }));
  assert.equal(provider.inspect(oldId)?.cancelAtPeriodEnd, true, 'the old provider subscription was told to end');
  const fresh = (await store.getSubscription('ws-a'))!;
  assert.notEqual(fresh.providerSubscriptionId, oldId);
  assert.equal(provider.inspect(fresh.providerSubscriptionId)?.cancelAtPeriodEnd, false, 'the new one is live');
  assert.equal(fresh.planId, 'autopilot');
  // Same when reconcile had already written cancelledBy: 'clock'.
  const w = world({ graceMs: DAY_MS });
  must(await w.billing.startPlan(w.ctx(), { planId: 'launch' }));
  const id = await w.psid();
  w.clock.t = T0 + 40 * DAY_MS;
  must(await w.billing.reconcile('ws-a'));
  assert.equal((await w.store.getSubscription('ws-a'))!.cancelledBy, 'clock');
  must(await w.billing.startPlan(w.ctx(), { planId: 'autopilot' }));
  assert.equal(w.provider.inspect(id)?.cancelAtPeriodEnd, true);
});

test('G08 AMP-166: replacing a plan the owner or provider already ended does not call the provider to end it again', async () => {
  const a = world();
  must(await a.billing.startPlan(a.ctx(), { planId: 'launch' }));
  must(await a.billing.cancel(a.ctx()));
  a.clock.t = T0 + 31 * DAY_MS;
  const before = a.provider.calls.filter((c) => c.method === 'setCancelAtPeriodEnd').length;
  must(await a.billing.startPlan(a.ctx(), { planId: 'launch' }));
  assert.equal(a.provider.calls.filter((c) => c.method === 'setCancelAtPeriodEnd').length, before);
  const b = world();
  must(await b.billing.startPlan(b.ctx(), { planId: 'launch' }));
  await b.billing.applyEvent(b.provider.event('subscription.cancelled', await b.psid(), { at: T0 + DAY_MS }));
  must(await b.billing.startPlan(b.ctx(), { planId: 'launch' }));
  assert.equal(b.provider.calls.filter((c) => c.method === 'setCancelAtPeriodEnd').length, 0);
});

test('G08 AMP-172: the old subscription was told to end but createSubscription then failed: free plan, no charge, a retry (same or new key) creates exactly one subscription', async () => {
  for (const retryKey of ['same', 'new'] as const) {
    const clock = { t: T0 };
    const store = createMemoryBillingStore();
    const real = createFixtureBillingProvider({ now: () => clock.t });
    let breakCreate = false;
    const provider = { ...real, createSubscription: async (req: Parameters<typeof real.createSubscription>[0]) => { if (breakCreate) throw new BillingProviderError('unavailable', 'create failed'); return real.createSubscription(req); } };
    const billing = createBillingService({ store, provider, now: () => clock.t, graceMs: DAY_MS });
    const ctx = (key: string) => ({ workspaceId: 'ws-a', actorUserId: 'user-1', idempotencyKey: key });
    must(await billing.startPlan(ctx('first'), { planId: 'launch' }));
    const oldId = (await store.getSubscription('ws-a'))!.providerSubscriptionId;
    const chargesBefore = (await store.listCharges('ws-a')).length;
    clock.t = T0 + 40 * DAY_MS; // our clock ended it; the provider still has it
    breakCreate = true;
    const failed = await billing.startPlan(ctx('second'), { planId: 'autopilot' });
    assert.equal(!failed.ok && failed.code, 'provider_unavailable');
    assert.equal(real.inspect(oldId)?.cancelAtPeriodEnd, true, 'the old provider subscription was told to end');
    const view = must(await billing.getSubscription('ws-a')).view;
    assert.equal(view.planId, 'discover', 'the customer is on the free plan');
    assert.equal((await store.listCharges('ws-a')).length, chargesBefore, 'nothing new was charged');
    const createsAfterFailure = real.calls.filter((c) => c.method === 'createSubscription').length;
    breakCreate = false;
    const ok = must(await billing.startPlan(ctx(retryKey === 'same' ? 'second' : 'third'), { planId: 'autopilot' }));
    assert.equal(ok.view.planId, 'autopilot', retryKey);
    assert.equal(real.calls.filter((c) => c.method === 'createSubscription').length, createsAfterFailure + 1, `exactly one new provider subscription (${retryKey} key)`);
    assert.equal((await store.listCharges('ws-a')).length, chargesBefore + 1, 'exactly one new charge');
  }
});

test('G08 AMP-172: a reused usage key reaches the caller as replay: true and spends nothing more', async () => {
  const { billing, ctx } = world();
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const first = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', amount: 2, key: 'job-1' });
  const again = await billing.recordUsage({ workspaceId: 'ws-a', meter: 'products', amount: 2, key: 'job-1' });
  assert.ok(first.allowed && again.allowed);
  if (first.allowed && again.allowed) {
    assert.equal(first.replay, false);
    assert.equal(again.replay, true, 'the visible signal a caller must log');
    assert.equal(again.used, first.used, 'no second spend');
  }
});

test('G08 AMP-166: if the old provider subscription cannot be ended, the new plan is not started', async () => {
  const { billing, ctx, provider, store, clock } = world({ graceMs: DAY_MS });
  must(await billing.startPlan(ctx(), { planId: 'launch' }));
  const old = (await store.getSubscription('ws-a'))!;
  clock.t = T0 + 40 * DAY_MS;
  provider.failNext('unavailable');
  const r = await billing.startPlan(ctx(), { planId: 'autopilot' });
  assert.equal(!r.ok && r.code, 'provider_unavailable');
  assert.deepEqual(await store.getSubscription('ws-a'), old, 'nothing changed');
  assert.equal(provider.calls.filter((c) => c.method === 'createSubscription').length, 1, 'no second subscription was created');
});
