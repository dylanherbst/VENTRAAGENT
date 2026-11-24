import test from 'node:test';
import assert from 'node:assert/strict';
import { blankFunnel, blankStep, emptySnapshot, funnelLimit, funnelsStorageKey, moveStep, persistFunnels, readWorkspaceSnapshot, removeFunnel, resolveLinks, restoreFunnels, saveFunnel, stepLimit, validateFunnel } from '../lib/local-funnels.ts';
import type { Funnel } from '../lib/local-funnels.ts';

const P = 'p1';
const good = (id = 'f1'): Funnel => ({ id, name: 'Launch', goal: 'Sell', status: 'draft', steps: [
  { id: 's1', kind: 'traffic', title: 'Ads', note: '' },
  { id: 's2', kind: 'lead-form', title: 'Form', note: '', linkedRef: { type: 'lead-form', id: 'lf1' } },
  { id: 's3', kind: 'thank-you', title: 'Thanks', note: '' }] });
const mem = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; } }; };

test('validation limits', () => {
  assert.deepEqual(validateFunnel(good()).problems, []);
  assert.ok(validateFunnel({ ...good(), name: ' ' }).problems.length);
  assert.ok(validateFunnel({ ...good(), name: 'x'.repeat(121) }).problems.length);
  assert.ok(validateFunnel({ ...good(), goal: 'x'.repeat(501) }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: [] }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: Array.from({ length: stepLimit + 1 }, (_, i) => ({ ...blankStep(`s${i}`), title: 't' })) }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: [{ ...blankStep('a'), title: '' }] }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: [{ ...blankStep('a'), title: 't', note: 'x'.repeat(501) }] }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: [{ ...blankStep('a'), title: 't' }, { ...blankStep('a'), title: 't' }] }).problems.length);
  assert.ok(validateFunnel({ ...good(), steps: [{ ...blankStep('a', 'offer'), title: 't', linkedRef: { type: 'page', id: 'x' } }] }).problems.length, 'link must match step type');
  assert.ok(validateFunnel({ ...good(), status: 'x' as never }).problems.length);
});

test('warnings do not block', () => {
  const f: Funnel = { ...good(), steps: [{ ...blankStep('a', 'email'), title: 'Mail' }] };
  const c = validateFunnel(f);
  assert.equal(c.problems.length, 0);
  assert.equal(c.warnings.length, 2);
  assert.match(c.warnings[0], /no lead form/);
  assert.match(c.warnings[1], /thank-you/);
  assert.equal(validateFunnel(good(), { ...emptySnapshot(), 'lead-form': [{ id: 'lf1', label: 'L' }] }).warnings.length, 0);
  assert.match(validateFunnel(good(), emptySnapshot()).warnings[0], /no longer exists/);
  assert.equal(saveFunnel([], f).length, 1);
});

test('link resolution: found, missing, unreadable, unlinked', () => {
  const snap = { ...emptySnapshot(), 'lead-form': [{ id: 'lf1', label: 'Newsletter form' }] };
  const r = resolveLinks(good(), snap);
  assert.deepEqual(r[0], { linked: false, found: false, label: '' });
  assert.deepEqual(r[1], { linked: true, found: true, label: 'Newsletter form' });
  assert.equal(resolveLinks(good(), emptySnapshot())[1].found, false);
  const un = resolveLinks(good(), { ...emptySnapshot(), 'lead-form': null })[1];
  assert.equal(un.found, false);
  assert.match(un.label, /could not be read/);
});

test('readWorkspaceSnapshot is read-only and tolerates missing or bad data', () => {
  const s = mem({
    [`launchpad.email-campaigns.v1.${P}`]: JSON.stringify([{ id: 'e1', name: 'Welcome', kind: 'one-off', audienceNote: '', status: 'draft', steps: [{ id: 'x', subject: 's', body: 'b', waitDays: 0 }] }]),
    [`launchpad.offers.v1.${P}`]: JSON.stringify([{ id: 'o1', name: 'Coaching' }, null, { id: 3 }]),
    [`launchpad.lead-form-draft.v1.${P}`]: 'not json',
    [`launchpad.website-page-draft.v1.${P}`]: '{"version":1,"profileId":"other"}',
  });
  const before = { ...s.d };
  const snap = readWorkspaceSnapshot(s, P);
  assert.deepEqual(snap['email-campaign'], [{ id: 'e1', label: 'Welcome' }]);
  assert.deepEqual(snap.offer, [{ id: 'o1', label: 'Coaching' }]);
  assert.equal(snap['lead-form'], null);
  assert.equal(snap.page, null);
  assert.deepEqual(snap.storefront, []);
  assert.deepEqual(s.d, before);
  const throwing = { getItem: () => { throw new Error('denied'); } };
  assert.equal(readWorkspaceSnapshot(throwing, P).offer, null);
});

test('moveStep reorders immutably and ignores edges', () => {
  const f = good();
  const m = moveStep(f, 's1', 1);
  assert.deepEqual(m.steps.map(s => s.id), ['s2', 's1', 's3']);
  assert.deepEqual(f.steps.map(s => s.id), ['s1', 's2', 's3']);
  assert.equal(moveStep(f, 's1', -1), f);
  assert.equal(moveStep(f, 's3', 1), f);
  assert.equal(moveStep(f, 'nope', 1), f);
});

test('save and remove are immutable; caps enforced', () => {
  const a = saveFunnel([], good('a'));
  const b = saveFunnel(a, { ...good('a'), name: 'Renamed ' });
  assert.equal(b.length, 1);
  assert.equal(b[0].name, 'Renamed');
  assert.equal(a[0].name, 'Launch');
  assert.deepEqual(removeFunnel(b, 'a'), []);
  assert.throws(() => saveFunnel([], { ...good(), name: '' }));
  const full = Array.from({ length: funnelLimit }, (_, i) => good(`f${i}`));
  assert.throws(() => saveFunnel(full, good('extra')), /up to 20/);
  assert.equal(saveFunnel(full, { ...good('f0'), name: 'ok' }).length, funnelLimit);
  assert.equal(blankFunnel('x').steps.length, 1);
});

test('restore throws on invalid and persist is compare-and-set', () => {
  assert.deepEqual(restoreFunnels(null, P), []);
  assert.throws(() => restoreFunnels('nope', P), /Nothing was overwritten/);
  assert.throws(() => restoreFunnels('{}', P));
  assert.throws(() => restoreFunnels(JSON.stringify([{ ...good(), name: '' }]), P));
  assert.throws(() => restoreFunnels(JSON.stringify([good('d'), good('d')]), P), /Duplicate/);
  assert.throws(() => restoreFunnels(JSON.stringify(Array.from({ length: funnelLimit + 1 }, (_, i) => good(`f${i}`))), P));
  assert.throws(() => restoreFunnels('[]', ''));
  const s = mem();
  const raw = persistFunnels(s, P, null, [good()]);
  assert.equal(s.d[funnelsStorageKey(P)], raw);
  assert.deepEqual(restoreFunnels(raw, P), [good()]);
  assert.throws(() => persistFunnels(s, P, null, [good('z')]), /another tab/);
  s.d[funnelsStorageKey(P)] = 'tampered';
  assert.throws(() => persistFunnels(s, P, raw, [good()]), /another tab/);
  assert.equal(s.d[funnelsStorageKey(P)], 'tampered');
  assert.throws(() => persistFunnels(mem(), P, null, [{ ...good(), name: '' }]));
});
