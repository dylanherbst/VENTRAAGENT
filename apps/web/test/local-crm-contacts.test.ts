import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import {
  blankContactInput,
  contactStorageKey,
  editContact,
  filterContacts,
  persistContact,
  restoreContacts,
  saveContact,
} from '../lib/local-crm-contacts.ts';

const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const identity = { id: 'contact-1', profileId: profile.id };
const input = { ...blankContactInput(), name: 'Alex Client', email: 'alex@example.test', phone: '+61 400 000 000', source: 'website' as const, consentStatus: 'opted_in' as const };
const contact = saveContact(input, identity);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('save, edit, filter and restore contacts with bounded fields', () => {
  assert.throws(() => saveContact({ ...input, name: ' ' }, identity));
  assert.throws(() => saveContact({ ...input, email: 'bad' }, identity));
  assert.throws(() => saveContact({ ...input, phone: 'call<script>' }, identity));
  assert.throws(() => saveContact({ ...input, source: 'ads' as typeof input.source }, identity));
  const saved = saveContact({ ...input, email: '' }, identity);
  assert.equal(saved.email, '');
  assert.deepEqual(restoreContacts(JSON.stringify([saved]), profile.id), [saved]);
  assert.equal(editContact(saved).name, 'Alex Client');
  assert.equal(filterContacts([saved], 'alex client')[0].id, saved.id);
  assert.equal(filterContacts([saved], 'missing').length, 0);
});

test('untrusted and corrupt storage fails closed without mutating corrupt payloads', () => {
  assert.deepEqual(restoreContacts(null, profile.id), []);
  for (const raw of ['{', 'null', '{}', JSON.stringify([null]), JSON.stringify([{ ...contact, profileId: 'other' }]), JSON.stringify([contact, contact]), ' '.repeat(256001)]) {
    assert.throws(() => restoreContacts(raw, profile.id));
  }
  const sanitized = restoreContacts(JSON.stringify([{ ...contact, admin: true }]), profile.id)[0];
  assert.equal('admin' in sanitized, false);
});

test('restore preserves stored updatedAt and saving another contact leaves others unchanged', () => {
  const storage = fakeStorage();
  const staleAt = '2000-01-01T00:00:00.000Z';
  const identityA = { id: 'contact-a', profileId: profile.id };
  const identityB = { id: 'contact-b', profileId: profile.id };
  const storedA = { ...saveContact({ ...input, name: 'Alex Client' }, identityA), updatedAt: staleAt };
  const rawA = JSON.stringify([storedA]);
  const restoredA = restoreContacts(rawA, profile.id)[0];
  assert.equal(restoredA.updatedAt, staleAt);
  assert.equal(restoreContacts(JSON.stringify([restoredA]), profile.id)[0].updatedAt, staleAt);
  const contactB = saveContact({ ...input, name: 'Beth Client', email: 'beth@example.test' }, identityB);
  assert.notEqual(contactB.updatedAt, staleAt);
  storage.setItem(contactStorageKey(profile.id), rawA);
  const rawBoth = persistContact(storage, profile.id, rawA, contactB);
  const all = restoreContacts(rawBoth, profile.id);
  assert.equal(all.find(item => item.id === identityA.id)?.updatedAt, staleAt);
  assert.throws(() => restoreContacts(JSON.stringify([{ ...contact, updatedAt: { bad: true } }]), profile.id));
});

test('explicit save replaces same ID and stale or quota failures preserve storage', () => {
  const storage = fakeStorage();
  const key = contactStorageKey(profile.id);
  const raw = persistContact(storage, profile.id, null, contact);
  const next = persistContact(storage, profile.id, raw, { ...contact, name: 'Alex Updated' });
  assert.equal(restoreContacts(next, profile.id).length, 1);
  assert.throws(() => persistContact(storage, profile.id, raw, contact), /another tab/);
  assert.equal(storage.getItem(key), next);
  storage.setItem(key, '{');
  assert.throws(() => persistContact(storage, profile.id, '{', contact));
  assert.equal(storage.getItem(key), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistContact(quota, profile.id, null, contact), /Quota/);
});
