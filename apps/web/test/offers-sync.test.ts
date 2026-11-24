import assert from 'node:assert/strict';
import test from 'node:test';
import { checkOffersRaw } from '../lib/offers-sync.ts';
import { packArray, unpackArray } from '../lib/launcher-drafts.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import { blankProfile } from '../lib/onboarding.ts';

const profile = { ...blankProfile(), name: 'Studio', audience: 'Clients', expertise: 'Design', industry: 'Design', goal: 'Launch' };
const offers = saveLocalOffer([], { ...blankOffer(profile), name: 'Design coaching', outcome: 'Create your first portfolio', price: '149.95', delivery: 'Four weekly online sessions' }, profile, 'o1');

test('valid offers pass and survive the account wrapper', () => {
  const raw = JSON.stringify(offers);
  checkOffersRaw(raw, profile);
  assert.equal(unpackArray(packArray(raw)), raw);
  checkOffersRaw('[]', profile);
});
test('invalid offers are rejected', () => {
  assert.throws(() => checkOffersRaw('{}', profile));
  assert.throws(() => checkOffersRaw('nope', profile));
  assert.throws(() => checkOffersRaw(JSON.stringify([{ ...offers[0], amountMinor: -1 }]), profile));
  assert.throws(() => checkOffersRaw(raw2(), { ...profile, id: 'other-business' }));
  function raw2() { return JSON.stringify(offers); }
});
