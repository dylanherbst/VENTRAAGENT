// AMP-035 (D03): publish smoke test + rollback. Real site-versions store and real seller gate; no network, no live provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogueService } from '../lib/aimp/catalogue/service.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../lib/aimp/sellers/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';
import { createSiteVersionStore, demoActorA, demoActorB, type SiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import {
  createCheckoutProbe, createPageLoader, publishWithCheck, runPublishCheck,
  type CheckoutProbe, type PublishCheckDeps, type PublishSiteApi,
} from '../lib/aimp/publish-check/index.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const BIZ_A = 'biz-a';
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };
const BROKEN = 'This page is broken';
const FIRST = demoStore.products[0];

/** A sellable (non-demo, charges on) copy of the demo store. */
const sellable: StoreConfig = { ...structuredClone(demoStore), demo: false, merchant: { chargesEnabled: true } };

async function setup(opts: { config?: StoreConfig; publishFirst?: boolean } = {}) {
  const versions = createSiteVersionStore();
  const created = await versions.createSite(A, opts.config ?? demoStore);
  assert.equal(created.ok, true);
  if (opts.publishFirst !== false) assert.equal((await versions.publish(A, SLUG)).ok, true);
  return versions;
}

const live = async (v: SiteVersionStore) => { const r = await v.resolvePublished(SLUG); return r.status === 'live' ? r.config.hero.heading : r.status; };

function deps(versions: PublishSiteApi, over: Partial<PublishCheckDeps> = {}): { versions: PublishSiteApi; check: PublishCheckDeps; pageCalls: string[]; probeCalls: string[] } {
  const pageCalls: string[] = [];
  const probeCalls: string[] = [];
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  const check: PublishCheckDeps = {
    resolveLive: (slug) => versions.resolvePublished(slug),
    // A page "fails to load" whenever the live heading is the broken marker (a stand-in for a render error).
    loadPage: async (slug, ref) => {
      pageCalls.push(`${slug}:${ref.page}`);
      const r = await versions.resolvePublished(slug);
      if (r.status === 'live' && r.config.hero.heading === BROKEN && ref.page === 'home') return { ok: false, reason: 'it threw while rendering.' };
      return base(slug, ref);
    },
    checkout: { canStart: async (i) => { probeCalls.push(`${i.workspaceId}/${i.businessId}/${i.storeSlug}/${i.productSlug}`); return { ok: true }; } },
    checkoutAvailable: true,
    ...over,
  };
  return { versions, check, pageCalls, probeCalls };
}

test('pass: the new version is live and every page and checkout check is reported', async () => {
  const versions = await setup({ config: sellable });
  await versions.editDraft(A, SLUG, setHeading('A fresh heading'));
  const d = deps(versions);
  const r = await publishWithCheck(d, { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.version, 2);
  const ids = r.checks.map((c) => c.check);
  assert.ok(ids.includes('live-version') && ids.includes('page:home') && ids.includes('page:contact'));
  for (const p of ['refund', 'privacy', 'terms']) assert.ok(ids.includes(`page:policy:${p}`));
  for (const p of sellable.products) { assert.ok(ids.includes(`page:product:${p.slug}`)); assert.ok(ids.includes(`checkout:${p.slug}`)); }
  assert.equal(d.probeCalls.length, sellable.products.length);
  assert.equal(await live(versions), 'A fresh heading');
});

test('a demo store passes but says checkout was not tested', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Demo tweak'));
  const r = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.skipped[0].detail, /Checkout was not tested/);
});

test('the real storefront flag is honoured: checkout is skipped while it is not built', async () => {
  const versions = await setup({ config: sellable });
  const d = deps(versions, { checkoutAvailable: undefined });
  await versions.editDraft(A, SLUG, setHeading('Flag check'));
  const r = await publishWithCheck(d, { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, true);
  assert.equal(d.probeCalls.length, 0);
});

test('a page fails to load: the publish is rolled back to the previous version', async () => {
  const versions = await setup();
  const original = await live(versions);
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const r = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.rolledBackTo, 1);
  assert.match(r.message, /home page did not load/);
  assert.equal(r.failed[0].check, 'page:home');
  assert.equal(await live(versions), original, 'the earlier content is live again');
});

test('the first publish fails: the store ends unpublished and a later good publish still works', async () => {
  const versions = await setup({ publishFirst: false });
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const r = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'unpublished');
  assert.equal((await versions.resolvePublished(SLUG)).status, 'paused', 'visitors see nothing');
  await versions.editDraft(A, SLUG, setHeading('Fixed'));
  const refused = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(refused.ok, false, 'paused: nothing is published until the owner resumes');
  if (!refused.ok) assert.equal(refused.outcome, 'not_published');
  await versions.unpause(A, SLUG);
  const again = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(again.ok, true);
  assert.equal(await live(versions), 'Fixed');
});

test('checkout cannot start: rolled back, and the reason is in plain English', async () => {
  const versions = await setup({ config: sellable });
  await versions.editDraft(A, SLUG, setHeading('New look'));
  const d = deps(versions, { checkout: { canStart: async (i) => (i.productSlug === FIRST.slug ? { ok: false, reason: 'the product has no approved listing.' } : { ok: true }) } });
  const r = await publishWithCheck(d, { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.deepEqual(r.failed.map((f) => f.check), [`checkout:${FIRST.slug}`]);
  assert.match(r.message, /Checkout cannot start/);
  assert.equal(await live(versions), sellable.hero.heading);
});

test('the real seller gate decides: no seller connected is reported, not pretended away', async () => {
  const versions = await setup({ config: sellable });
  await versions.editDraft(A, SLUG, setHeading('Needs a seller'));
  const sellers = createInMemorySellerStore();
  const approved = { workspaceId: A.workspaceId, businessId: BIZ_A } as never;
  const probe = createCheckoutProbe({
    stores: { resolve: async () => ({ workspaceId: A.workspaceId, businessId: BIZ_A }) },
    catalogue: {
      getApprovedListing: async () => approved,
      getCheckoutPrice: async () => ({ listingId: 'l1', listingVersion: 1, productId: 'p1', productVersion: 1, priceMinor: 900, currency: 'AUD', title: 'T' }),
    } as unknown as Pick<CatalogueService, 'getApprovedListing' | 'getCheckoutPrice'>,
    sellers,
    payments: () => ({ status: { status: 'fixture', label: 'Fixture' }, adapter: {} as never }),
    listingIdFor: async () => 'l1',
  });
  const r = await publishWithCheck(deps(versions, { checkout: probe }), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.match(r.message, /connect Stripe/);

  // With a ready seller the same probe passes.
  const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
  assert.ok(ready);
  sellers.register({ workspaceId: A.workspaceId, businessId: BIZ_A, stripeAccountId: ready.id, snapshot: ready, lastEventCreated: 0 });
  const ok = await publishWithCheck(deps(versions, { checkout: probe }), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(ok.ok, true);
});

test('a rollback that fails is reported, never swallowed', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const failing: PublishSiteApi = {
    publish: versions.publish.bind(versions), pause: versions.pause.bind(versions),
    history: versions.history.bind(versions), resolvePublished: versions.resolvePublished.bind(versions), getVersion: versions.getVersion.bind(versions),
    rollback: async () => ({ ok: false, code: 'failed', errors: ['Storage is unavailable.'] }),
  };
  const r = await publishWithCheck(deps(failing), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rollback_failed');
  assert.deepEqual(r.rollbackErrors, ['Storage is unavailable.']);
  assert.match(r.message, /could NOT be taken down/);
});

test('a pause that fails on a first publish is also reported', async () => {
  const versions = await setup({ publishFirst: false });
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const failing: PublishSiteApi = {
    publish: versions.publish.bind(versions), rollback: versions.rollback.bind(versions),
    history: versions.history.bind(versions), resolvePublished: versions.resolvePublished.bind(versions), getVersion: versions.getVersion.bind(versions),
    pause: async () => ({ ok: false, code: 'failed', errors: ['Could not pause.'] }),
  };
  const r = await publishWithCheck(deps(failing), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'rollback_failed'); assert.deepEqual(r.rollbackErrors, ['Could not pause.']); }
});

test('a publish the store refuses changes nothing and runs no check', async () => {
  const versions = await setup();
  const d = deps(versions);
  const r = await publishWithCheck(d, { actor: A, businessId: BIZ_A, storeSlug: SLUG, expectedRevision: 99 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'not_published');
  assert.equal(d.pageCalls.length, 0);
});

test('an unchanged draft that fails its check is reported without rolling anything back', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  await versions.publish(A, SLUG); // already live and broken (published outside the check)
  const r = await publishWithCheck(deps(versions), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'unchanged_check_failed');
  assert.equal((await versions.history(A, SLUG) as { value: { versions: unknown[] } }).value.versions.length, 2);
});

test('a throwing check counts as a failed check and still rolls back', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Different'));
  const r = await publishWithCheck(deps(versions, { loadPage: async () => { throw new Error('boom secret'); } }), { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.message.includes('boom secret'), false, 'no raw error text reaches the owner');
});

test('isolation: another workspace cannot publish or check this store and nothing is read', async () => {
  const versions = await setup();
  const d = deps(versions);
  const r = await publishWithCheck(d, { actor: demoActorB, businessId: 'biz-b', storeSlug: SLUG });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'not_published');
  assert.equal(d.pageCalls.length + d.probeCalls.length, 0);
});

test('isolation: a check for business A only ever passes business A to checkout, and the probe refuses B for A\'s store', async () => {
  const versions = await setup({ config: sellable });
  await versions.editDraft(A, SLUG, setHeading('Iso'));
  const d = deps(versions);
  const r = await publishWithCheck(d, { actor: A, businessId: BIZ_A, storeSlug: SLUG });
  assert.equal(r.ok, true);
  assert.ok(d.probeCalls.every((c) => c.startsWith(`${A.workspaceId}/${BIZ_A}/`)));

  const reads: string[] = [];
  const probe: CheckoutProbe = createCheckoutProbe({
    stores: { resolve: async () => ({ workspaceId: A.workspaceId, businessId: BIZ_A }) },
    catalogue: { getApprovedListing: async (c: { businessId?: string }) => { reads.push(String(c.businessId)); return null; }, getCheckoutPrice: async () => { throw new Error('unused'); } } as unknown as Pick<CatalogueService, 'getApprovedListing' | 'getCheckoutPrice'>,
    sellers: createInMemorySellerStore(),
    payments: () => ({ status: { status: 'fixture', label: 'F' }, adapter: null }),
    listingIdFor: async () => 'l1',
  });
  const wrong = await probe.canStart({ workspaceId: A.workspaceId, businessId: 'biz-b', storeSlug: SLUG, productSlug: FIRST.slug });
  assert.equal(wrong.ok, false);
  assert.deepEqual(reads, [], 'the catalogue was not read for the other business');
  const wrongWs = await probe.canStart({ workspaceId: 'other-ws', businessId: BIZ_A, storeSlug: SLUG, productSlug: FIRST.slug });
  assert.equal(wrongWs.ok, false);
  assert.deepEqual(reads, []);
});

test('runPublishCheck fails on a wrong version, a paused store and a store at another address', async () => {
  const versions = await setup();
  const d = deps(versions).check;
  const base = { workspaceId: A.workspaceId, businessId: BIZ_A, storeSlug: SLUG };
  const wrongVersion = await runPublishCheck(d, { ...base, versionId: 7 });
  assert.equal(wrongVersion.ok, false);
  const unknown = await runPublishCheck(d, { ...base, storeSlug: 'no-such-store', versionId: 1 });
  assert.equal(unknown.ok, false);
  await versions.pause(A, SLUG);
  const paused = await runPublishCheck(d, { ...base, versionId: 1 });
  assert.equal(paused.ok, false);
  if (!paused.ok) assert.match(paused.failed[0].reason, /paused/);
});
