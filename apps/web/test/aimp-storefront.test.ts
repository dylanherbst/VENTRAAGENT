import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { validateStoreConfig, type StoreConfig } from '../lib/aimp/storefront/schema.ts';
import { loadStore, purchaseState, isPolicyPage, formatPrice } from '../lib/aimp/storefront/load.ts';
import { isClaimableStoreSlug, storeRewritePath, storeSlugFromHost } from '../lib/aimp/storefront/tenant.ts';

const clone = (): StoreConfig => structuredClone(demoStore);
const errorsOf = (c: unknown) => { const r = validateStoreConfig(c); return r.ok ? [] : r.errors; };

test('demo store validates and loads; unknown stores do not', () => {
  assert.deepEqual(errorsOf(demoStore), []);
  assert.equal(loadStore('slow-morning')?.brand.name, 'Slow Morning Studio');
  assert.equal(loadStore('nope'), null);
});
test('validation rejects markup, bad slugs, duplicate products and bad prices', () => {
  const c = clone();
  c.hero.heading = '<script>alert(1)</script>';
  c.products[1].slug = c.products[0].slug;
  c.products[2].priceMinor = 50;
  c.slug = 'Bad Slug';
  const e = errorsOf(c);
  assert.ok(e.some((m) => m.startsWith('hero.heading')));
  assert.ok(e.some((m) => m.includes('duplicate')));
  assert.ok(e.some((m) => m.startsWith('products[2].priceMinor')));
  assert.ok(e.some((m) => m.startsWith('slug')));
});
test('bundles must reference real products and cost less than their items', () => {
  const c = clone();
  c.bundles[0].productSlugs = ['weekly-reset-planner', 'missing'];
  c.bundles[0].priceMinor = 99999;
  const e = errorsOf(c);
  assert.ok(e.some((m) => m.includes('unknown product missing')));
});
test('a demo store can never enable charges', () => {
  const c = clone(); c.merchant.chargesEnabled = true;
  assert.ok(errorsOf(c).some((m) => m.includes('demo stores can never take payment')));
});
test('unknown keys from AI output cannot inject sections or themes', () => {
  const c = clone() as unknown as Record<string, unknown>;
  (c.brand as Record<string, unknown>).theme = 'neon';
  (c.sections as unknown[])[5] = 'custom-html';
  const e = errorsOf(c);
  assert.ok(e.some((m) => m.startsWith('brand.theme')));
  assert.ok(e.some((m) => m.startsWith('sections[5]')));
});
test('buy button stays off unless checkout is built, merchant is live and store is real', () => {
  const live = clone(); live.demo = false; live.merchant.chargesEnabled = true;
  assert.equal(purchaseState(demoStore).canBuy, false);
  const notLive = clone(); notLive.demo = false;
  assert.equal(purchaseState(notLive).canBuy, false);
  assert.equal(purchaseState(live).canBuy, false);
  assert.equal(purchaseState(live, true).canBuy, true);
});
test('host resolution only accepts single claimable subdomains of the root', () => {
  const root = 'shops.example.com';
  assert.equal(storeSlugFromHost('slow-morning.shops.example.com', root), 'slow-morning');
  assert.equal(storeSlugFromHost('Slow-Morning.Shops.Example.com:3000', root), 'slow-morning');
  assert.equal(storeSlugFromHost('shops.example.com', root), null);
  assert.equal(storeSlugFromHost('www.shops.example.com', root), null);
  assert.equal(storeSlugFromHost('a.b.shops.example.com', root), null);
  assert.equal(storeSlugFromHost('evilshops.example.com', root), null);
  assert.equal(storeSlugFromHost('slow-morning.shops.example.com', undefined), null);
  assert.equal(isClaimableStoreSlug('ab'), false);
  assert.equal(isClaimableStoreSlug('a--b'), false);
  assert.equal(storeRewritePath('x-y', '/'), '/s/x-y');
  assert.equal(storeRewritePath('x-y', '/products/p'), '/s/x-y/products/p');
});
test('helpers', () => {
  assert.equal(formatPrice(900), '$9.00');
  assert.equal(isPolicyPage('refund'), true);
  assert.equal(isPolicyPage('toString'), false);
});
