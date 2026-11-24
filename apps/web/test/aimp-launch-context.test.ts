import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countries, describeContext, KNOWN_PEOPLE_MAX, loadContext, saveContext, validateContext } from '../lib/aimp/onboarding/context.ts';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';

const ok = { country: 'AU', language: 'en', timezone: 'Australia/Perth', knownPeople: '  a parents   group ' };

test('a complete context is accepted and trimmed', () => {
  const r = validateContext(ok);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.knownPeople, 'a parents group');
});

test('known people is optional; country, language and time zone are required and checked', () => {
  assert.ok(validateContext({ ...ok, knownPeople: '' }).ok);
  const bad = validateContext({ country: 'ZZ', language: 'xx', timezone: '', knownPeople: 'x'.repeat(KNOWN_PEOPLE_MAX + 1) });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['country', 'knownPeople', 'language', 'timezone']);
  assert.ok(!validateContext(null).ok);
});

test('only Australia can be offered live checkout at launch, and unsupported choices are said plainly', () => {
  assert.deepEqual(countries.filter((c) => c.sellingSupported).map((c) => c.code), ['AU']);
  const au = describeContext({ ...ok });
  assert.equal(au.liveCheckout, true);
  assert.equal(au.currency, 'AUD');
  assert.deepEqual(au.notes, []);
  const nz = describeContext({ ...ok, country: 'NZ', language: 'fr' });
  assert.equal(nz.liveCheckout, false);
  assert.equal(nz.generateInLanguage, false);
  assert.equal(nz.notes.length, 2);
});

test('save and load round-trip, and bad or missing storage returns null instead of throwing', () => {
  const data = new Map<string, string>();
  const backend = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.equal(loadContext(backend, 'k'), null);
  const r = validateContext(ok);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(saveContext(backend, 'k', r.value), true); assert.deepEqual(loadContext(backend, 'k'), r.value); }
  data.set([...data.keys()][0], '{not json');
  assert.equal(loadContext(backend, 'k'), null);
  if (r.ok) assert.equal(saveContext({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, 'k', r.value), false);
});

test('five ranked ideas each name where first buyers come from and what the owner still has to do', () => {
  const result = findOpportunities({ budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' }, { now: () => new Date('2026-11-15T00:00:00.000Z') });
  assert.equal(result.ideas.length, 5);
  result.ideas.forEach((idea, i) => {
    assert.equal(idea.rank, i + 1);
    assert.ok(idea.firstBuyerChannel.length > 0);
    assert.ok(idea.ownerWork.length > 0);
    assert.ok(idea.ownerWork.every((w) => w.action.length > 0 && w.hours >= 0));
    assert.ok(idea.estimatedStartupCostMinor >= 0);
  });
});
