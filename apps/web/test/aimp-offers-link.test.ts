import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoCatalogue, seedApprovedBrand, DEMO_BUSINESS, DEMO_WORKSPACE } from '../lib/aimp/catalogue/demo.ts';
import { buildOffers, draftContent, specFromOffer, type OfferAnswers } from '../lib/aimp/offers/build.ts';
import { linkToCatalogue } from '../lib/aimp/offers/link.ts';

const answers: OfferAnswers = { knows: 'meal planning for busy families', helps: 'busy parents', problem: 'dinner stress on weeknights' };
const spec = () => { const r = buildOffers(answers); if (!r.ok) throw new Error('x'); return specFromOffer(r.offers[0]!, answers, draftContent(answers)); };
const deps = (d: ReturnType<typeof createDemoCatalogue>) => ({ products: d.products, catalogue: d.catalogue, assets: d.assets, workspaceId: DEMO_WORKSPACE, actorId: 'demo-owner' });
const ctx = { workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS, actorUserId: 'demo-owner', idempotencyKey: 'k' };

test('without a brand the product is saved and the result says what is missing', async () => {
  const d = createDemoCatalogue(() => new Date('2026-11-22T00:00:00Z'), {});
  const r = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 1900, version: 1, previous: null });
  assert.equal(r.state, "needs_brand");
  assert.ok(r.linked?.productId);
  assert.equal((await d.catalogue.listApprovedForBusiness(ctx, DEMO_BUSINESS)).length, 0);
});

test('with a brand the listing goes live at the seller price, and a retry changes nothing', async () => {
  const d = createDemoCatalogue(() => new Date('2026-11-22T00:00:00Z'), {});
  await seedApprovedBrand(d, ctx, DEMO_BUSINESS, 'Dinner Plan');
  const r = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 1900, version: 1, previous: null });
  assert.equal(r.state, 'live');
  const live = await d.catalogue.listApprovedForBusiness(ctx, DEMO_BUSINESS);
  assert.equal(live.length, 1);
  assert.equal(live[0]?.priceMinor, 1900);
  const again = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 1900, version: 1, previous: r.linked });
  assert.equal(again.state, 'live');
  assert.equal((await d.catalogue.listApprovedForBusiness(ctx, DEMO_BUSINESS)).length, 1);
  const repriced = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 2400, version: 1, previous: r.linked });
  assert.equal(repriced.state, 'live');
  assert.equal((await d.catalogue.listApprovedForBusiness(ctx, DEMO_BUSINESS))[0]?.priceMinor, 2400);
});

test('a brand approved later completes the link without a second product', async () => {
  const d = createDemoCatalogue(() => new Date('2026-11-22T00:00:00Z'), {});
  const first = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 1900, version: 1, previous: null });
  await seedApprovedBrand(d, ctx, DEMO_BUSINESS, 'Dinner Plan');
  const second = await linkToCatalogue(deps(d), { businessId: DEMO_BUSINESS, spec: spec(), priceMinor: 1900, version: 1, previous: first.linked });
  assert.equal(second.state, 'live');
  assert.equal(second.linked?.productId, first.linked?.productId);
});
