import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, enablePathway, restoreProfile, serializeProfile } from '../lib/onboarding.ts';
import { blankOffer, editLocalOffer, formatOfferPrice, offerErrors, offerPriceMinor, offerStorageKey, restoreLocalOffers, saveLocalOffer } from '../lib/local-offers.ts';

const profile = { ...blankProfile(), name: 'Studio', audience: 'Clients', expertise: 'Design', industry: 'Design', goal: 'Launch' };
const draft = { ...blankOffer(profile), name: 'Design coaching', outcome: 'Create your first portfolio', price: '149.95', delivery: 'Four weekly online sessions' };
test('decimal prices are exact and invalid inputs do not become free offers', () => {
  assert.equal(offerPriceMinor('149.95'), 14995); assert.equal(offerPriceMinor('0'), 0); assert.equal(offerPriceMinor('1.2'), 120); assert.equal(offerPriceMinor('0.29'), 29);
  for (const raw of ['', ' ', '-1', '1.999', '1e2', 'NaN', '1,000', '900719925474099.99']) assert.throws(() => offerPriceMinor(raw));
});
test('saved prices display and edit exactly through the safe-integer minor-unit limit', () => {
  for (const price of ['0.00', '0.01', '0.99', '1.00', '149.95', '90071992547408.93', '90071992547409.91']) {
    const offers = saveLocalOffer([], { ...draft, price }, profile, 'exact-price');
    const restored = restoreLocalOffers(JSON.stringify(offers), profile);
    assert.ok(restored);
    assert.equal(formatOfferPrice(restored[0].amountMinor), price);
    assert.equal(editLocalOffer(restored[0]).price, price);
    assert.equal(offerPriceMinor(formatOfferPrice(restored[0].amountMinor)), restored[0].amountMinor);
  }
  for (const amount of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => formatOfferPrice(amount));
});
test('save, restore and edit an education offer associated with the profile without mutating inputs', () => {
  const before = JSON.stringify(profile);
  const offers = saveLocalOffer([], draft, profile, 'offer-1');
  assert.equal(offers[0].profileId, profile.id); assert.equal(offers[0].amountMinor, 14995);
  assert.deepEqual(restoreLocalOffers(JSON.stringify(offers), profile), offers);
  const edits = { ...editLocalOffer(offers[0]), name: 'Updated coaching', price: '299' };
  const updated = saveLocalOffer(offers, edits, profile, 'offer-1');
  assert.equal(updated.length, 1); assert.equal(updated[0].amountMinor, 29900);
  assert.equal(offers[0].name, draft.name); assert.equal(JSON.stringify(profile), before);
});
test('shared library allows services, products and education only for activated pathways', () => {
  assert.ok(offerErrors({ ...draft, kind: 'service' }, profile).some(x => x.includes('Activate')));
  const both = enablePathway(profile, 'business');
  let offers = saveLocalOffer([], draft, both, 'education');
  for (const kind of ['service', 'product'] as const) offers = saveLocalOffer(offers, { ...draft, kind }, both, kind);
  assert.equal(offers.length, 3); assert.deepEqual(restoreLocalOffers(JSON.stringify(offers), both), offers);
  assert.equal(offerStorageKey(profile.id), offerStorageKey(both.id));
});
test('required fields, currencies and delivery type are validated before saving', () => {
  for (const field of ['name', 'audience', 'outcome', 'delivery', 'price'] as const) assert.throws(() => saveLocalOffer([], { ...draft, [field]: ' ' }, profile, 'bad'));
  assert.throws(() => saveLocalOffer([], { ...draft, currency: 'JPY' as typeof draft.currency }, profile, 'bad'));
  assert.throws(() => saveLocalOffer([], { ...draft, kind: 'invalid' as typeof draft.kind }, profile, 'bad'));
  assert.throws(() => saveLocalOffer([], { ...draft, name: 'x'.repeat(161) }, profile, 'bad'));
});
test('corrupt storage, duplicate IDs and cross-profile offers cannot enter the local library', () => {
  const offers = saveLocalOffer([], draft, profile, 'one');
  assert.deepEqual(restoreLocalOffers(null, profile), []);
  for (const raw of ['{', 'null', '{}', JSON.stringify([...offers, ...offers]), JSON.stringify([{ ...offers[0], amountMinor: -1 }]), JSON.stringify([{ ...offers[0], version: 2 }]), JSON.stringify([{ ...offers[0], delivery: null }])]) assert.equal(restoreLocalOffers(raw, profile), null);
  assert.equal(restoreLocalOffers(JSON.stringify(offers), { ...profile, id: 'another-profile' }), null);
  assert.throws(() => saveLocalOffer(offers, draft, { ...profile, id: 'another-profile' }, 'one'), /profile/);
});
test('Services display rename remains compatible with existing business-key profiles, briefs and progress', () => {
  const legacy = { ...profile, primary: 'business' as const, pathways: ['business' as const], toolNotes: { crm: 'Saved brief' }, completed: ['business-understand'] };
  assert.deepEqual(restoreProfile(serializeProfile(legacy)), legacy);
  const service = { ...draft, kind: 'service' as const };
  const offers = saveLocalOffer([], service, legacy, 'service');
  const expanded = enablePathway(legacy, 'education');
  assert.deepEqual(restoreLocalOffers(JSON.stringify(offers), expanded), offers);
  assert.deepEqual(expanded.toolNotes, legacy.toolNotes); assert.deepEqual(expanded.completed, legacy.completed);
});
