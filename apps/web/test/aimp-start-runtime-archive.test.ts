// AMP-151: the /start runtime gives its product service the published-store probe, so archiving a product can say "republish".
// runtime.ts is not loadable in node, so this builds the SAME wiring (same factories, same lazy closures over a later-built `rt`)
// on the real product service and the real site-version store, and checks the runtime source still carries that wiring.
// Known limit (store-draft.ts is the owner's): guided-setup store products do not carry `productId` yet, so these published
// stores are built with productId set directly through the site store.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createSitePublishedStoreProbe, createTenantStoreSlugFor } from '../lib/aimp/products/published-store.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const actor: Actor = { workspaceId: WORKSPACE, userId: OWNER };
const pctx = { workspaceId: WORKSPACE, actorId: OWNER };

/** Mirrors runtime(): the product service is built BEFORE `rt`, and the probe reads rt.sites / rt.slugs only when called. */
function setup() {
  const llm = createProviderRegistry({ env: {} }).llm;
  const blueprint = blueprintRegistry.find('printable-planner');
  assert.ok(blueprint);
  const products = createProductService({
    store: createMemoryProductStore(),
    publishedStores: createSitePublishedStoreProbe({
      resolvePublished: (slug) => rt.sites.resolvePublished(slug),
      storeSlugFor: createTenantStoreSlugFor({
        sites: { listSites: (a) => rt.sites.listSites(a) },
        storeOf: (workspaceId, businessId) => {
          const slug = workspaceId === WORKSPACE ? rt.slugs.get(businessId) : undefined;
          return slug ? { slug, userId: OWNER } : null;
        },
      }),
    }),
    generateSpec: async () => { throw new Error('not used'); },
  });
  const rt = { sites: createSiteVersionStore(), slugs: new Map<string, string>() };

  const product = async (businessId: string) => {
    const spec = await generateProductSpec({ blueprint, provider: llm, inputs: { niche: `niche ${businessId}`, audience: 'Busy people', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } });
    const { product: p, version } = await products.createProduct(pctx, { businessId, spec });
    await products.approve(pctx, version.id);
    return p;
  };
  /** A store for the business, as actions.ts records it (createSite, then rt.slugs.set). `productId` is set directly, not via store-draft. */
  const store = async (businessId: string, slug: string, productId: string | null, publish = true) => {
    const config: StoreConfig = {
      ...structuredClone(demoStore), slug, status: 'draft', demo: true, sections: ['featured', 'catalogue'], bundles: [],
      products: demoStore.products.slice(0, 1).map((p) => structuredClone({ ...p, ...(productId ? { productId } : {}) })),
    };
    const created = await rt.sites.createSite(actor, config);
    assert.ok(created.ok, JSON.stringify(created));
    rt.slugs.set(businessId, created.value.slug);
    if (publish) assert.ok((await rt.sites.publish(actor, created.value.slug)).ok);
    return created.value.slug;
  };
  return { products, rt, product, store };
}

test('AMP-151: the runtime wires the lazy published-store probe into its product service', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /publishedStores: createSitePublishedStoreProbe\(/);
  assert.match(src, /createTenantStoreSlugFor\(/);
  assert.match(src, /resolvePublished: \(slug\) => rt\.sites\.resolvePublished\(slug\)/, 'resolved at call time from rt');
  assert.match(src, /rt\.slugs\.get\(businessId\)/);
  assert.match(src, /workspaceId === WORKSPACE/);
});

test('AMP-151: archiving a product a live guided-setup store still shows says "republish"', async () => {
  const { products, product, store } = setup();
  const p = await product('biz-a');
  await store('biz-a', 'store-a', p.id);
  const r = await products.archiveProduct(pctx, p.id, 'biz-a');
  assert.deepEqual([r.publishedStore, r.storeNeedsRepublish], ['shown', true]);
});

test('AMP-151: another business whose store does not show the product is "not shown", and a business with no store is too', async () => {
  const { products, product, store } = setup();
  const a = await product('biz-a');
  const b = await product('biz-b');
  const c = await product('biz-c');
  await store('biz-a', 'store-a', a.id);
  await store('biz-b', 'store-b', 'some-other-product'); // a live store whose only product is a different one
  const rb = await products.archiveProduct(pctx, b.id, 'biz-b');
  assert.deepEqual([rb.publishedStore, rb.storeNeedsRepublish], ['not_shown', false]);
  const rc = await products.archiveProduct(pctx, c.id, 'biz-c'); // never created a store
  assert.deepEqual([rc.publishedStore, rc.storeNeedsRepublish], ['not_shown', false]);
  assert.equal((await products.archiveProduct(pctx, a.id, 'biz-a')).publishedStore, 'shown', 'A is unaffected');
});

test('AMP-151: a business\'s check never reads another business\'s store, even when the other store lists its product id', async () => {
  const { products, rt, product, store } = setup();
  const a = await product('biz-a');
  const b = await product('biz-b');
  // Only business B has a store, and it (wrongly) carries A's product id. A's check must not look at B's store.
  await store('biz-b', 'store-b', a.id);
  const ra = await products.archiveProduct(pctx, a.id, 'biz-a');
  assert.deepEqual([ra.publishedStore, ra.storeNeedsRepublish], ['not_shown', false]);
  // B's own product is not on B's store.
  assert.equal((await products.archiveProduct(pctx, b.id, 'biz-b')).publishedStore, 'not_shown');
  // A slug recorded for A that the demo owner does not own is refused by the real site store, not trusted.
  rt.slugs.set('biz-a', 'ghost-store');
  assert.equal((await products.archiveProduct(pctx, a.id, 'biz-a')).publishedStore, 'not_shown');
});

test('AMP-151: a paused store is not shown; a store whose products carry no product id is unknown (today\'s real guided-setup store)', async () => {
  const { products, rt, product, store } = setup();
  const a = await product('biz-a');
  const slug = await store('biz-a', 'store-a', a.id);
  assert.ok((await rt.sites.pause(actor, slug)).ok);
  assert.equal((await products.archiveProduct(pctx, a.id, 'biz-a')).publishedStore, 'not_shown');

  // store-draft.ts does not set productId yet: no id on the store products and no slug fallback is supplied by the runtime.
  const b = await product('biz-b');
  await store('biz-b', 'store-b', null);
  const rb = await products.archiveProduct(pctx, b.id, 'biz-b');
  assert.deepEqual([rb.publishedStore, rb.storeNeedsRepublish], ['unknown', null]);
});

test('AMP-151: the probe is lazy: archiving works on a service built before the stores exist, and a lookup failure is "unknown"', async () => {
  const { products, rt, product } = setup();
  const a = await product('biz-a');
  rt.slugs.set('biz-a', 'store-a');
  rt.sites.listSites = async () => { throw new Error('boom'); };
  const r = await products.archiveProduct(pctx, a.id, 'biz-a');
  assert.deepEqual([r.publishedStore, r.storeNeedsRepublish], ['unknown', null]);
});
