// AMP-146: the /start runtime's job engine runs the REAL publish check for a business that has a store (no stub), and the labelled
// demo stub only where no store exists. Builds the same objects app/start/_server/runtime.ts builds, through createStartAutomation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStartAutomation } from '../app/start/_server/automation-runtime.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../lib/aimp/sellers/index.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import type { SiteVersionStore, Actor } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';
import { PAGE_PROOF } from '../lib/aimp/publish-check/index.ts';

const WS = 'demo-workspace';
const actor: Actor = { workspaceId: WS, userId: 'demo-owner' };
const ctx = (businessId: string, key: string) => ({ workspaceId: WS, businessId, actorUserId: 'u', idempotencyKey: key });
const payments = createProviderRegistry({ env: {} }).payments;

interface Opts { sites?: SiteVersionStore; checkoutAvailable?: boolean; withSeller?: string[]; listings?: Record<string, StoreConfig> }
function build(o: Opts = {}) {
  const sites = o.sites ?? createSiteVersionStore();
  const slugs = new Map<string, string>();
  const sellers = createInMemorySellerStore();
  const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')!.snapshot;
  for (const b of o.withSeller ?? []) sellers.register({ workspaceId: WS, businessId: b, stripeAccountId: `acct_${b}`, snapshot: { ...ready, id: `acct_${b}` } as never, lastEventCreated: 0 });
  // Fake approved listings, one per store product, whose title slugifies back to the product slug (so listingIdFor finds them).
  const catalogue = {
    async listApprovedForBusiness(c: { businessId: string }) {
      const cfg = o.listings?.[c.businessId];
      return (cfg?.products ?? []).map((p) => ({ listingId: `l-${c.businessId}-${p.slug}`, businessId: c.businessId, title: p.slug.split('-').join(' ') }));
    },
    async getApprovedListing(_c: unknown, id: string) {
      return { listingId: id, workspaceId: WS, businessId: Object.keys(o.listings ?? {}).find((b) => id.startsWith(`l-${b}-`)) };
    },
    async getCheckoutPrice() { return { priceMinor: 1900 }; },
  };
  const automation = createStartAutomation({
    publish: { workspaceId: WS, sites, slugs, catalogue: catalogue as never, sellers, payments: () => ({ status: payments.status, adapter: payments.adapter }), checkoutAvailable: o.checkoutAvailable },
  });
  return { sites, slugs, automation, sellers };
}
async function addStore(sites: SiteVersionStore, slugs: Map<string, string>, businessId: string, cfg: StoreConfig) {
  const r = await sites.createSite(actor, structuredClone(cfg));
  assert.ok(r.ok);
  slugs.set(businessId, cfg.slug);
}
async function run(a: ReturnType<typeof build>['automation'], businessId: string, key: string, input: Record<string, string>) {
  const known = new Set((await a.jobs.service.list(ctx(businessId, key))).map((j) => j.id));
  await a.jobs.service.enqueue(ctx(businessId, key), { kind: 'publish-site', input });
  await a.jobs.runner.drain();
  const fresh = (await a.jobs.service.list(ctx(businessId, key))).filter((j) => !known.has(j.id) && j.businessId === businessId);
  assert.equal(fresh.length, 1, 'exactly one new job');
  return fresh[0];
}
const out = (j: { steps: { name: string; output: unknown }[] }, name: string) => j.steps.find((s) => s.name === name)?.output as Record<string, unknown>;

test('real path: a business with a store gets the real check (versions, in-process pages, business probe), not the stub', async () => {
  const { sites, slugs, automation } = build();
  await addStore(sites, slugs, 'biz-a', demoStore);
  const j = await run(automation, 'biz-a', 'k1', { storeSlug: demoStore.slug });
  assert.equal(j.status, 'succeeded');
  const pub = out(j, 'publish');
  assert.equal(pub.published, true);
  assert.equal(pub.demo, undefined);
  assert.ok(String(JSON.stringify(pub)).indexOf('demo.invalid') < 0);
  const checks = pub.checks as { check: string; detail: string }[];
  assert.ok(checks.some((c) => c.check === 'live-version'));
  const home = checks.find((c) => c.check === 'page:home');
  assert.ok(home?.detail.includes(PAGE_PROOF), 'page check says it was not fetched over HTTP');
  assert.ok(!/\bloads\./.test(home?.detail ?? ''));
  assert.ok(checks.some((c) => c.check === 'business'), 'the checkout probe store directory matched the business');
  assert.equal(out(j, 'smoke-test').demo, undefined);
  assert.equal((await sites.resolvePublished(demoStore.slug)).status, 'live');
});

test('real path with checkout: the probe reads the seller and listing state and passes', async () => {
  const cfg = { ...structuredClone(demoStore), demo: false, merchant: { chargesEnabled: true } } as StoreConfig;
  const { sites, slugs, automation } = build({ checkoutAvailable: true, withSeller: ['biz-a'], listings: { 'biz-a': cfg } });
  await addStore(sites, slugs, 'biz-a', cfg);
  const j = await run(automation, 'biz-a', 'k1', { storeSlug: cfg.slug });
  assert.equal(j.status, 'succeeded');
  assert.equal(out(j, 'smoke-test').checkout, 'passed');
  const checks = out(j, 'publish').checks as { check: string }[];
  assert.ok(checks.some((c) => c.check.startsWith('checkout:')));
});

test('real path with checkout: no seller account fails the check, the first publish is paused and the job fails', async () => {
  const cfg = { ...structuredClone(demoStore), demo: false, merchant: { chargesEnabled: true } } as StoreConfig;
  const { sites, slugs, automation } = build({ checkoutAvailable: true, listings: { 'biz-a': cfg } });
  await addStore(sites, slugs, 'biz-a', cfg);
  const j = await run(automation, 'biz-a', 'k1', { storeSlug: cfg.slug });
  assert.equal(j.status, 'failed');
  const pub = out(j, 'publish');
  assert.equal(pub.published, false);
  assert.equal(pub.outcome, 'unpublished');
  assert.ok((pub.failed as { check: string }[]).some((f) => f.check.startsWith('checkout:')));
  assert.equal((await sites.resolvePublished(cfg.slug)).status, 'paused');
});

test('failing check, first publish: the store cannot load as published, so it is paused and the job fails', async () => {
  // A store accepted by a lax version store but refused by the storefront loader (fail closed): the page check fails.
  const sites = createSiteVersionStore({ validate: (c) => ({ ok: true, config: c as StoreConfig }) as never });
  const { slugs, automation } = build({ sites });
  const broken = { ...structuredClone(demoStore), contact: { ...demoStore.contact, email: '' } } as StoreConfig;
  await addStore(sites, slugs, 'biz-a', broken);
  const j = await run(automation, 'biz-a', 'k1', { storeSlug: broken.slug });
  assert.equal(j.status, 'failed');
  assert.equal(out(j, 'publish').outcome, 'unpublished');
  assert.equal((await sites.resolvePublished(broken.slug)).status, 'paused');
  assert.ok(String(j.lastError).length > 0);
});

test('failing check, later publish: the store is rolled back to the earlier good version', async () => {
  const sites = createSiteVersionStore({ validate: (c) => ({ ok: true, config: c as StoreConfig }) as never });
  const { slugs, automation } = build({ sites });
  await addStore(sites, slugs, 'biz-a', demoStore);
  const first = await run(automation, 'biz-a', 'k1', { storeSlug: demoStore.slug });
  assert.equal(first.status, 'succeeded');
  const edit = await sites.editDraft(actor, demoStore.slug, (d) => { d.contact.email = ''; });
  assert.ok(edit.ok);
  const second = await run(automation, 'biz-a', 'k2', { storeSlug: demoStore.slug });
  assert.equal(second.status, 'failed');
  const pub = out(second, 'publish');
  assert.equal(pub.outcome, 'rolled_back');
  assert.equal(pub.rolledBackTo, 1);
  const live = await sites.resolvePublished(demoStore.slug);
  assert.equal(live.status, 'live');
  assert.ok(live.status === 'live' && live.config.contact.email === demoStore.contact.email);
});

test('demo stub only where no store exists, and it says demo', async () => {
  const { sites, slugs, automation } = build();
  await addStore(sites, slugs, 'biz-a', demoStore);
  const j = await run(automation, 'biz-nostore', 'k1', { storeSlug: demoStore.slug });
  assert.equal(j.status, 'succeeded');
  assert.equal(out(j, 'publish').demo, true);
  assert.match(String(out(j, 'publish').liveUrl), /demo\.invalid/);
  assert.equal(out(j, 'smoke-test').demo, true);
  assert.equal((await sites.resolvePublished(demoStore.slug)).status, 'none', 'the stub published nothing');
  // a slug entry with no store behind it is also "no store"
  slugs.set('biz-ghost', 'ghost-store');
  const g = await run(automation, 'biz-ghost', 'k2', { storeSlug: 'ghost-store' });
  assert.equal(out(g, 'publish').demo, true);
});

// A store that reads fine until its Nth getDraft call, then throws or answers not-ok (the resolver reads the draft once per step).
function flaky(real: SiteVersionStore, failFrom: number, mode: 'throw' | 'notok') {
  let calls = 0;
  return {
    ...real,
    async getDraft(a: Actor, slug: string) {
      calls += 1;
      if (calls < failFrom) return real.getDraft(a, slug);
      if (mode === 'throw') throw new Error('store backend down');
      return { ok: false as const, code: 'failed' as const, errors: ['backend down'] };
    },
  } as SiteVersionStore;
}
async function assertNoFakePass(failFrom: number, mode: 'throw' | 'notok') {
  const real = createSiteVersionStore();
  const sites = flaky(real, failFrom, mode);
  const { slugs, automation } = build({ sites });
  await addStore(real, slugs, 'biz-a', demoStore);
  const j = await run(automation, 'biz-a', 'k1', { storeSlug: demoStore.slug });
  assert.notEqual(j.status, 'succeeded');
  assert.ok(String(j.lastError).length > 0);
  assert.ok(!JSON.stringify(j.steps).includes('demo.invalid'), 'no stub output');
  assert.ok(!j.steps.some((s) => (s.output as { demo?: boolean } | null)?.demo === true), 'no demo marker');
  assert.ok(!out(j, 'smoke-test'), 'the smoke test never passed');
  assert.notEqual((await real.resolvePublished(demoStore.slug)).status, 'live', 'this job did not publish the store');
  return j;
}

test('B1(a): the resolver throws in the publish step for a store: no stub, nothing published, retryable', async () => {
  const j = await assertNoFakePass(2, 'throw');
  assert.equal(j.status, 'waiting-retry', 'a temporary error leaves the job to retry, not failed for good');
  assert.equal(out(j, 'check-version').real, true);
});

test('B1(b): getDraft answers not-ok for a business with a store address: no stub', async () => {
  const j = await assertNoFakePass(2, 'notok');
  assert.equal(j.status, 'waiting-retry');
});

test('B1(c): the resolver throws on check-version: no stub, retryable', async () => {
  const j = await assertNoFakePass(1, 'throw');
  assert.equal(j.status, 'waiting-retry');
});

test('createStartAutomation() with no stores stays on the labelled stub', async () => {
  const a = createStartAutomation();
  const j = await run(a, 'biz-a', 'k1', { storeSlug: 'anything' });
  assert.equal(j.status, 'succeeded');
  assert.equal(out(j, 'publish').demo, true);
  assert.equal(out(j, 'smoke-test').demo, true);
});

test('connectPublish after creation (how runtime.ts wires it) switches the engine from the stub to the real check', async () => {
  const a = createStartAutomation();
  const before = await run(a, 'biz-pre', 'k0', { storeSlug: demoStore.slug });
  assert.equal(out(before, 'publish').demo, true);
  const { sites, slugs } = build();
  await addStore(sites, slugs, 'biz-a', demoStore);
  a.connectPublish({ workspaceId: WS, sites, slugs, catalogue: {} as never, sellers: createInMemorySellerStore(), payments: () => ({ status: payments.status, adapter: payments.adapter }) });
  const j = await run(a, 'biz-a', 'k1', { storeSlug: demoStore.slug });
  assert.equal(j.status, 'succeeded');
  assert.equal(out(j, 'publish').published, true);
  assert.equal((await sites.resolvePublished(demoStore.slug)).status, 'live');
});

test('runtime.ts connects the engine to its own sites, slugs, catalogue and sellers', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /rt\.automation\.connectPublish\(\{[\s\S]*sites: rt\.sites, slugs: rt\.slugs, catalogue, sellers/);
});

test('a job from another workspace gets no store (stub), never the runtime workspace store', async () => {
  const { sites, slugs, automation } = build();
  await addStore(sites, slugs, 'biz-a', demoStore);
  await automation.jobs.service.enqueue({ workspaceId: 'other-ws', businessId: 'biz-a', actorUserId: 'u', idempotencyKey: 'x' }, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await automation.jobs.runner.drain();
  assert.equal((await sites.resolvePublished(demoStore.slug)).status, 'none');
});

test('two businesses: A\'s job cannot publish, check or roll back B\'s store', async () => {
  const { sites, slugs, automation } = build();
  await addStore(sites, slugs, 'biz-a', demoStore);
  await addStore(sites, slugs, 'biz-b', demoStoreB);
  // B publishes through its own job first.
  const b1 = await run(automation, 'biz-b', 'kb', { storeSlug: demoStoreB.slug });
  assert.equal(b1.status, 'succeeded');
  const before = await sites.history(actor, demoStoreB.slug);
  assert.ok(before.ok);
  // A names B's address: refused, nothing about B changes.
  const j = await run(automation, 'biz-a', 'ka', { storeSlug: demoStoreB.slug });
  assert.equal(j.status, 'failed');
  assert.notEqual(out(j, 'publish').published, true);
  assert.equal(out(j, 'publish').outcome, 'not_published');
  const after = await sites.history(actor, demoStoreB.slug);
  assert.ok(after.ok && before.ok);
  assert.deepEqual(after.value.events, before.value.events);
  assert.equal(after.value.liveVersion, before.value.liveVersion);
  assert.equal((await sites.resolvePublished(demoStoreB.slug)).status, 'live');
  // A's own store was not touched by that job either.
  assert.equal((await sites.resolvePublished(demoStore.slug)).status, 'none');
  // And a failing A cannot roll B back: break A's publish, B stays on the same live version.
  const a = await run(automation, 'biz-a', 'ka2', { storeSlug: demoStore.slug });
  assert.equal(a.status, 'succeeded');
  assert.equal((await sites.resolvePublished(demoStoreB.slug)).status, 'live');
  const end = await sites.history(actor, demoStoreB.slug);
  assert.ok(end.ok);
  assert.deepEqual(end.value.events, before.value.events);
});

test('two businesses: a failing check on A pauses/rolls back only A', async () => {
  const sites = createSiteVersionStore({ validate: (c) => ({ ok: true, config: c as StoreConfig }) as never });
  const { slugs, automation } = build({ sites });
  await addStore(sites, slugs, 'biz-b', demoStoreB);
  const b = await run(automation, 'biz-b', 'kb', { storeSlug: demoStoreB.slug });
  assert.equal(b.status, 'succeeded');
  const broken = { ...structuredClone(demoStore), contact: { ...demoStore.contact, email: '' } } as StoreConfig;
  await addStore(sites, slugs, 'biz-a', broken);
  const a = await run(automation, 'biz-a', 'ka', { storeSlug: broken.slug });
  assert.equal(a.status, 'failed');
  assert.equal((await sites.resolvePublished(broken.slug)).status, 'paused');
  assert.equal((await sites.resolvePublished(demoStoreB.slug)).status, 'live');
});
