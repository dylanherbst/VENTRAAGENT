import assert from 'node:assert/strict';
import test from 'node:test';
import { nextStep } from '../lib/aimp/onboarding/model.ts';
import type { Answers } from '../lib/aimp/onboarding/model.ts';
import { DEMO_DRAFT_KEY, DRAFT_VERSION, draftKey, createLocalStorageStore, createMemoryBackend, createMemoryStore, parseDraft, storageName } from '../lib/aimp/onboarding/store.ts';

const KEY = 'user-1:workspace-1';
const clock = () => new Date('2026-11-14T01:02:03.000Z');
const full: Answers = { budgetMinor: 25_000, weeklyHours: 6, interests: ['Pets'], skills: [], effort: 'high' };

test('save then a new store instance resumes identical answers and step', () => {
  const backing = createMemoryBackend();
  const first = createMemoryStore(backing, clock);
  const saved = first.save(KEY, 'skills', { budgetMinor: 25_000, weeklyHours: 6, interests: ['Pets', 'Dogs'] });
  assert.deepEqual(saved, { ok: true, updatedAt: '2026-11-14T01:02:03.000Z', message: 'Saved' });
  const second = createMemoryStore(backing);
  const r = second.load(KEY);
  assert.equal(r.status, 'ok');
  assert.equal(r.step, 'skills');
  assert.deepEqual(r.answers, { budgetMinor: 25_000, weeklyHours: 6, interests: ['Pets', 'Dogs'] });
  assert.equal(r.updatedAt, '2026-11-14T01:02:03.000Z');
  assert.deepEqual(r.needsReentry, []);
  const stored = JSON.parse(backing.data.get(storageName(KEY)) as string);
  assert.equal(stored.version, DRAFT_VERSION);
  assert.equal(stored.key, KEY);
});

test('drafts are kept per user/workspace key', () => {
  const backing = createMemoryBackend();
  const store = createMemoryStore(backing);
  store.save('a:w1', 'hours', { budgetMinor: 100 });
  store.save('b:w1', 'interests', { budgetMinor: 900, weeklyHours: 2 });
  assert.equal(store.load('a:w1').answers.budgetMinor, 100);
  assert.equal(store.load('b:w1').answers.budgetMinor, 900);
  assert.equal(store.load('c:w1').status, 'empty');
});

test('a complete draft resumes at review', () => {
  const store = createMemoryStore();
  store.save(KEY, 'review', full);
  const r = store.load(KEY);
  assert.equal(r.step, 'review');
  assert.deepEqual(r.answers, full);
});

test('partial answers are kept and resume never skips an unanswered step', () => {
  const backing = createMemoryBackend();
  createMemoryStore(backing).save(KEY, 'review', { budgetMinor: 5_000 });
  const r = createMemoryStore(backing).load(KEY);
  assert.deepEqual(r.answers, { budgetMinor: 5_000 });
  assert.equal(r.step, 'hours');
  assert.equal(nextStep(r.answers), 'hours');
});

test('clear removes the draft', () => {
  const store = createMemoryStore();
  store.save(KEY, 'hours', { budgetMinor: 1 });
  store.clear(KEY);
  assert.equal(store.load(KEY).status, 'empty');
});

test('unparseable JSON is handled safely', () => {
  for (const raw of ['{not json', '', 'null', '[]', '42', '"text"']) {
    const backing = createMemoryBackend({ [storageName(KEY)]: raw });
    const r = createMemoryStore(backing).load(KEY);
    assert.equal(r.status, 'corrupt', raw);
    assert.deepEqual(r.answers, {});
    assert.equal(r.step, 'budget');
    assert.equal(r.needsReentry.length, 5);
    assert.ok(r.message.length > 0);
  }
});

test('a draft with some bad fields keeps the valid ones and lists the rest', () => {
  const raw = JSON.stringify({
    version: DRAFT_VERSION, key: KEY, step: 'effort', updatedAt: 'not a date',
    answers: { budgetMinor: 25_000, weeklyHours: 'lots', interests: ['Pets'], skills: 'x', effort: 'extreme' },
  });
  const r = createMemoryStore(createMemoryBackend({ [storageName(KEY)]: raw })).load(KEY);
  assert.equal(r.status, 'corrupt');
  assert.deepEqual(r.answers, { budgetMinor: 25_000, interests: ['Pets'] });
  assert.deepEqual(r.needsReentry, ['hours', 'skills', 'effort']);
  assert.equal(r.step, 'hours');
  assert.equal(r.updatedAt, null);
});

test('an old schema version keeps valid answers and flags the version', () => {
  const raw = JSON.stringify({ version: 0, key: KEY, step: 'skills', updatedAt: '2026-01-01T00:00:00.000Z', answers: { budgetMinor: 1000, weeklyHours: 99, interests: ['Pets'] } });
  const r = createMemoryStore(createMemoryBackend({ [storageName(KEY)]: raw })).load(KEY);
  assert.equal(r.status, 'old-version');
  assert.deepEqual(r.answers, { budgetMinor: 1000, interests: ['Pets'] });
  assert.deepEqual(r.needsReentry, ['hours']);
  assert.equal(r.step, 'hours');
});

test('an old draft stored under the previous version name is found', () => {
  const old = JSON.stringify({ version: 0, key: KEY, step: 'hours', answers: { budgetMinor: 700 } });
  const r = createMemoryStore(createMemoryBackend({ [`aimp:onboarding:v0:${KEY}`]: old })).load(KEY);
  assert.equal(r.status, 'old-version');
  assert.deepEqual(r.answers, { budgetMinor: 700 });
});

test('a draft saved for a different key is not used', () => {
  const raw = JSON.stringify({ version: DRAFT_VERSION, key: 'someone-else', step: 'hours', answers: { budgetMinor: 1 } });
  const r = parseDraft(raw, KEY);
  assert.deepEqual(r.answers, {});
});

test('draftKey keeps ("a:b","c") and ("a","b:c") apart', () => {
  assert.notEqual(draftKey('a:b', 'c'), draftKey('a', 'b:c'));
  const store = createMemoryStore();
  store.save(draftKey('a:b', 'c'), 'hours', { budgetMinor: 1 });
  assert.equal(store.load(draftKey('a', 'b:c')).status, 'empty');
  assert.equal(store.load(draftKey('a:b', 'c')).answers.budgetMinor, 1);
  assert.equal(DEMO_DRAFT_KEY, 'demo-user:demo-workspace');
});

test('draftKey rejects empty parts', () => {
  assert.throws(() => draftKey('', 'w'));
  assert.throws(() => draftKey('u', ''));
  assert.throws(() => draftKey('  ', 'w'));
});

test('a draft with no key is treated as not owned', () => {
  const raw = JSON.stringify({ version: DRAFT_VERSION, step: 'hours', answers: { budgetMinor: 1 } });
  const r = createMemoryStore(createMemoryBackend({ [storageName(KEY)]: raw })).load(KEY);
  assert.deepEqual(r.answers, {});
  assert.equal(r.status, 'corrupt');
});

test('storage that throws never throws out of the store', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  };
  const store = createMemoryStore(broken);
  const saved = store.save(KEY, 'hours', { budgetMinor: 1 });
  assert.equal(saved.ok, false);
  assert.equal(store.load(KEY).status, 'unavailable');
  assert.doesNotThrow(() => store.clear(KEY));
});

test('localStorage store falls back to memory when localStorage is missing', () => {
  const store = createLocalStorageStore();
  assert.equal(store.save(KEY, 'hours', { budgetMinor: 1 }).ok, true);
  assert.equal(store.load(KEY).answers.budgetMinor, 1);
});
