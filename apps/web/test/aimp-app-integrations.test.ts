// Integrations (screen 39, AMP-132). The server read runs against the REAL seller account store, readiness rules and checkout gate
// (lib/aimp/sellers, through the Payments page's own `loadPayments`) and the REAL provider status rules (lib/aimp/providers/status.ts).
// The view model is pure. Nothing here renders React: the "no secret" checks run on everything the view is given.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadIntegrations, siteStatuses } from '../app/app/[business]/integrations/_server/integrations.ts';
import type { IntegrationsRuntime, IntegrationsSource } from '../app/app/[business]/integrations/_server/integrations.ts';
import {
  COMING_LATER, DEMO_NOTE, NO_CONNECT_NOTE, STRIPE_SAMPLE_NOTE, STRIPE_UNAVAILABLE, buildIntegrations, integrationsHref, siteFact,
} from '../app/app/[business]/integrations/view-model.ts';
import { PROVIDER_IDS } from '../lib/aimp/flags.ts';
import { PROVIDER_META, resolveAllStatuses } from '../lib/aimp/providers/status.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore, sellerStates } from '../lib/aimp/sellers/index.ts';
import type { SellerState } from '../lib/aimp/sellers/index.ts';
import { isSampleSellerAccountId } from '../lib/aimp/sellers/sample.ts';

const WS = 'ws-a';
// Made-up values that must never reach the view. Every credential variable the provider list knows gets one.
const SECRETS: Record<string, string> = {};
for (const id of PROVIDER_IDS) for (const v of PROVIDER_META[id].credentialVars) SECRETS[v] = `SECRETVALUE-${v}-zz9`;
const NO_KEYS = resolveAllStatuses({});
const WITH_KEYS = resolveAllStatuses(SECRETS);
const LIVE = { ...WITH_KEYS, payments: { ...WITH_KEYS.payments, status: 'live' as const, label: 'x' } };
const OFF = { ...NO_KEYS, payments: { ...NO_KEYS.payments, status: 'disconnected' as const, label: 'x' } };

const rtOf = (...ids: string[]): IntegrationsRuntime => ({ businesses: new Set(ids), seeds: new Map(), slugs: new Map(), productIds: new Map() });

/** One business per fixture seller state, plus one account that is not a sample id (`biz-real`), all in workspace `ws-a`. */
function setup() {
  const accounts = createInMemorySellerStore();
  for (const f of FIXTURE_SELLERS) {
    if (f.snapshot) accounts.register({ workspaceId: WS, businessId: `biz-${f.key}`, stripeAccountId: f.snapshot.id, snapshot: f.snapshot, lastEventCreated: 0 });
  }
  const ready = FIXTURE_SELLERS.find((f) => f.key === 'ready')?.snapshot;
  assert.ok(ready);
  const real = { ...structuredClone(ready), id: 'acct_1NotASampleXYZ' };
  accounts.register({ workspaceId: WS, businessId: 'biz-real', stripeAccountId: real.id, snapshot: real, lastEventCreated: 0 });
  const source: IntegrationsSource = { accounts, workspaceId: WS };
  const rt = rtOf('biz-real', ...FIXTURE_SELLERS.map((f) => `biz-${f.key}`));
  const vmFor = (business: string, statuses: Parameters<typeof loadIntegrations>[2] = NO_KEYS) => {
    const r = loadIntegrations(rt, source, statuses, business);
    assert.ok(r.found);
    return { input: r.input, vm: buildIntegrations(r.input) };
  };
  return { accounts, source, rt, vmFor };
}

test('the site statuses come from the real provider rules, one per provider, as status kinds only', () => {
  const site = siteStatuses(NO_KEYS);
  assert.deepEqual(site.map((s) => s.id), [...PROVIDER_IDS]);
  for (const s of site) {
    assert.deepEqual(Object.keys(s).sort(), ['id', 'status'], 'no label, reason or credential flag crosses');
    assert.equal(s.status, NO_KEYS[s.id].status);
  }
});

test('Stripe shows the real seller state of this business for every state the lib models', () => {
  const { vmFor } = setup();
  assert.deepEqual(FIXTURE_SELLERS.map((f) => f.key).sort(), [...sellerStates].sort());
  const sample: Record<SellerState, string> = {
    not_connected: 'Not connected', onboarding_incomplete: 'Sample account: setup not finished', under_review: 'Sample account: being checked',
    restricted: 'Sample account: payments paused', ready: 'Sample account: ready',
  };
  for (const f of FIXTURE_SELLERS) {
    const { input, vm } = vmFor(`biz-${f.key}`);
    assert.ok(input.stripe.available);
    assert.equal(input.stripe.state, f.key);
    assert.equal(vm.stripe.account.label, sample[f.key], f.key);
    assert.equal(vm.stripe.connectNote, NO_CONNECT_NOTE);
  }
  assert.deepEqual(vmFor('biz-onboarding_incomplete').vm.stripe.outstanding, ['a bank account for payouts', 'your website or store address']);
  assert.deepEqual(vmFor('biz-not_connected').vm.stripe.outstanding, []);
});

test('a sample or fixture seller is labelled sample, never "Connected", never green, and never counts as taking payments', () => {
  const { vmFor } = setup();
  // Fixture account ids are samples whatever the site says, and any account is a sample while the site is not live.
  for (const [business, statuses] of [['biz-ready', NO_KEYS], ['biz-ready', WITH_KEYS], ['biz-ready', LIVE], ['biz-real', NO_KEYS], ['biz-real', WITH_KEYS]] as const) {
    const { input, vm } = vmFor(business, statuses);
    assert.ok(input.stripe.available && input.stripe.sample, `${business} ${statuses.payments.status}`);
    assert.match(vm.stripe.account.label, /^Sample account/);
    assert.doesNotMatch(vm.stripe.account.label, /Connected/);
    assert.notEqual(vm.stripe.account.tone, 'success');
    assert.match(vm.stripe.account.text, /not a real Stripe account/);
    assert.ok(input.stripe.hasAccount);
    assert.equal(vm.stripe.sampleNote, STRIPE_SAMPLE_NOTE, 'the sample note shows when there is an account and it is a sample');
    assert.equal(vm.stripe.timing, null, 'an account is shown, so no "Coming later"');
    assert.equal(vm.stripe.canTakePayments, false);
  }
  // With no account there is nothing to call a sample: no sample note, whatever the site says, and "Coming later" instead.
  for (const statuses of [NO_KEYS, LIVE, OFF]) {
    const { input, vm } = vmFor('biz-not_connected', statuses);
    assert.ok(input.stripe.available && !input.stripe.hasAccount);
    assert.equal(vm.stripe.sampleNote, null, statuses.payments.status);
    assert.equal(vm.stripe.timing, COMING_LATER);
    assert.equal(vm.stripe.account.label, 'Not connected');
    assert.equal(vm.stripe.canTakePayments, false);
  }
});

test('the sample-account check is the one the sellers module owns, not a private copy', () => {
  const dir = new URL('../app/app/[business]/integrations/', import.meta.url);
  const server = readFileSync(new URL('_server/integrations.ts', dir), 'utf8');
  assert.match(server, /import \{ isSampleSellerAccountId \} from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/aimp\/sellers\/sample\.ts'/);
  assert.doesNotMatch(server, /acct_\(|\/\^acct_/, 'no private regular expression for sample ids');
  assert.equal(isSampleSellerAccountId('acct_demo_ready'), true);
  assert.equal(isSampleSellerAccountId('acct_sample_demo_biz'), true);
  assert.equal(isSampleSellerAccountId('acct_1NotASampleXYZ'), false);
  assert.equal(isSampleSellerAccountId(null), false);
});

test('page branches: no account, sample account, real account on a live provider, provider switched to live', () => {
  const { vmFor } = setup();
  const none = vmFor('biz-not_connected').vm.stripe;
  assert.deepEqual([none.account.label, none.sampleNote, none.timing, none.canTakePayments], ['Not connected', null, COMING_LATER, false]);
  const sample = vmFor('biz-ready').vm.stripe;
  assert.deepEqual([sample.account.label, sample.sampleNote, sample.timing, sample.canTakePayments], ['Sample account: ready', STRIPE_SAMPLE_NOTE, null, false]);
  const real = vmFor('biz-real', LIVE).vm.stripe;
  assert.deepEqual([real.account.label, real.sampleNote, real.timing], ['Connected', null, null]);
  // The provider switched to live must not claim it works, only that the site is set to use it.
  const live = vmFor('biz-not_connected', LIVE).vm.stripe.site;
  assert.equal(live.label, 'On for this site');
  assert.match(live.text, /set to use the real service/);
  assert.match(live.text, /not checked that it is working/);
  assert.doesNotMatch(live.text, /(^|\. )This site (is live|is connected|is taking|works)|real money (is|moves)/i);
  for (const s of vmFor('biz-ready', LIVE).vm.services) assert.doesNotMatch(s.site.text, /^This site is (live|connected)/);
  assert.match(DEMO_NOTE, /on this server/);
});

test('the view draws the view model: sample note only from the model, "Coming later" beside the Stripe account, the demo note, no controls', () => {
  const dir = new URL('../app/app/[business]/integrations/', import.meta.url);
  const view = readFileSync(new URL('integrations-view.tsx', dir), 'utf8');
  // The node test runner cannot load JSX or the glass library, so this checks the source text, as the sibling page tests do.
  assert.match(view, /stripe\.sampleNote \? <p[^>]*data-testid="stripe-sample-note">\{stripe\.sampleNote\}<\/p> : null/);
  assert.match(view, /extra=\{stripe\.timing \?\? undefined\}/);
  assert.match(view, /extra \? <GlassBadge[^>]*>\{extra\}<\/GlassBadge> : null/);
  assert.match(view, /\{DEMO_NOTE\}/);
  assert.doesNotMatch(view, /STRIPE_SAMPLE_NOTE|Sample data\./, 'the sample wording lives in the view model only');
  assert.equal(view.match(/<h1/g)?.length ?? 0, 0, 'the single h1 comes from AppIntro');
  assert.equal(view.match(/heading="h2"/g)?.length, 2);
});

test('only a non-sample account on a live payment provider reads as connected, and it fails closed when checkout is shut', () => {
  const { vmFor } = setup();
  const { input, vm } = vmFor('biz-real', LIVE);
  assert.ok(input.stripe.available);
  assert.equal(input.stripe.sample, false);
  assert.equal(vm.stripe.account.label, 'Connected');
  assert.equal(vm.stripe.site.label, 'On for this site');
  assert.equal(vm.stripe.sampleNote, null);
  assert.equal(vm.stripe.canTakePayments, input.stripe.canAcceptPayments && input.stripe.checkoutOpen);
  const shut = buildIntegrations({ ...input, stripe: { ...input.stripe, checkoutOpen: false } });
  assert.equal(shut.stripe.canTakePayments, false);
  assert.equal(shut.stripe.account.label, 'Connected, payments off');
});

test('a runtime without a seller store says so, and an unknown or foreign business is never read', () => {
  const { accounts, rt } = setup();
  const none = loadIntegrations(rtOf('biz-a'), null, NO_KEYS, 'biz-a');
  assert.ok(none.found);
  assert.deepEqual(none.input.stripe, { available: false, site: NO_KEYS.payments.status });
  const vm = buildIntegrations(none.input);
  assert.equal(vm.stripe.account.label, 'Not connected');
  assert.equal(vm.stripe.account.text, STRIPE_UNAVAILABLE);
  assert.equal(vm.stripe.canTakePayments, false);
  assert.deepEqual(loadIntegrations(rt, { accounts, workspaceId: WS }, NO_KEYS, 'biz-of-someone-else'), { found: false });
  // The same store, asked from another workspace: the ready account reads exactly like "no account".
  const other = loadIntegrations(rt, { accounts, workspaceId: 'ws-b' }, LIVE, 'biz-real');
  assert.ok(other.found && other.input.stripe.available);
  assert.equal(other.input.stripe.hasAccount, false);
  assert.equal(buildIntegrations(other.input).stripe.account.label, 'Not connected');
});

test('every other provider is "Not connected" and "Coming later" for the business, whatever the site status is', () => {
  const { vmFor } = setup();
  for (const statuses of [NO_KEYS, WITH_KEYS, LIVE]) {
    const { vm } = vmFor('biz-ready', statuses);
    assert.deepEqual(vm.services.map((s) => s.id).sort(), PROVIDER_IDS.filter((p) => p !== 'payments').sort(), 'every provider in the lib, Stripe aside');
    for (const s of vm.services) {
      assert.equal(s.account.label, 'Not connected', s.id);
      assert.equal(s.account.tone, 'neutral');
      assert.equal(s.timing, COMING_LATER);
      assert.equal(s.site.label, siteFact(statuses[s.id].status).label);
    }
  }
  assert.equal(vmFor('biz-ready').vm.services[0].name, 'Pinterest');
  assert.equal(siteFact('fixture').label, 'Sample data');
  assert.equal(siteFact('test').label, 'Sample data');
  assert.equal(siteFact('disabled').label, 'Switched off');
  assert.equal(siteFact('something-new' as never).label, 'Not connected');
  assert.equal(integrationsHref('biz-a'), '/app/biz-a/integrations');
});

test('no secret, key, token, variable name or account id reaches the view model, in any state', () => {
  const { vmFor } = setup();
  const names = Object.keys(SECRETS);
  assert.ok(names.includes('STRIPE_SECRET_KEY') && names.length >= 6);
  for (const statuses of [NO_KEYS, WITH_KEYS, LIVE, OFF]) {
    for (const business of ['biz-real', ...FIXTURE_SELLERS.map((f) => `biz-${f.key}`)]) {
      const { input, vm } = vmFor(business, statuses);
      const out = JSON.stringify(input) + JSON.stringify(vm);
      assert.doesNotMatch(out, /acct_|SECRETVALUE|sk_(test|live)|pk_(test|live)|whsec_|credentialsPresent|_KEY|_TOKEN|SUPABASE_URL/, `${business} ${statuses.payments.status}`);
      for (const n of names) assert.ok(!out.includes(n) && !out.includes(SECRETS[n]), n);
      assert.doesNotMatch(out, /external_account|business_profile|past_due/, 'no raw provider field names either');
    }
  }
});

test('the page checks the business before reading, is read-only, has no connect control and never passes the environment on', () => {
  const dir = new URL('../app/app/[business]/integrations/', import.meta.url);
  for (const f of ['page.tsx', 'integrations-view.tsx', 'integrations.css', 'view-model.ts', '_server/integrations.ts']) assert.ok(existsSync(new URL(f, dir)), f);
  const page = readFileSync(new URL('page.tsx', dir), 'utf8');
  assert.match(page, /availability\(\)/);
  assert.match(page, /await params/);
  assert.ok(page.indexOf('checkBusiness(business)') < page.indexOf('loadIntegrations('), 'the business is checked before anything is read');
  assert.match(page, /resolveAllStatuses\(process\.env\)/);
  assert.equal(page.match(/process\.env/g)?.length, 1, 'the environment is only handed to the status rules');
  assert.match(page, /paymentsSource\(rt\)/, 'the same seller source as the Payments page');
  const view = readFileSync(new URL('integrations-view.tsx', dir), 'utf8');
  assert.doesNotMatch(view, /<form|<button|GlassButton|onClick|'use client'/, 'no control that could pretend to connect');
  assert.doesNotMatch(view, /process\.env|stripeAccountId|credential/i);
  const server = readFileSync(new URL('_server/integrations.ts', dir), 'utf8');
  const vm = readFileSync(new URL('view-model.ts', dir), 'utf8');
  assert.match(server, /loadPayments\(/, 'the Payments loader is reused, not copied');
  assert.doesNotMatch(server + vm + page, /fetch\(|createFixtureStripeConnect|createOnboardingLink|createAccount/);
  assert.doesNotMatch(vm, /process\.env|stripeAccountId|credentialVars/);
  const css = readFileSync(new URL('integrations.css', dir), 'utf8');
  assert.match(css, /\.ain-link \{[^}]*min-block-size: 44px/);
  assert.doesNotMatch(css, /outline:\s*(none|0)/, 'the library focus ring is left alone');
});
