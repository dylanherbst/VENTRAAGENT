import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { saveContact, blankContactInput, contactStorageKey } from '../lib/local-crm-contacts.ts';
import {
  blankDealInput,
  contactExistsInList,
  contactNameForDeal,
  dealStorageKey,
  missingContactSelectLabel,
  dealsByStage,
  editDeal,
  filterDeals,
  persistDeal,
  restoreDeals,
  saveDeal,
} from '../lib/local-crm-pipeline.ts';

const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const contact = saveContact({ ...blankContactInput(), name: 'Alex Client' }, { id: 'contact-1', profileId: profile.id });
const identity = { id: 'deal-1', profileId: profile.id };
const input = { ...blankDealInput(contact.id), title: 'Website refresh', stage: 'qualified' as const, value: '1500.00' };
const deal = saveDeal(input, identity);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('save, edit, filter and restore deals with bounded fields', () => {
  assert.throws(() => saveDeal({ ...input, title: ' ' }, identity));
  assert.throws(() => saveDeal({ ...input, contactId: '' }, identity));
  assert.throws(() => saveDeal({ ...input, value: '1.234' }, identity));
  assert.throws(() => saveDeal({ ...input, stage: 'closed' as typeof input.stage }, identity));
  const noValue = saveDeal({ ...input, value: '' }, identity);
  assert.equal(noValue.valueMinor, null);
  assert.deepEqual(restoreDeals(JSON.stringify([deal]), profile.id), [deal]);
  assert.equal(editDeal(deal).title, 'Website refresh');
  assert.equal(filterDeals([deal], [contact], 'website')[0].id, deal.id);
  assert.equal(filterDeals([deal], [contact], 'missing').length, 0);
  assert.equal(contactNameForDeal([contact], contact.id), 'Alex Client');
  assert.equal(contactNameForDeal([], contact.id), null);
  const grouped = dealsByStage([deal, { ...deal, id: 'deal-2', stage: 'new' }]);
  assert.equal(grouped.qualified.length, 1);
  assert.equal(grouped.new.length, 1);
});

test('untrusted and corrupt storage fails closed without mutating corrupt payloads', () => {
  assert.deepEqual(restoreDeals(null, profile.id), []);
  for (const raw of ['{', 'null', '{}', JSON.stringify([null]), JSON.stringify([{ ...deal, profileId: 'other' }]), JSON.stringify([deal, deal]), ' '.repeat(256001)]) {
    assert.throws(() => restoreDeals(raw, profile.id));
  }
  const sanitized = restoreDeals(JSON.stringify([{ ...deal, admin: true }]), profile.id)[0];
  assert.equal('admin' in sanitized, false);
});

test('restore preserves stored updatedAt and saving another deal leaves others unchanged', () => {
  const storage = fakeStorage();
  const staleAt = '2000-01-01T00:00:00.000Z';
  const identityA = { id: 'deal-a', profileId: profile.id };
  const identityB = { id: 'deal-b', profileId: profile.id };
  const storedA = { ...saveDeal({ ...input, title: 'Deal A' }, identityA), updatedAt: staleAt };
  const rawA = JSON.stringify([storedA]);
  const restoredA = restoreDeals(rawA, profile.id)[0];
  assert.equal(restoredA.updatedAt, staleAt);
  const dealB = saveDeal({ ...input, title: 'Deal B', contactId: contact.id }, identityB);
  assert.notEqual(dealB.updatedAt, staleAt);
  storage.setItem(dealStorageKey(profile.id), rawA);
  const rawBoth = persistDeal(storage, profile.id, rawA, dealB);
  const all = restoreDeals(rawBoth, profile.id);
  assert.equal(all.find(item => item.id === identityA.id)?.updatedAt, staleAt);
  assert.throws(() => restoreDeals(JSON.stringify([{ ...deal, updatedAt: { bad: true } }]), profile.id));
});

test('explicit save replaces same ID and stale or quota failures preserve storage', () => {
  const storage = fakeStorage();
  const key = dealStorageKey(profile.id);
  const raw = persistDeal(storage, profile.id, null, deal);
  const next = persistDeal(storage, profile.id, raw, { ...deal, title: 'Updated title' });
  assert.equal(restoreDeals(next, profile.id).length, 1);
  assert.throws(() => persistDeal(storage, profile.id, raw, deal), /another tab/);
  assert.equal(storage.getItem(key), next);
  storage.setItem(key, '{');
  assert.throws(() => persistDeal(storage, profile.id, '{', deal));
  assert.equal(storage.getItem(key), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistDeal(quota, profile.id, null, deal), /Quota/);
});

test('deals can reference contacts not present in the contact list', () => {
  const orphan = saveDeal({ ...input, contactId: 'removed-contact' }, { id: 'deal-x', profileId: profile.id });
  assert.equal(contactNameForDeal([contact], orphan.contactId), null);
  assert.equal(contactExistsInList([contact], orphan.contactId), false);
  assert.equal(contactExistsInList([contact], contact.id), true);
  assert.match(missingContactSelectLabel(orphan.contactId), /removed-contact/);
  assert.match(missingContactSelectLabel(orphan.contactId), /keep saved ID/);
  const reSaved = saveDeal(editDeal(orphan), { id: orphan.id, profileId: profile.id });
  assert.equal(reSaved.contactId, 'removed-contact');
  assert.deepEqual(restoreDeals(JSON.stringify([orphan]), profile.id), [orphan]);
  assert.equal(contactStorageKey(profile.id).includes(profile.id), true);
});
