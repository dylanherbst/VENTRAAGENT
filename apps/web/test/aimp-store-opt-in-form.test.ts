// AMP-155 (F08): the public-store opt-in form and "Stop emails" path, through the same functions the server actions call
// (app/s/[store]/_server/audience.ts). Real audience service, memory store, fixture email. No network, no real email.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_OPT_IN_WORDING, UNSUBSCRIBE_OK_MESSAGE, submitOptIn, submitUnsubscribe } from '../app/s/[store]/_server/audience.ts';
import type { OptInDeps } from '../app/s/[store]/_server/audience.ts';
import { PUBLIC_OK_MESSAGE, createAudienceService, createMemoryAudienceStore } from '../lib/aimp/audience/index.ts';
import { registryFromSiteVersions } from '../lib/aimp/hosts/registry.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';
import { createSiteVersionStore, seedDemoSites } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const ACTOR = { workspaceId: WORKSPACE, userId: 'demo-owner' };
const CA = { workspaceId: WORKSPACE, businessId: 'biz-a' };
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });

async function world() {
  const sites = createSiteVersionStore();
  assert.ok((await sites.createSite(ACTOR, storeFor('shop-a'))).ok);
  assert.ok((await sites.publish(ACTOR, 'shop-a')).ok);
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  const slugs = new Map([['biz-a', 'shop-a']]);
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  const deps: OptInDeps = {
    availability: () => ({ available: true, reason: '' }),
    world: async () => ({ audience, workspaceId: WORKSPACE, slugs, origin: { primary, sites } }),
  };
  return { deps, audience };
}

test('opt in then unsubscribe leaves the subscriber unsubscribed and unable to receive marketing', async () => {
  const { deps, audience } = await world();
  const joined = await submitOptIn(deps, 'shop-a', { email: 'Jo@Example.com', consentTicked: true });
  assert.deepEqual(joined, { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.equal(await audience.canSendMarketing(CA, 'jo@example.com'), true);
  const stopped = await submitUnsubscribe(deps, 'shop-a', { email: ' JO@example.com ' });
  assert.deepEqual(stopped, { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
  assert.equal(await audience.canSendMarketing(CA, 'jo@example.com'), false);
  const [sub] = await audience.listSubscribers(CA);
  assert.equal(sub.status, 'unsubscribed');
  const log = await audience.consentLog(CA, 'jo@example.com');
  assert.deepEqual(log.map((r) => r.decision), ['granted', 'withdrawn']);
  // the sentence "I can ask to stop at any time" in the consent wording is true: this path works end to end
  assert.match(DEFAULT_OPT_IN_WORDING, /ask to stop at any time/);
});

test('an unsubscribe reply is identical for a known, unknown, already stopped and suppressed address', async () => {
  const { deps, audience } = await world();
  await submitOptIn(deps, 'shop-a', { email: 'known@y.co', consentTicked: true });
  assert.ok((await audience.suppress(CA, 'blocked@y.co', 'complaint')).ok);
  const replies = [
    await submitUnsubscribe(deps, 'shop-a', { email: 'known@y.co' }),
    await submitUnsubscribe(deps, 'shop-a', { email: 'known@y.co' }),
    await submitUnsubscribe(deps, 'shop-a', { email: 'never@y.co' }),
    await submitUnsubscribe(deps, 'shop-a', { email: 'blocked@y.co' }),
    await submitUnsubscribe(deps, 'shop-a', { email: 'x@y.co', website: 'http://spam.test' }),
  ];
  for (const r of replies) {
    assert.deepEqual(r, replies[0]);
    assert.deepEqual(Object.keys(r).sort(), ['message', 'ok']);
    assert.ok(!r.message.includes('y.co'));
  }
  // an address that was never on the list is not added by trying to leave
  assert.equal((await audience.listSubscribers(CA)).length, 2);
  assert.equal((await audience.listSubscribers(CA, { status: 'suppressed' })).length, 1);
});

test('a filled honeypot never blocks a Stop emails request', async () => {
  const { deps, audience } = await world();
  await submitOptIn(deps, 'shop-a', { email: 'known@y.co', consentTicked: true });
  const r = await submitUnsubscribe(deps, 'shop-a', { email: 'known@y.co', website: 'autofilled' });
  assert.deepEqual(r, { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
  assert.equal((await audience.listSubscribers(CA))[0].status, 'unsubscribed');
  assert.equal(await audience.canSendMarketing(CA, 'known@y.co'), false);
});

test('business B cannot unsubscribe or see business A subscribers; a non-guided (real) store is refused by both', async () => {
  const sites = createSiteVersionStore();
  for (const slug of ['shop-a', 'shop-b', 'real-shop']) {
    assert.ok((await sites.createSite(ACTOR, storeFor(slug))).ok);
    assert.ok((await sites.publish(ACTOR, slug)).ok);
  }
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  // real-shop is published in the site store but no guided-setup business owns it
  const slugs = new Map([['biz-a', 'shop-a'], ['biz-b', 'shop-b']]);
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  const deps: OptInDeps = {
    availability: () => ({ available: true, reason: '' }),
    world: async () => ({ audience, workspaceId: WORKSPACE, slugs, origin: { primary, sites } }),
  };
  const CB = { workspaceId: WORKSPACE, businessId: 'biz-b' };
  await submitOptIn(deps, 'shop-a', { email: 'a-only@y.co', consentTicked: true });
  const viaB = await submitUnsubscribe(deps, 'shop-b', { email: 'a-only@y.co' });
  assert.deepEqual(viaB, { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
  assert.equal(await audience.canSendMarketing(CA, 'a-only@y.co'), true);
  assert.equal((await audience.listSubscribers(CA))[0].status, 'subscribed');
  assert.equal((await audience.listSubscribers(CB)).length, 0);
  assert.equal((await submitOptIn(deps, 'real-shop', { email: 'r@y.co', consentTicked: true })).ok, false);
  assert.equal((await submitUnsubscribe(deps, 'real-shop', { email: 'a-only@y.co' })).ok, false);
  assert.equal(await audience.canSendMarketing(CA, 'a-only@y.co'), true);
});

test('a malformed address to unsubscribe is told apart only as a bad address', async () => {
  const { deps } = await world();
  for (const email of ['', 'nope', 5, null]) assert.equal((await submitUnsubscribe(deps, 'shop-a', { email })).ok, false);
});

test('unticked consent is refused and stores nothing', async () => {
  const { deps, audience } = await world();
  for (const consentTicked of [false, undefined, 'off', '']) {
    assert.equal((await submitOptIn(deps, 'shop-a', { email: 'a@y.co', consentTicked })).ok, false);
  }
  assert.equal((await audience.listSubscribers(CA)).length, 0);
});

test('a filled honeypot gets the neutral ok reply and stores nothing', async () => {
  const { deps, audience } = await world();
  assert.deepEqual(await submitOptIn(deps, 'shop-a', { email: 'bot@y.co', consentTicked: true, website: 'x' }), { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.equal((await audience.listSubscribers(CA)).length, 0);
});

test('built-in demo stores, unknown and unpublished stores refuse both actions', async () => {
  const { deps, audience } = await world();
  for (const address of ['demo', 'nope', '', 7, null, 'bad slug!']) {
    assert.equal((await submitOptIn(deps, address, { email: 'a@y.co', consentTicked: true })).ok, false, String(address));
    assert.equal((await submitUnsubscribe(deps, address, { email: 'a@y.co' })).ok, false, String(address));
  }
  assert.equal((await audience.listSubscribers(CA)).length, 0);
});

test('the server actions return only ok and message, and the page shows the form only beside the Test purchase form', () => {
  const actions = readFileSync(new URL('../app/s/[store]/actions.ts', import.meta.url), 'utf8');
  assert.match(actions, /export async function submitOptInAction\(storeAddress: unknown, input: unknown\)/);
  assert.match(actions, /export async function unsubscribeAction\(storeAddress: unknown, input: unknown\)/);
  assert.match(actions, /return \{ ok: r\.ok, message: r\.message \}/);
  const page = readFileSync(new URL('../app/s/[store]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /\{testOffer && optInWording \? <OptInForm store=\{store\.slug\} wording=\{optInWording\} \/> : null\}/);
  assert.doesNotMatch(page, /DEFAULT_OPT_IN_WORDING/);
  assert.match(page, /readOptInWording\(optInDeps\(\), store\.slug\)/);
  const wiring = readFileSync(new URL('../app/s/[store]/_server/audience-wiring.ts', import.meta.url), 'utf8');
  assert.match(wiring, /^\s+limiter,$/m);
  const ui = readFileSync(new URL('../app/s/[store]/_ui/opt-in-form.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<div className="st-sr" inert>/);
  assert.doesNotMatch(ui, /aria-hidden/);
  assert.match(ui, /name="hp_field_x"/);
  assert.match(ui, /website: String\(f\.get\('hp_field_x'\)/);
  assert.equal((ui.match(/catch \{/g) ?? []).length >= 2, true);
  assert.ok(ui.includes('[joining, startJoin] = useTransition()') && ui.includes('[stopping, startStop] = useTransition()'));
  assert.match(ui, /tabIndex=\{-1\}/);
  assert.match(ui, /autoComplete="off"/);
  assert.match(ui, /defaultChecked=\{false\}/);
  assert.match(ui, /aria-live="polite"/);
});
