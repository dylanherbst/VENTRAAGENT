import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOffers, draftContent, specFromOffer, type OfferAnswers } from '../lib/aimp/offers/build.ts';
import { emptyOfferState, type OfferState } from '../lib/aimp/offers/store.ts';
import { buildShopPage } from '../lib/aimp/shop/page.ts';

const answers: OfferAnswers = { knows: 'meal planning for busy families', helps: 'busy parents', problem: 'dinner stress on weeknights' };
function approved(): OfferState {
  const r = buildOffers(answers); if (!r.ok) throw new Error('offers');
  const offer = r.offers[0]!; const content = draftContent(answers);
  const spec = specFromOffer(offer, answers, content, () => new Date('2026-11-21T00:00:00Z'));
  return { answers, offerId: offer.id, content, approved: { spec, approvedAt: '2026-11-21T00:00:00Z', priceMinor: 1900, version: 1 }, linked: null };
}

test('no shop until a product is approved', () => {
  assert.equal(buildShopPage(emptyOfferState(), 'b1', { paymentsLive: false }), null);
});

test('shop page uses only the seller words and real facts; buy is honest about payments', () => {
  const off = buildShopPage(approved(), 'b1', { paymentsLive: false })!;
  assert.match(off.forWho, /busy parents/);
  assert.match(off.pitch, /dinner stress on weeknights/);
  assert.ok(off.whatYouGet.length > 0);
  assert.equal(off.priceLabel, '$19');
  assert.equal(off.sampleHref, '/api/aimp/shop/b1/sample');
  assert.equal(off.buy.live, false);
  assert.match(off.buy.note, /not switched on/);
  assert.doesNotMatch(JSON.stringify(off), /guarantee|rated|reviews|\d+,?\d* (customers|sold)/i);
  const on = buildShopPage(approved(), 'b1', { paymentsLive: true })!;
  assert.equal(on.buy.live, true);
  assert.match(on.afterBuying, /emailed to you/);
});
