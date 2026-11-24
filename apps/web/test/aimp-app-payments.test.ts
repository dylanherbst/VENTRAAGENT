// Seller payments and payouts (screen 18, AMP-088). The server read runs against the REAL seller account store, readiness rules and
// checkout gate (lib/aimp/sellers) on the lib's own fixture accounts; the view model is pure. A runtime without a seller store gives
// the page a null source: that honest state is tested too (and what is still missing).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { MISSING_WIRING, loadPayments, paymentsSource } from '../app/app/[business]/payments/_server/payments.ts';
import type { PaymentsRuntime, PaymentsSource } from '../app/app/[business]/payments/_server/payments.ts';
import {
  AMOUNTS_NOTE, NOT_AVAILABLE_TEXT, NOT_AVAILABLE_TITLE, NO_CONNECT_NOTE, SAMPLE_ACCOUNT_PREFIX, SAMPLE_NOTE, buildPayments, buildUnavailable,
  isSampleAccount, paymentsHref, providerFact,
} from '../app/app/[business]/payments/view-model.ts';
import type { ProviderInput } from '../app/app/[business]/payments/view-model.ts';
import { SAMPLE_SELLER_PREFIX } from '../app/start/_server/orders-runtime.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore, sellerStates } from '../lib/aimp/sellers/index.ts';
import type { SellerState } from '../lib/aimp/sellers/index.ts';

const WS = 'ws-a';
const FIXTURE: ProviderInput = { status: 'fixture', label: 'DEMO' };
const OFF: ProviderInput = { status: 'disconnected', label: 'Not connected' };
const rtOf = (...ids: string[]): PaymentsRuntime => ({ businesses: new Set(ids), seeds: new Map(), slugs: new Map(), productIds: new Map() });

/** One business per fixture seller state, all in workspace `ws-a`, on the real in-memory seller store. */
function setup() {
  const accounts = createInMemorySellerStore();
  for (const f of FIXTURE_SELLERS) {
    if (f.snapshot) accounts.register({ workspaceId: WS, businessId: `biz-${f.key}`, stripeAccountId: f.snapshot.id, snapshot: f.snapshot, lastEventCreated: 0 });
  }
  const source: PaymentsSource = { accounts, workspaceId: WS };
  const rt = rtOf(...FIXTURE_SELLERS.map((f) => `biz-${f.key}`));
  const vmFor = (state: SellerState, provider: ProviderInput = FIXTURE) => {
    const r = loadPayments(rt, source, provider, `biz-${state}`);
    assert.ok(r.found && r.available);
    return { input: r.input, vm: buildPayments(r.input) };
  };
  return { accounts, source, rt, vmFor };
}

// ---- a sample account is always marked as sample, from the account itself ----
test('an account whose id starts acct_sample_demo_ always shows the sample notice, even when the provider status reads live', () => {
  assert.equal(SAMPLE_ACCOUNT_PREFIX, SAMPLE_SELLER_PREFIX, 'the view model prefix equals the runtime constant');
  const { vmFor, accounts, source } = setup();
  const LIVE: ProviderInput = { status: 'live', label: 'Live' };
  const base = vmFor('ready', LIVE).input;
  assert.equal(base.provider.status, 'live');
  assert.equal(buildPayments(base).sampleNote, null, 'a non-sample account on a live provider shows no sample notice');
  assert.equal(isSampleAccount(base.accountId), false);
  for (const provider of [LIVE, OFF, { status: 'disabled', label: 'Off' } as ProviderInput, FIXTURE]) {
    assert.equal(buildPayments({ ...base, accountId: `${SAMPLE_SELLER_PREFIX}biz-ready`, provider }).sampleNote, SAMPLE_NOTE, provider.status);
  }
  // Through the real store: register a sample account and read it back with a live provider.
  const id = `${SAMPLE_SELLER_PREFIX}biz-sample`;
  const snap = { ...FIXTURE_SELLERS.find((f) => f.key === 'ready')!.snapshot!, id };
  accounts.register({ workspaceId: WS, businessId: 'biz-sample', stripeAccountId: id, snapshot: snap, lastEventCreated: 0 });
  const r = loadPayments(rtOf('biz-sample'), source, LIVE, 'biz-sample');
  assert.ok(r.found && r.available);
  assert.equal(r.input.accountId, `${SAMPLE_SELLER_PREFIX}biz-sample`);
  assert.equal(buildPayments(r.input).sampleNote, SAMPLE_NOTE);
  assert.equal(isSampleAccount(null), false);
});

test('the page and view model no longer claim the /start runtime has no seller store', () => {
  for (const f of ['page.tsx', 'view-model.ts', 'payments-view.tsx', '_server/payments.ts']) {
    const src = readFileSync(new URL(`../app/app/[business]/payments/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /runtime has no seller|No seller account store in this runtime|has no seller account store yet/, f);
  }
  assert.doesNotMatch(NOT_AVAILABLE_TEXT, /—|–/);
});

// ---- the honest state of the /start demo ----
test('a runtime without a seller store has no source, so the page says payments are not available in the demo yet', () => {
  const rt = rtOf('biz-a');
  assert.equal(paymentsSource(rt), null);
  assert.deepEqual(loadPayments(rt, paymentsSource(rt), OFF, 'biz-a'), { found: true, available: false });
  assert.deepEqual(loadPayments(rt, null, OFF, 'unknown'), { found: false }, 'an unknown business is unknown, not "not connected"');
  const vm = buildUnavailable(OFF);
  assert.equal(vm.title, NOT_AVAILABLE_TITLE);
  assert.match(NOT_AVAILABLE_TITLE, /not available in the demo yet/);
  assert.match(NOT_AVAILABLE_TEXT, /cannot take payments or receive payouts today/);
  assert.equal(vm.provider.label, 'Not connected');
  assert.ok(MISSING_WIRING.length >= 3);
});

test('the real /start runtime file carries ONE seller account store and shares it with the order demo (AMP-107)', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.equal(src.match(/createInMemorySellerStore\(\)/g)?.length, 1, 'exactly one store is created');
  assert.match(src, /createStartOrders\(\{[^}]*\bsellers\b[^}]*\}\)/, 'the order demo gets that same store');
});

// ---- the server read on the real seller lib ----
test('every fixture seller state is read through the real store, readiness and gate', () => {
  const { vmFor } = setup();
  assert.deepEqual(FIXTURE_SELLERS.map((f) => f.key).sort(), [...sellerStates].sort(), 'the fixtures cover every state the lib models');
  const labels: Record<SellerState, string> = {
    not_connected: 'Not connected', onboarding_incomplete: 'Setup not finished', under_review: 'Being checked', restricted: 'Payments paused', ready: 'Ready',
  };
  for (const f of FIXTURE_SELLERS) {
    const { input, vm } = vmFor(f.key);
    assert.equal(input.readiness.state, f.key);
    assert.equal(vm.state.label, labels[f.key]);
    assert.equal(vm.canTakePayments, f.key === 'ready', f.key);
    assert.equal(vm.checkout.label, f.key === 'ready' ? 'Checkout is open' : 'Checkout is closed', f.key);
    assert.equal(vm.checkout.text, input.gate.reason, 'the reason is the gate\'s own words');
    assert.equal(vm.sampleNote, SAMPLE_NOTE);
    assert.equal(vm.amountsNote, AMOUNTS_NOTE);
  }
});

test('what is still needed comes from the readiness rules in plain words, never as raw provider field names', () => {
  const { vmFor } = setup();
  const incomplete = vmFor('onboarding_incomplete').vm;
  assert.deepEqual(incomplete.outstanding, ['a bank account for payouts', 'your website or store address']);
  assert.equal(incomplete.next?.label, 'Finish setting up Stripe');
  assert.equal(incomplete.next?.note, NO_CONNECT_NOTE);
  const restricted = vmFor('restricted').vm;
  assert.deepEqual(restricted.outstanding, ['a photo of your ID']);
  assert.equal(restricted.state.tone, 'danger');
  const review = vmFor('under_review').vm;
  assert.equal(review.next?.note, 'There is nothing you need to do right now.');
  const ready = vmFor('ready').vm;
  assert.equal(ready.next, null);
  assert.deepEqual(ready.outstanding, []);
  const none = vmFor('not_connected').vm;
  assert.equal(none.next?.label, 'Connect Stripe');
  assert.equal(none.next?.note, NO_CONNECT_NOTE, 'the next step is words only: the page says it cannot be done from here yet');
  for (const s of sellerStates) assert.doesNotMatch(JSON.stringify(vmFor(s).vm), /external_account|business_profile|past_due|acct_/);
});

test('payout status follows payouts_enabled on the account, and no account means no payouts yet', () => {
  const { vmFor } = setup();
  assert.equal(vmFor('not_connected').input.payoutsEnabled, null);
  assert.equal(vmFor('not_connected').vm.payouts.label, 'No payouts yet');
  assert.equal(vmFor('onboarding_incomplete').vm.payouts.label, 'Payouts are off');
  assert.equal(vmFor('under_review').vm.payouts.label, 'Payouts are off');
  const restricted = vmFor('restricted').vm; // payouts still enabled on this fixture, payments off
  assert.equal(restricted.payouts.label, 'Payouts are on');
  assert.equal(restricted.payouts.tone, 'neutral');
  assert.match(restricted.payouts.text, /payments are still off/);
  const ready = vmFor('ready').vm;
  assert.equal(ready.payouts.label, 'Payouts are on');
  assert.equal(ready.payouts.tone, 'success');
});

test('a ready seller still cannot take payments while the payment provider is off (fail closed)', () => {
  const { vmFor } = setup();
  for (const provider of [OFF, { status: 'disabled', label: 'Off' } as ProviderInput]) {
    const { vm, input } = vmFor('ready', provider);
    assert.equal(input.readiness.canAcceptPayments, true);
    assert.equal(input.gate.enabled, false);
    assert.equal(vm.canTakePayments, false);
    assert.equal(vm.checkout.label, 'Checkout is closed');
    assert.equal(vm.sampleNote, null);
  }
});

test('a business that is not the caller\'s is refused: unknown ids are not found and another workspace\'s account is never read', () => {
  const { accounts, rt } = setup();
  assert.deepEqual(loadPayments(rt, { accounts, workspaceId: WS }, FIXTURE, 'biz-of-someone-else'), { found: false });
  // The same store, asked from another workspace: the ready account reads exactly like "no account".
  const other = loadPayments(rt, { accounts, workspaceId: 'ws-b' }, FIXTURE, 'biz-ready');
  assert.ok(other.found && other.available);
  assert.equal(other.input.readiness.state, 'not_connected');
  assert.equal(other.input.gate.code, 'seller_not_found');
  assert.equal(other.input.payoutsEnabled, null);
  assert.equal(buildPayments(other.input).canTakePayments, false);
  assert.doesNotMatch(JSON.stringify(other.input), /acct_demo_ready/);
});

test('the provider status has plain words for every status, and an unknown one reads as not connected', () => {
  assert.equal(providerFact({ status: 'live', label: 'x' }).label, 'Connected');
  assert.equal(providerFact({ status: 'test', label: 'x' }).text, SAMPLE_NOTE);
  assert.equal(providerFact(FIXTURE).label, 'Sample data');
  assert.equal(providerFact({ status: 'disabled', label: 'x' }).label, 'Switched off');
  assert.equal(providerFact(OFF).label, 'Not connected');
  assert.equal(providerFact({ status: 'something-new' as never, label: 'x' }).label, 'Not connected');
  assert.equal(paymentsHref('biz-a'), '/app/biz-a/payments');
});

// ---- the page files ----
test('the page checks the business before reading, is read-only, makes no provider call and shows no amounts', () => {
  const dir = new URL('../app/app/[business]/payments/', import.meta.url);
  for (const f of ['page.tsx', 'payments-view.tsx', 'payments.css', 'view-model.ts', '_server/payments.ts']) assert.ok(existsSync(new URL(f, dir)), f);
  const page = readFileSync(new URL('page.tsx', dir), 'utf8');
  assert.match(page, /availability\(\)/);
  assert.ok(page.indexOf('checkBusiness(business)') < page.indexOf('loadPayments('), 'the business is checked before anything is read');
  assert.match(page, /await params/);
  const view = readFileSync(new URL('payments-view.tsx', dir), 'utf8');
  assert.doesNotMatch(view, /<form|<button|GlassButton|'use client'/, 'no control that could pretend to connect');
  const server = readFileSync(new URL('_server/payments.ts', dir), 'utf8');
  const vm = readFileSync(new URL('view-model.ts', dir), 'utf8');
  assert.doesNotMatch(server + vm + page, /fetch\(|createFixtureStripeConnect|createOnboardingLink|createAccount/);
  assert.doesNotMatch(server + vm + view, /\/ ?100\b|amountMinor|toFixed/, 'no money is divided or formatted by hand');
});
