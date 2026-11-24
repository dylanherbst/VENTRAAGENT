import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import { editProposal, persistProposal, proposalFromPackage, proposalStorageKey, proposalTotal, restoreProposals, saveProposal } from '../lib/service-proposals.ts';
const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const offer = saveLocalOffer([], { ...blankOffer(profile), name: 'Design sprint', outcome: 'A clear identity', delivery: 'Three workshops', price: '0.29' }, profile, 'package-1')[0];
const input = { ...proposalFromPackage(offer), recipient: 'Client', email: 'client@example.test', terms: 'Timing subject to agreement' };
const identity = { id: 'draft-1', profileId: profile.id, packageId: offer.id, packageName: offer.name };
const proposal = saveProposal(input, identity);
const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
test('service package snapshot survives later package edits and proposal edit/restore preserves exact prices', () => {
  assert.throws(() => proposalFromPackage({ ...offer, kind: 'education' }));
  const before = JSON.stringify(offer);
  const edited = saveProposal({ ...editProposal(proposal), title: 'Updated', items: [{ description: 'Sprint', quantity: '3', price: '0.29' }, { description: 'Extra', quantity: '2', price: '1.01' }] }, identity);
  assert.equal(proposalTotal(edited.items), 289);
  assert.deepEqual(restoreProposals(JSON.stringify([edited]), profile.id), [edited]);
  assert.equal(JSON.stringify(offer), before);
  offer.name = 'Changed package'; offer.amountMinor = 99999;
  assert.equal(proposal.packageName, 'Design sprint'); assert.equal(proposal.items[0].amountMinor, 29);
  assert.equal(editProposal(proposal).items[0].price, '0.29');
});
test('quantity, precision, overflow, bounded fields and currency validation reject invalid totals', () => {
  for (const quantity of ['0', '-1', '1.5', '1e2', '1001', '10000', '', ' 1']) assert.throws(() => saveProposal({ ...input, items: [{ description: 'Item', quantity, price: '1' }] }, identity));
  for (const price of ['-1', '1.001', '1e2', 'Infinity', '', '90071992547409.92']) assert.throws(() => saveProposal({ ...input, items: [{ description: 'Item', quantity: '1', price }] }, identity));
  assert.throws(() => saveProposal({ ...input, items: [{ description: 'Item', quantity: '2', price: '90071992547409.91' }] }, identity), /total/);
  assert.throws(() => proposalTotal([{ description: 'a', quantity: 1, amountMinor: Number.MAX_SAFE_INTEGER }, { description: 'b', quantity: 1, amountMinor: 1 }]), /total/);
  for (const field of ['title', 'recipient', 'scope', 'terms'] as const) {
    assert.throws(() => saveProposal({ ...input, [field]: ' ' }, identity));
    assert.throws(() => saveProposal({ ...input, [field]: 'x'.repeat(7001) }, identity));
  }
  assert.throws(() => saveProposal({ ...input, email: 'a@bad' }, identity));
  assert.throws(() => saveProposal({ ...input, currency: 'JPY' as typeof input.currency }, identity));
  assert.throws(() => saveProposal({ ...input, items: [] }, identity));
  assert.throws(() => saveProposal({ ...input, items: Array(21).fill(input.items[0]) }, identity));
  assert.equal(proposalTotal(saveProposal({ ...input, email: '', items: [{ description: 'Free', quantity: '1000', price: '0' }] }, identity).items), 0);
});
test('untrusted and corrupt storage fails closed; known fields only and profile consistency', () => {
  assert.deepEqual(restoreProposals(null, profile.id), []);
  for (const raw of ['{', 'null', '{}', JSON.stringify([null]), JSON.stringify([{ ...proposal, profileId: 'other' }]), JSON.stringify([{ ...proposal, items: [{ description: 'x', quantity: 1, amountMinor: -1 }] }]), JSON.stringify([proposal, proposal]), JSON.stringify([proposal, { ...proposal, id: ' draft-1 ' }]), ' '.repeat(256001)]) assert.throws(() => restoreProposals(raw, profile.id));
  const sanitized = restoreProposals(JSON.stringify([{ ...proposal, admin: true, items: [{ ...proposal.items[0], secret: 'not persisted' }] }]), profile.id)[0];
  assert.equal('admin' in sanitized, false); assert.equal('secret' in sanitized.items[0], false);
  assert.throws(() => restoreProposals(JSON.stringify(Array(101).fill(proposal)), profile.id));
});
test('explicit save replaces same ID without duplicate and stale/corrupt/quota failures preserve storage', () => {
  const storage = fakeStorage(); const key = proposalStorageKey(profile.id);
  const raw = persistProposal(storage, profile.id, null, proposal);
  const next = persistProposal(storage, profile.id, raw, { ...proposal, title: 'Edited' });
  assert.equal(restoreProposals(next, profile.id).length, 1);
  assert.throws(() => persistProposal(storage, profile.id, raw, proposal), /another tab/);
  assert.equal(storage.getItem(key), next);
  assert.throws(() => persistProposal(storage, 'another-profile', null, proposal));
  storage.setItem(key, '{');
  assert.throws(() => persistProposal(storage, profile.id, '{', proposal)); assert.equal(storage.getItem(key), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistProposal(quota, profile.id, null, proposal), /Quota/);
});
