import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFlags } from '../lib/aimp/flags.ts';
import { resolveStatus } from '../lib/aimp/providers/status.ts';
import {
  DISCONNECTED_REASON,
  FIXTURE_SELLERS,
  checkoutGate,
  createDisconnectedStripeConnect,
  createFixtureStripeConnect,
  createInMemorySellerStore,
  deriveReadiness,
  platformSubscriptionCharge,
  platformSubscriptionTotal,
  sellerCharge,
  sellerRevenueTotals,
  sellerStates,
  type AccountUpdatedEvent,
  type SellerState,
  type StripeAccountSnapshot,
} from '../lib/aimp/sellers/index.ts';

const fx = (k: SellerState) => FIXTURE_SELLERS.find((s) => s.key === k)!;
const okPayments = { status: 'fixture', label: 'Stripe: demo data' } as const;

function storeWith(snapshot: StripeAccountSnapshot | null, ws = 'ws-a', biz = 'biz-1') {
  const store = createInMemorySellerStore();
  if (snapshot) store.register({ workspaceId: ws, businessId: biz, stripeAccountId: snapshot.id, snapshot, lastEventCreated: 0 });
  return store;
}

const EXPECTED: Record<SellerState, { kind: string; canAccept: boolean }> = {
  not_connected: { kind: 'connect', canAccept: false },
  onboarding_incomplete: { kind: 'continue_onboarding', canAccept: false },
  under_review: { kind: 'wait', canAccept: false },
  restricted: { kind: 'fix_requirements', canAccept: false },
  ready: { kind: 'none', canAccept: true },
};

test('every readiness state has a fixture, a plain-English next action and the right canAcceptPayments', () => {
  assert.deepEqual(FIXTURE_SELLERS.map((s) => s.key).sort(), [...sellerStates].sort());
  for (const s of FIXTURE_SELLERS) {
    const r = deriveReadiness(s.snapshot);
    assert.equal(r.state, s.key);
    assert.equal(r.nextAction.kind, EXPECTED[s.key].kind);
    assert.equal(r.canAcceptPayments, EXPECTED[s.key].canAccept);
    assert.ok(r.nextAction.label.length > 0 && r.nextAction.why.length > 0);
    // No raw Stripe field paths or jargon leak into beginner copy.
    assert.doesNotMatch(`${r.nextAction.label} ${r.nextAction.why}`, /requirements\.|business_profile|individual\.|_/);
  }
});

test('incomplete accounts name what is missing; past-due is restricted; Stripe-paused accounts go to support', () => {
  const inc = deriveReadiness(fx('onboarding_incomplete').snapshot);
  assert.match(inc.nextAction.why, /bank account/);
  assert.ok(inc.outstanding.length > 0);
  const restricted = deriveReadiness(fx('restricted').snapshot);
  assert.match(restricted.nextAction.why, /photo of your ID/);
  for (const reason of ['rejected.fraud', 'platform_paused', 'listed', 'something.new']) {
    const snap = { ...fx('ready').snapshot!, charges_enabled: false, requirements: { currently_due: [], past_due: [], disabled_reason: reason } };
    const r = deriveReadiness(snap);
    assert.equal(r.state, 'restricted', reason);
    assert.equal(r.nextAction.kind, 'contact_support');
    assert.equal(r.canAcceptPayments, false);
  }
});

test('fails closed: any missing piece of a fully enabled account is not ready', () => {
  const ready = fx('ready').snapshot!;
  const variants: StripeAccountSnapshot[] = [
    { ...ready, charges_enabled: false },
    { ...ready, payouts_enabled: false },
    { ...ready, capabilities: { card_payments: 'active', transfers: 'pending' } },
    { ...ready, capabilities: { card_payments: 'inactive', transfers: 'active' } },
    { ...ready, capabilities: {} },
    { ...ready, requirements: { ...ready.requirements, currently_due: ['external_account'] } },
  ];
  for (const v of variants) assert.equal(deriveReadiness(v).canAcceptPayments, false);
});

test('checkout gate: enabled only for a ready seller, with a reason and next step for each other state', () => {
  for (const s of FIXTURE_SELLERS) {
    const gate = checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts: storeWith(s.snapshot), payments: okPayments });
    assert.equal(gate.enabled, s.key === 'ready', s.key);
    if (s.key === 'ready') assert.equal(gate.code, 'ok');
    else {
      assert.equal(gate.code, s.key === 'not_connected' ? 'seller_not_found' : 'seller_not_ready');
      assert.ok(gate.reason.length > 0 && gate.nextActionLabel.length > 0);
    }
  }
});

test('checkout gate: a ready seller is still disabled when the Stripe provider is disabled or disconnected', () => {
  const accounts = storeWith(fx('ready').snapshot);
  const disabled = resolveStatus('payments', {}, parseFlags({ AIMP_PAYMENTS_ENABLED: 'off' }));
  const disconnected = resolveStatus('payments', {}, parseFlags({ AIMP_FIXTURES_ALLOWED: '0' }));
  assert.equal(disabled.status, 'disabled');
  assert.equal(disconnected.status, 'disconnected');
  for (const p of [disabled, disconnected]) {
    const g = checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: p });
    assert.equal(g.enabled, false);
    assert.equal(g.code, 'provider_off');
  }
  const fixture = resolveStatus('payments', {}, parseFlags({}));
  assert.equal(checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: fixture }).enabled, true);
});

const event = (id: string, snapshot: StripeAccountSnapshot, created = 100, account = snapshot.id): AccountUpdatedEvent => ({
  id, type: 'account.updated', account, created, data: { object: snapshot },
});

test('account.updated is idempotent: the same event id twice applies once', async () => {
  const connect = createFixtureStripeConnect();
  const created = await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  assert.ok(created.ok);
  const id = created.ok ? created.value.stripeAccountId : '';
  assert.equal(deriveReadiness(connect.store.get('ws-a', 'biz-1')!.snapshot).state, 'onboarding_incomplete');

  const ready = { ...fx('ready').snapshot!, id };
  const first = await connect.handleAccountUpdatedEvent(event('evt_1', ready));
  assert.deepEqual(first, { handled: true, outcome: 'applied', businessId: 'biz-1' });
  assert.equal(deriveReadiness(connect.store.get('ws-a', 'biz-1')!.snapshot).state, 'ready');

  // Same id replayed after the account later changed: must not overwrite the newer state.
  const restricted = { ...fx('restricted').snapshot!, id };
  assert.equal((await connect.handleAccountUpdatedEvent(event('evt_2', restricted, 200))).handled, true);
  const replay = await connect.handleAccountUpdatedEvent(event('evt_1', ready, 100));
  assert.deepEqual(replay, { handled: false, outcome: 'duplicate' });
  assert.equal(deriveReadiness(connect.store.get('ws-a', 'biz-1')!.snapshot).state, 'restricted');
});

test('older events are dropped as stale; unknown accounts, bad shapes and other types are ignored', async () => {
  const connect = createFixtureStripeConnect();
  const created = await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  const id = created.ok ? created.value.stripeAccountId : '';
  await connect.handleAccountUpdatedEvent(event('evt_new', { ...fx('ready').snapshot!, id }, 500));
  const stale = await connect.handleAccountUpdatedEvent(event('evt_old', { ...fx('restricted').snapshot!, id }, 400));
  assert.deepEqual(stale, { handled: false, outcome: 'stale' });
  assert.equal(deriveReadiness(connect.store.get('ws-a', 'biz-1')!.snapshot).state, 'ready');

  const unknown = await connect.handleAccountUpdatedEvent(event('evt_x', { ...fx('ready').snapshot!, id: 'acct_nobody' }));
  assert.deepEqual(unknown, { handled: false, outcome: 'unknown_account' });
  assert.equal(connect.store.get('ws-a', 'acct_nobody'), null);
  assert.equal(connect.store.get('ws-a', 'biz-1')!.snapshot.id, id);

  const mismatch = await connect.handleAccountUpdatedEvent(event('evt_m', { ...fx('ready').snapshot!, id }, 600, 'acct_other'));
  assert.equal(mismatch.handled, false);
  const wrongType = await connect.handleAccountUpdatedEvent({ ...event('evt_t', fx('ready').snapshot!), type: 'charge.succeeded' } as unknown as AccountUpdatedEvent);
  assert.deepEqual(wrongType, { handled: false, outcome: 'unsupported_type' });
  const garbage = await connect.handleAccountUpdatedEvent({ id: 'evt_g', type: 'account.updated', account: id, created: 1, data: { object: {} } } as unknown as AccountUpdatedEvent);
  assert.deepEqual(garbage, { handled: false, outcome: 'invalid' });
});

test('tenant isolation: another workspace cannot read, link, gate on or onboard a seller account', async () => {
  const connect = createFixtureStripeConnect();
  await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  assert.equal(connect.store.get('ws-b', 'biz-1'), null);
  assert.equal((await connect.retrieveAccount({ workspaceId: 'ws-b', businessId: 'biz-1' })).ok, false);
  const link = await connect.createOnboardingLink({ workspaceId: 'ws-b', businessId: 'biz-1', returnUrl: 'x', refreshUrl: 'y' });
  assert.ok(!link.ok && link.status === 'not_found');
  const steal = await connect.createAccount({ workspaceId: 'ws-b', businessId: 'biz-1' });
  assert.ok(!steal.ok && steal.status === 'not_found');
  assert.equal(connect.store.get('ws-a', 'biz-1')!.workspaceId, 'ws-a');

  // Even if the account is ready, ws-b gets a closed gate that is indistinguishable from "no account".
  const accounts = storeWith(fx('ready').snapshot, 'ws-a', 'biz-1');
  const g = checkoutGate({ workspaceId: 'ws-b', businessId: 'biz-1', accounts, payments: okPayments });
  assert.equal(g.enabled, false);
  assert.equal(g.code, 'seller_not_found');
  assert.equal(checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: okPayments }).enabled, true);

  // One Stripe account cannot be linked to two businesses.
  assert.throws(() => accounts.register({ workspaceId: 'ws-b', businessId: 'biz-9', stripeAccountId: fx('ready').snapshot!.id, snapshot: fx('ready').snapshot!, lastEventCreated: 0 }));
});

test('fixture adapter works offline; the real adapter stub reports disconnected and does nothing', async () => {
  const connect = createFixtureStripeConnect();
  const a = await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  const again = await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  assert.deepEqual(a, again);
  const link = await connect.createOnboardingLink({ workspaceId: 'ws-a', businessId: 'biz-1', returnUrl: 'r', refreshUrl: 'f' });
  assert.ok(link.ok && link.fixture && link.value.url.startsWith('https://fixture.invalid/'));

  const real = createDisconnectedStripeConnect();
  const ref = { workspaceId: 'ws-a', businessId: 'biz-1' };
  for (const r of [await real.createAccount(ref), await real.createOnboardingLink({ ...ref, returnUrl: 'r', refreshUrl: 'f' }), await real.retrieveAccount(ref)]) {
    assert.ok(!r.ok && r.status === 'disconnected' && r.reason === DISCONNECTED_REASON);
  }
  assert.deepEqual(await real.handleAccountUpdatedEvent(event('e', fx('ready').snapshot!)), { handled: false, outcome: 'disconnected' });
});

test('gate fails closed on an unknown, missing or malformed provider status', () => {
  const accounts = storeWith(fx('ready').snapshot);
  for (const status of ['weird', '', undefined, null, 'DISABLED']) {
    const g = checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: { status, label: 'x' } as never });
    assert.equal(g.enabled, false, String(status));
    assert.equal(g.code, 'provider_off');
  }
  assert.equal(checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: undefined as never }).code, 'provider_off');
  for (const status of ['live', 'test', 'fixture'] as const) {
    assert.equal(checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts, payments: { status, label: 'x' } }).enabled, true);
  }
});

test('events with a missing, non-finite or non-integer created are invalid and never applied', async () => {
  const connect = createFixtureStripeConnect();
  const created = await connect.createAccount({ workspaceId: 'ws-a', businessId: 'biz-1' });
  const id = created.ok ? created.value.stripeAccountId : '';
  await connect.handleAccountUpdatedEvent(event('evt_ok', { ...fx('restricted').snapshot!, id }, 500));
  const ready = { ...fx('ready').snapshot!, id };
  let n = 0;
  for (const bad of [undefined, NaN, Infinity, -Infinity, 1.5, -1, '500', null]) {
    const e = { ...event(`evt_bad_${n++}`, ready), created: bad } as unknown as AccountUpdatedEvent;
    assert.deepEqual(await connect.handleAccountUpdatedEvent(e), { handled: false, outcome: 'invalid' }, String(bad));
  }
  assert.equal(deriveReadiness(connect.store.get('ws-a', 'biz-1')!.snapshot).state, 'restricted');
});

test('register validates the snapshot; a malformed stored snapshot never opens or crashes the gate', () => {
  const store = createInMemorySellerStore();
  const ready = fx('ready').snapshot!;
  const reg = (snapshot: unknown, stripeAccountId = ready.id) =>
    () => store.register({ workspaceId: 'ws-a', businessId: 'biz-1', stripeAccountId, snapshot: snapshot as StripeAccountSnapshot, lastEventCreated: 0 });
  assert.throws(reg({ ...ready, id: 'acct_other' }), /snapshot id/);
  assert.throws(reg({ ...ready, capabilities: { card_payments: 'bogus' } }));
  assert.throws(reg({ ...ready, requirements: { ...ready.requirements, currently_due: [1, null] } }));
  assert.throws(reg({ ...ready, requirements: undefined }));
  assert.throws(reg(null));
  assert.equal(store.get('ws-a', 'biz-1'), null);

  // Even if a bad record got past register (custom store), the gate answers closed instead of throwing.
  const broken = { get: () => ({ workspaceId: 'ws-a', businessId: 'biz-1', stripeAccountId: 'acct_x', snapshot: { id: 'acct_x' }, lastEventCreated: 0 }) } as never;
  const g = checkoutGate({ workspaceId: 'ws-a', businessId: 'biz-1', accounts: broken, payments: okPayments });
  assert.equal(g.enabled, false);
  assert.equal(g.code, 'seller_not_ready');
});

test('re-linking a business to a new Stripe account retires the old account mapping', () => {
  const store = createInMemorySellerStore();
  const oldSnap = { ...fx('restricted').snapshot!, id: 'acct_old' };
  const newSnap = { ...fx('onboarding_incomplete').snapshot!, id: 'acct_new' };
  store.register({ workspaceId: 'ws-a', businessId: 'biz-1', stripeAccountId: 'acct_old', snapshot: oldSnap, lastEventCreated: 0 });
  store.register({ workspaceId: 'ws-a', businessId: 'biz-1', stripeAccountId: 'acct_new', snapshot: newSnap, lastEventCreated: 0 });
  const res = store.applyAccountUpdated(event('evt_old', { ...fx('ready').snapshot!, id: 'acct_old' }, 10));
  assert.deepEqual(res, { handled: false, outcome: 'unknown_account' });
  assert.equal(store.get('ws-a', 'biz-1')!.stripeAccountId, 'acct_new');
  assert.equal(deriveReadiness(store.get('ws-a', 'biz-1')!.snapshot).state, 'onboarding_incomplete');
  assert.equal(store.applyAccountUpdated(event('evt_new', { ...fx('ready').snapshot!, id: 'acct_new' }, 11)).handled, true);
  // The old account id is free to link elsewhere.
  store.register({ workspaceId: 'ws-b', businessId: 'biz-2', stripeAccountId: 'acct_old', snapshot: oldSnap, lastEventCreated: 0 });
});

test('revenue separation: seller (connected-account) money and platform subscription money never mix', () => {
  const s1 = sellerCharge({ kind: 'direct', stripeAccountId: 'acct_1', businessId: 'b', workspaceId: 'w', amountMinor: 2000, applicationFeeMinor: 0, currency: 'AUD' });
  const s2 = sellerCharge({ kind: 'destination', stripeAccountId: 'acct_1', businessId: 'b', workspaceId: 'w', amountMinor: 1000, applicationFeeMinor: 100, currency: 'AUD' });
  const p1 = platformSubscriptionCharge({ workspaceId: 'w', planId: 'starter', amountMinor: 4900, currency: 'AUD' });
  assert.equal(s1.flow, 'connected_account');
  assert.equal(p1.flow, 'platform_subscription');
  assert.deepEqual(sellerRevenueTotals([s1, s2]), { grossMinor: 3000, platformFeeMinor: 100, sellerNetMinor: 2900 });
  assert.equal(platformSubscriptionTotal([p1]), 4900);

  // Compile-time: the types are not interchangeable (checked by `npm run typecheck`).
  // @ts-expect-error a subscription charge is not a seller charge
  const bad1: readonly typeof s1[] = [p1];
  // @ts-expect-error a seller charge is not a subscription charge
  const bad2: readonly typeof p1[] = [s1];
  // @ts-expect-error a hand-built object without the brand cannot be passed as a seller charge
  sellerRevenueTotals([{ flow: 'connected_account', kind: 'direct', stripeAccountId: 'acct_1', businessId: 'b', workspaceId: 'w', amountMinor: 1, applicationFeeMinor: 0, currency: 'AUD' }]);

  // Runtime: a cast cannot smuggle one into the other's totals.
  assert.throws(() => sellerRevenueTotals([bad1[0]] as never), /connected-account/);
  assert.throws(() => platformSubscriptionTotal([bad2[0]] as never), /subscription/);
  assert.throws(() => sellerCharge({ kind: 'direct', stripeAccountId: 'cus_123', businessId: 'b', workspaceId: 'w', amountMinor: 1, applicationFeeMinor: 0, currency: 'AUD' }), /connected account/);
  assert.throws(() => sellerCharge({ kind: 'direct', stripeAccountId: 'acct_1', businessId: 'b', workspaceId: 'w', amountMinor: 100, applicationFeeMinor: 101, currency: 'AUD' }));
});
