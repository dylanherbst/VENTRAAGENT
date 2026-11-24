import assert from 'node:assert/strict';
import test from 'node:test';
import { computeToday, localDraftKinds, UNREADABLE } from '../lib/today-view.ts';
import type { TodayInput } from '../lib/today-view.ts';
import { blankProfile, buildPlan } from '../lib/onboarding.ts';
import { blankFollowUps, addFollowUp } from '../lib/local-lead-followups.ts';
import { localDraftKeys } from '../lib/draft-registry.ts';

const profile = { ...blankProfile(), audience: 'Locals', expertise: 'Baking', completed: [] as string[] };
const base: TodayInput = { todayIso: '2026-11-04', profile: null, followups: null, contacts: null, localKinds: [], accountKinds: null };
const list = (...tasks: { id: string; dueOn?: string; title?: string }[]) => tasks.reduce((l, t) => addFollowUp(l, { id: t.id, contactId: 'c1', title: t.title ?? 'Call', dueOn: t.dueOn }), blankFollowUps('p'));

test('nothing saved gives an empty view', () => {
  assert.deepEqual(computeToday(base), { items: [], accountChecked: false });
});
test('overdue and due-today follow-ups appear, future and done ones do not', () => {
  const l = list({ id: 'a', dueOn: '2026-11-01' }, { id: 'b', dueOn: '2026-11-04' }, { id: 'c', dueOn: '2026-11-09' }, { id: 'd' }, { id: 'e', dueOn: '2026-10-01' });
  l.tasks[4].done = true;
  const v = computeToday({ ...base, followups: l, contacts: [{ id: 'c1', name: 'Ann' } as never] });
  assert.deepEqual(v.items.map(i => i.id), ['followup-a', 'followup-b']);
  assert.match(v.items[0].text, /Overdue follow-up: Call \(Ann\), due 2026-11-01/);
  assert.match(v.items[1].text, /due today/);
});
test('only unfinished launch plan steps are listed', () => {
  const steps = buildPlan(profile);
  assert.ok(steps.length > 0);
  const done = { ...profile, completed: [steps[0].id] };
  const v = computeToday({ ...base, profile: done });
  assert.equal(v.items.length, steps.length - 1);
  assert.ok(!v.items.some(i => i.id === `step-${steps[0].id}`));
  assert.equal(computeToday({ ...base, profile: { ...profile, completed: steps.map(s => s.id) } }).items.length, 0);
});
test('drafts not in the account are listed only when the account was checked', () => {
  assert.deepEqual(computeToday({ ...base, localKinds: ['storefront'], accountKinds: null }).items, []);
  const v = computeToday({ ...base, localKinds: ['storefront', 'funnels'], accountKinds: ['funnels'] });
  assert.equal(v.accountChecked, true);
  assert.deepEqual(v.items.map(i => i.id), ['account-storefront']);
  assert.match(v.items[0].text, /Storefront is saved only in this browser/);
  assert.equal(computeToday({ ...base, localKinds: ['funnels'], accountKinds: ['funnels'] }).items.length, 0);
});
test('unreadable parts give one notice each and are not treated as empty', () => {
  const v = computeToday({ ...base, followups: UNREADABLE, localKinds: UNREADABLE, accountKinds: [] });
  assert.deepEqual(v.items.map(i => i.id).sort(), ['drafts-unreadable', 'followups-unreadable']);
});
test('items are ordered: overdue, today, checklist, account, unreadable', () => {
  const v = computeToday({ ...base, profile, followups: list({ id: 'a', dueOn: '2026-11-04' }, { id: 'b', dueOn: '2026-10-01' }), localKinds: ['funnels'], accountKinds: [] });
  const kinds = v.items.map(i => i.kind);
  assert.equal(kinds[0], 'followup-overdue'); assert.equal(kinds[1], 'followup-today');
  assert.equal(kinds[kinds.length - 1], 'not-in-account');
});
test('localDraftKinds reports saved stores and fails closed on a storage error', () => {
  const store: Record<string, string> = { a: '{"x":1}', b: '[]', c: '' };
  const kinds = [{ kind: 'k1', key: 'a' }, { kind: 'k2', key: 'b' }, { kind: 'k3', key: 'c' }, { kind: 'k4', key: 'zz' }];
  assert.deepEqual(localDraftKinds(k => store[k] ?? null, kinds), ['k1']);
  assert.equal(localDraftKinds(() => { throw new Error('denied'); }, kinds), UNREADABLE);
});
test('registry keys are per business and include the known drafts', () => {
  const keys = localDraftKeys('p1');
  assert.ok(keys.some(k => k.kind === 'crm-contacts' && k.key.endsWith('.p1')));
  assert.equal(new Set(keys.map(k => k.key)).size, keys.length);
});
