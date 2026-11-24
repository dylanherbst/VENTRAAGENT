// AMP-153 (F08): the public-store email sign-up, through the same function the server action will call
// (app/s/[store]/_server/audience.ts). The real audience service, memory store and fixture email; the real site-version store and
// registry decide which addresses are guided-setup stores. runtime.ts is not loadable in node, so its dependencies are passed in as
// audience-wiring.ts passes them. No network, no real email.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_OPT_IN_WORDING, MAX_SUBSCRIBERS_PER_BUSINESS, optInFormId, submitOptIn } from '../app/s/[store]/_server/audience.ts';
import type { OptInDeps } from '../app/s/[store]/_server/audience.ts';
import { PUBLIC_OK_MESSAGE, createAudienceService, createMemoryAudienceStore } from '../lib/aimp/audience/index.ts';
import { registryFromSiteVersions } from '../lib/aimp/hosts/registry.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';
import { createSiteVersionStore, seedDemoSites } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const ACTOR = { workspaceId: WORKSPACE, userId: 'demo-owner' };
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });
const CA = { workspaceId: WORKSPACE, businessId: 'biz-a' };
const CB = { workspaceId: WORKSPACE, businessId: 'biz-b' };

async function world(opts: { toolsOn?: boolean; unpublished?: string[] } = {}) {
  const sites = createSiteVersionStore();
  for (const slug of ['shop-a', 'shop-b']) {
    assert.ok((await sites.createSite(ACTOR, storeFor(slug))).ok);
    assert.ok((await sites.publish(ACTOR, slug)).ok);
  }
  assert.ok((await sites.createSite(ACTOR, storeFor('draft-shop'))).ok);
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  const slugs = new Map([['biz-a', 'shop-a'], ['biz-b', 'shop-b'], ['biz-c', 'draft-shop']]);
  const email = createFixtureEmail();
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email });
  const deps: OptInDeps = {
    availability: () => (opts.toolsOn === false ? { available: false, reason: 'Demo storage is switched off.' } : { available: true, reason: '' }),
    world: async () => ({ audience, workspaceId: WORKSPACE, slugs, origin: { primary, sites } }),
  };
  return { deps, audience, email, slugs };
}

const SAFE = /subscriber|status|subscribed|suppressed|emailNorm|"id"|biz-|aud_|workspace/i;

test('a sign-up on store A lands only in A with consent, store_form source and UTMs', async () => {
  const { deps, audience } = await world();
  const r = await submitOptIn(deps, 'shop-a', {
    email: ' Jo@Example.com ', consentTicked: 'on', utm_source: 'pinterest', utm_medium: 'social', utm_campaign: 'launch',
    utm_content: 'pin1', utm_term: 'planner', referrer: 'https://example.test/', pageSlug: 'home', website: '',
  });
  assert.deepEqual(r, { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.equal((await audience.listSubscribers(CA)).length, 1);
  assert.equal((await audience.listSubscribers(CB)).length, 0);
  const log = await audience.consentLog(CA, 'jo@example.com');
  assert.equal(log.length, 1);
  assert.equal(log[0].decision, 'granted');
  assert.equal(log[0].wordingText, DEFAULT_OPT_IN_WORDING);
  assert.equal(log[0].wordingVersion, 1);
  assert.deepEqual(log[0].source, {
    channel: 'store_form', formId: optInFormId('biz-a'), pageSlug: 'home', utmSource: 'pinterest', utmMedium: 'social', utmCampaign: 'launch',
    utmContent: 'pin1', utmTerm: 'planner', referrer: 'https://example.test/',
  });
  assert.equal((await audience.consentLog(CB, 'jo@example.com')).length, 0);
  // store B is separate
  assert.equal((await submitOptIn(deps, 'shop-b', { email: 'jo@example.com', consentTicked: true })).ok, true);
  assert.equal((await audience.listSubscribers(CB)).length, 1);
  assert.equal((await audience.listSubscribers(CA)).length, 1);
});

test('unknown stores, built-in demo stores and unpublished stores are refused and nothing is stored', async () => {
  const { deps, audience } = await world();
  for (const address of ['nope', 'demo', 'draft-shop', '', 5, null, 'bad slug!', 'a'.repeat(200)]) {
    const r = await submitOptIn(deps, address, { email: 'x@y.co', consentTicked: true });
    assert.equal(r.ok, false, String(address));
  }
  // an address a built-in store holds, even when the runtime also lists it
  const clash = await world();
  clash.slugs.set('biz-a', 'demo');
  const r = await submitOptIn(clash.deps, 'demo', { email: 'x@y.co', consentTicked: true });
  assert.equal(r.ok, false);
  for (const c of [CA, CB, { workspaceId: WORKSPACE, businessId: 'biz-c' }]) {
    assert.equal((await audience.listSubscribers(c)).length, 0);
    assert.equal((await clash.audience.listSubscribers(c)).length, 0);
  }
});

test('demo storage switched off refuses with the plain reason', async () => {
  const { deps, audience } = await world({ toolsOn: false });
  assert.deepEqual(await submitOptIn(deps, 'shop-a', { email: 'x@y.co', consentTicked: true }), { ok: false, message: 'Demo storage is switched off.' });
  assert.equal((await audience.listSubscribers(CA)).length, 0);
});

test('no tick, a bad email or a bad body is refused and nothing is stored', async () => {
  const { deps, audience } = await world();
  for (const body of [{ email: 'a@b.co' }, { email: 'a@b.co', consentTicked: false }, { email: 'a@b.co', consentTicked: 'off' }, { email: 'nope', consentTicked: true }, { email: 'a​@b.co', consentTicked: true }, null, 'x', 7, undefined]) {
    const r = await submitOptIn(deps, 'shop-a', body);
    assert.equal(r.ok, false, JSON.stringify(body));
  }
  assert.equal((await audience.listSubscribers(CA)).length, 0);
});

test('a filled honeypot replies ok and stores nothing', async () => {
  const { deps, audience } = await world();
  const r = await submitOptIn(deps, 'shop-a', { email: 'bot@y.co', consentTicked: true, website: 'http://spam.test' });
  assert.deepEqual(r, { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.equal((await audience.listSubscribers(CA)).length, 0);
  assert.equal(await audience.getForm(CA, optInFormId('biz-a')), null);
});

test('a repeat submit gives the same reply and one subscriber; the default form is created once', async () => {
  const { deps, audience } = await world();
  const first = await submitOptIn(deps, 'shop-a', { email: 'a@y.co', consentTicked: true });
  const again = await submitOptIn(deps, 'shop-a', { email: 'A@y.co', consentTicked: true });
  assert.deepEqual(first, again);
  assert.equal((await audience.listSubscribers(CA)).length, 1);
  assert.equal((await audience.consentLog(CA, 'a@y.co')).length, 1);
  const form = await audience.getForm(CA, optInFormId('biz-a'));
  assert.equal(form?.wordingVersion, 1);
  assert.equal(form?.wordingText, DEFAULT_OPT_IN_WORDING);
});

test('the reply never contains the subscriber, a status or an id', async () => {
  const { deps } = await world();
  const replies = [
    await submitOptIn(deps, 'shop-a', { email: 'a@y.co', consentTicked: true }),
    await submitOptIn(deps, 'shop-a', { email: 'a@y.co', consentTicked: true }),
    await submitOptIn(deps, 'shop-a', { email: 'a@y.co' }),
    await submitOptIn(deps, 'shop-a', { email: 'zz', consentTicked: true }),
    await submitOptIn(deps, 'nope', { email: 'a@y.co', consentTicked: true }),
  ];
  for (const r of replies) {
    assert.deepEqual(Object.keys(r).sort(), ['message', 'ok']);
    assert.doesNotMatch(JSON.stringify(r), SAFE);
    assert.ok(!JSON.stringify(r).includes('a@y.co'));
  }
});

test('a suppressed or unsubscribed address gets the same ok reply and is not revived or revealed', async () => {
  const { deps, audience } = await world();
  const fresh = await submitOptIn(deps, 'shop-a', { email: 'fresh@y.co', consentTicked: true });
  assert.ok((await audience.suppress(CA, 'blocked@y.co', 'complaint')).ok);
  const blocked = await submitOptIn(deps, 'shop-a', { email: 'blocked@y.co', consentTicked: true });
  assert.deepEqual(blocked, fresh);
  assert.equal(await audience.canSendMarketing(CA, 'blocked@y.co'), false);
  assert.equal((await audience.listSubscribers(CA, { status: 'suppressed' })).length, 1);
  // an unsubscribed address that ticks again is subscribed again (single opt-in)
  assert.ok((await audience.unsubscribe(CA, 'fresh@y.co')).ok);
  assert.deepEqual(await submitOptIn(deps, 'shop-a', { email: 'fresh@y.co', consentTicked: true }), fresh);
  assert.equal(await audience.canSendMarketing(CA, 'fresh@y.co'), true);
});

test('the per-business cap refuses plainly and does not touch another business', async () => {
  const { deps, audience } = await world();
  for (let i = 0; i < MAX_SUBSCRIBERS_PER_BUSINESS; i += 1) {
    assert.ok((await audience.suppress(CA, `s${i}@y.co`, 'seed')).ok);
  }
  const r = await submitOptIn(deps, 'shop-a', { email: 'late@y.co', consentTicked: true });
  assert.equal(r.ok, false);
  assert.equal((await audience.listSubscribers(CA)).length, MAX_SUBSCRIBERS_PER_BUSINESS);
  assert.equal((await submitOptIn(deps, 'shop-b', { email: 'late@y.co', consentTicked: true })).ok, true);
});

test('runtime.ts exposes the audience service built on the runtime fixture email', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /audience: AudienceService/);
  assert.match(src, /audience: createAudienceService\(\{ store: createMemoryAudienceStore\(\), email: createFixtureEmail\(\) \}\)/);
  const wiring = readFileSync(new URL('../app/s/[store]/_server/audience-wiring.ts', import.meta.url), 'utf8');
  assert.match(wiring, /audience: rt\.audience/);
  assert.match(wiring, /slugs: rt\.slugs/);
});
