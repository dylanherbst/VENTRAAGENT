import test from 'node:test';
import assert from 'node:assert/strict';
import { saveContact } from '../lib/local-crm-contacts.ts';
import type { ContactInput } from '../lib/local-crm-contacts.ts';
import { blankRuleset, leadScoringStorageKey, persistRuleset, restoreRuleset, scoreAll, scoreContact, validateRuleset } from '../lib/local-lead-scoring.ts';

const P = 'p1';
const contact = (over: Partial<ContactInput> = {}, id = 'c1') =>
  saveContact({ name: 'Ada', email: '', phone: '', source: 'manual', consentStatus: 'unknown', notes: '', ...over }, { id, profileId: P });
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

test('default rules score and label by threshold', () => {
  const rs = blankRuleset(P);
  assert.equal(rs.rules.length, 4);
  const cold = scoreContact(contact(), rs);
  assert.deepEqual([cold.score, cold.label, cold.reasons.length], [0, 'cold', 0]);
  const warm = scoreContact(contact({ email: 'a@b.co', phone: '123', source: 'referral' }), rs);
  assert.deepEqual([warm.score, warm.label], [50, 'warm']);
  const hot = scoreContact(contact({ email: 'a@b.co', phone: '123', source: 'referral', consentStatus: 'opted_in' }), rs);
  assert.deepEqual([hot.score, hot.label], [80, 'hot']);
  assert.deepEqual(hot.reasons.map(r => r.ruleId), ['rule-consent', 'rule-referral', 'rule-email', 'rule-phone']);
});

test('thresholds are inclusive and reasons list only matched rules', () => {
  const rs = { ...blankRuleset(P), hotAt: 15, warmAt: 10 };
  assert.equal(scoreContact(contact({ email: 'a@b.co', consentStatus: 'opted_in' }), rs).label, 'hot');
  const s = scoreContact(contact({ phone: '123' }), rs);
  assert.deepEqual([s.score, s.label, s.reasons.length], [10, 'warm', 1]);
  assert.equal(s.reasons[0].ruleId, 'rule-phone');
});

test('contacts without opted_in consent are never hot', () => {
  const rs = { ...blankRuleset(P), hotAt: 20, warmAt: 5 };
  for (const consentStatus of ['unknown', 'pending', 'opted_out'] as const) {
    const s = scoreContact(contact({ consentStatus, email: 'a@b.co', phone: '123', source: 'referral' }), rs);
    assert.equal(s.label, 'warm');
    assert.equal(s.reasons.at(-1)?.ruleId, 'consent-cap');
    assert.equal(s.score, 50);
  }
});

test('negative points, notes matching and scoreAll', () => {
  const rs = validateRuleset({ ...blankRuleset(P), rules: [
    { id: 'a', field: 'noteContains', contains: 'QUOTE', points: 40 },
    { id: 'b', field: 'source', equals: 'other', points: -20 },
  ] });
  const all = scoreAll([contact({ notes: 'wants a quote', source: 'other' }, 'x'), contact({}, 'y')], rs);
  assert.deepEqual(all.map(s => [s.contactId, s.score, s.label]), [['x', 20, 'cold'], ['y', 0, 'cold']]);
});

test('validation limits', () => {
  const ok = blankRuleset(P);
  assert.doesNotThrow(() => validateRuleset(ok, P));
  assert.throws(() => validateRuleset(ok, 'other'));
  assert.throws(() => validateRuleset({ ...ok, warmAt: 60 }), /warm score/);
  assert.throws(() => validateRuleset({ ...ok, rules: Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, field: 'hasEmail', points: 1 })) }), /at most 20/);
  assert.doesNotThrow(() => validateRuleset({ ...ok, rules: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, field: 'hasEmail', points: 1 })) }));
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'hasEmail', points: 51 }] }), /points/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'hasEmail', points: -51 }] }), /points/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'hasEmail', points: 1.5 }] }), /points/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'noteContains', contains: 'x'.repeat(101), points: 1 }] }), /text/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'noteContains', contains: '  ', points: 1 }] }), /text/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'source', equals: 'nope', points: 1 }] }), /source/);
  assert.throws(() => validateRuleset({ ...ok, rules: [{ id: 'a', field: 'hasEmail', points: 1 }, { id: 'a', field: 'hasPhone', points: 1 }] }), /unique/);
});

test('restore never overwrites on invalid data; persist is compare-and-set', () => {
  assert.equal(restoreRuleset(null, P), null);
  assert.throws(() => restoreRuleset('{nope', P), /Nothing was overwritten/);
  assert.throws(() => restoreRuleset(JSON.stringify({ ...blankRuleset(P), warmAt: 99 }), P), /Nothing was overwritten/);
  assert.throws(() => restoreRuleset(JSON.stringify(blankRuleset('other')), P), /Nothing was overwritten/);
  const storage = memory();
  const raw1 = persistRuleset(storage, P, null, blankRuleset(P));
  assert.equal(storage.getItem(leadScoringStorageKey(P)), raw1);
  assert.equal(restoreRuleset(raw1, P)?.revision, 1);
  assert.throws(() => persistRuleset(storage, P, null, blankRuleset(P)), /another tab/);
  const raw2 = persistRuleset(storage, P, raw1, { ...blankRuleset(P), hotAt: 70 });
  assert.equal(restoreRuleset(raw2, P)?.revision, 2);
  assert.equal(restoreRuleset(raw2, P)?.hotAt, 70);
  assert.throws(() => persistRuleset(storage, P, raw2, { ...blankRuleset(P), warmAt: 100 }));
  assert.equal(storage.getItem(leadScoringStorageKey(P)), raw2);
  assert.equal(leadScoringStorageKey('x'), 'launchpad.lead-scoring.v1.x');
});
