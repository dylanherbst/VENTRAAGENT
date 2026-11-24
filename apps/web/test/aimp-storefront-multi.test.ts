import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';
import { validateStoreConfig } from '../lib/aimp/storefront/schema.ts';
import { findProduct, loadStore, purchaseState } from '../lib/aimp/storefront/load.ts';
import { renderConfig } from '../lib/aimp/storefront/render-config.ts';

const A = demoStore.slug;
const B = demoStoreB.slug;

test('both stores validate and load by slug', () => {
  assert.notEqual(A, B);
  for (const s of [demoStore, demoStoreB]) assert.equal(validateStoreConfig(s).ok, true);
  assert.equal(loadStore(A)?.slug, A);
  assert.equal(loadStore(B)?.slug, B);
  assert.equal(loadStore('nope-store'), null);
});

test('both are demos that can never take payment', () => {
  for (const slug of [A, B]) {
    const s = loadStore(slug)!;
    assert.equal(s.demo, true);
    assert.equal(s.merchant.chargesEnabled, false);
    assert.equal(purchaseState(s, true).canBuy, false);
  }
  const bad = validateStoreConfig({ ...demoStoreB, merchant: { chargesEnabled: true } });
  assert.equal(bad.ok, false);
});

test('brand, theme and products differ between stores', () => {
  const a = loadStore(A)!;
  const b = loadStore(B)!;
  assert.notEqual(a.brand.name, b.brand.name);
  assert.notEqual(a.brand.theme, b.brand.theme);
  assert.notEqual(a.brand.font, b.brand.font);
  assert.notEqual(a.hero.heading, b.hero.heading);
  const slugsA = new Set(a.products.map((p) => p.slug));
  assert.equal(b.products.some((p) => slugsA.has(p.slug)), false);
  assert.notDeepEqual(a.products.map((p) => p.priceMinor), b.products.map((p) => p.priceMinor));
});

test('a product from store A does not resolve under store B', () => {
  const a = loadStore(A)!;
  const b = loadStore(B)!;
  const own = a.products[0].slug;
  assert.ok(findProduct(a, own));
  assert.equal(findProduct(b, own), undefined);
  assert.equal(findProduct(a, b.products[0].slug), undefined);
});

test('both go through the same render config function', () => {
  const ra = renderConfig(loadStore(A)!);
  const rb = renderConfig(loadStore(B)!);
  assert.deepEqual(Object.keys(ra.cssVars), Object.keys(rb.cssVars));
  assert.notEqual(ra.cssVars['--st-accent'], rb.cssVars['--st-accent']);
  assert.notEqual(ra.cssVars['--st-bg'], rb.cssVars['--st-bg']);
  assert.notEqual(ra.cssVars['--st-font'], rb.cssVars['--st-font']);
  assert.notEqual(ra.brandName, rb.brandName);
  assert.deepEqual(ra.robots, { index: false, follow: false });
  assert.deepEqual(rb.robots, { index: false, follow: false });
});
