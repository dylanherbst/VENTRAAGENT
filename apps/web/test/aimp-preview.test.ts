import assert from 'node:assert/strict';
import test from 'node:test';
import { businessModels } from '../lib/aimp/contracts.ts';
import { validateStoreConfig } from '../lib/aimp/storefront/schema.ts';
import { blueprints, findNiche } from '../lib/aimp/preview/blueprints.ts';
import { budgetOptions, hoursOptions, interestOptions, recommend } from '../lib/aimp/preview/recommend.ts';
import { cardFeeMinor, generatePreview, previewLabel, slugify } from '../lib/aimp/preview/generate.ts';

const allCombos = () => blueprints.flatMap((b) => b.niches.map((n) => ({ model: b.id, niche: n.id })));

test('there is one blueprint per MVP business model, each with 3-4 niches', () => {
  assert.deepEqual(blueprints.map((b) => b.id), [...businessModels]);
  for (const b of blueprints) {
    assert.ok(b.niches.length >= 3 && b.niches.length <= 4, `${b.id} niche count`);
    assert.equal(b.primaryChannel, 'Pinterest');
    assert.equal(new Set(b.niches.map((n) => n.id)).size, b.niches.length, `${b.id} niche ids unique`);
  }
});

test('niche data respects authoring limits', () => {
  for (const b of blueprints) for (const n of b.niches) {
    const at = `${b.id}/${n.id}`;
    assert.ok(n.names.length >= 3 && n.names.length <= 4, `${at} names`);
    assert.ok(n.products.length >= 4 && n.products.length <= 6, `${at} products`);
    assert.equal(n.pins.length, 3, `${at} pins`);
    for (const p of n.products) {
      assert.ok(p.cover.label.length <= 28, `${at}/${p.slug} cover label`);
      assert.ok(p.includes.length >= 1, `${at}/${p.slug} includes`);
    }
    for (const pin of n.pins) {
      assert.ok(pin.title.length <= 100, `${at} pin title`);
      assert.ok(n.products.some((p) => p.slug === pin.productSlug), `${at} pin product`);
    }
  }
});

test('every model × niche × name generates a store config that passes validateStoreConfig', () => {
  for (const { model, niche } of allCombos()) {
    const names = findNiche(model, niche)!.names.length;
    for (let seed = 0; seed < names; seed++) {
      const preview = generatePreview({ model, niche, seed });
      const result = validateStoreConfig(preview.store);
      assert.deepEqual(result.ok ? [] : result.errors, [], `${model}/${niche}/${seed}`);
      assert.equal(preview.store.status, 'draft');
      assert.equal(preview.store.demo, true);
      assert.equal(preview.store.merchant.chargesEnabled, false);
      assert.equal(preview.store.brand.theme, 'pearl');
      assert.ok(['serif', 'sans'].includes(preview.store.brand.font));
      assert.equal(preview.marketing.pins.length, 3);
      assert.equal(preview.label, previewLabel);
    }
  }
});

test('no product or bundle price is below 100 cents and bundles always save money', () => {
  for (const { model, niche } of allCombos()) {
    const preview = generatePreview({ model, niche });
    for (const p of preview.products) assert.ok(p.priceMinor >= 100, `${model}/${niche}/${p.slug}`);
    assert.ok(preview.bundle.priceMinor >= 100);
    assert.ok(preview.bundle.savingMinor > 0, `${model}/${niche} bundle saving`);
    assert.ok(preview.pricing.lowMinor <= preview.pricing.launchPriceMinor && preview.pricing.launchPriceMinor <= preview.pricing.highMinor);
    assert.match(preview.pricing.feeNote, /1\.65% \+ 30c/);
  }
});

test('generation is deterministic and the seed rotates the brand name', () => {
  const a = generatePreview({ model: 'digital-templates', niche: 'wedding-planning', seed: 1 });
  const b = generatePreview({ model: 'digital-templates', niche: 'wedding-planning', seed: 1 });
  assert.deepEqual(a, b);
  const c = generatePreview({ model: 'digital-templates', niche: 'wedding-planning', seed: 2 });
  assert.notEqual(a.brand.name, c.brand.name);
  assert.equal(generatePreview({ model: 'digital-templates', niche: 'wedding-planning', seed: -3 }).seed, 0);
  assert.throws(() => generatePreview({ model: 'digital-templates', niche: 'nope' }));
});

test('recommend() is deterministic and always returns a valid model and niche', () => {
  for (const budget of budgetOptions) for (const hours of hoursOptions) for (const interest of interestOptions) {
    const r = recommend({ budget, hours, interest });
    assert.deepEqual(recommend({ budget, hours, interest }), r);
    assert.ok(businessModels.includes(r.model));
    assert.ok(findNiche(r.model, r.niche), `${r.model}/${r.niche}`);
    assert.ok(r.reason.length > 20 && r.reason.endsWith('.'));
  }
});

test('helpers: slugs and card fees', () => {
  assert.equal(slugify('Vow & Ledger'), 'vow-ledger');
  assert.equal(slugify('Chair & Caption'), 'chair-caption');
  assert.equal(cardFeeMinor(1000), 47);
});
