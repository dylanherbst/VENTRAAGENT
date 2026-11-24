// Where AI Team appears in the two-path guide, and the Overview data that carries the AI Team posts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withAiTeam } from '../app/app/[business]/_server/ai-team-guide.ts';
import { buildGuide } from '../lib/aimp/home/path.ts';

const steps = (cur: string) => ['idea', 'brand', 'product', 'catalogue', 'store', 'payments', 'first_order'].map((id) => ({ id, label: id, done: false, current: false, href: `/app/b/${id === 'first_order' ? 'marketing' : id === 'store' ? 'website' : id}` }));
const guide = (doneUpTo: string, cur: string) => {
  const list = steps(cur); const idx = list.findIndex((s) => s.id === doneUpTo);
  list.forEach((s, i) => { s.done = i <= idx; s.current = s.id === cur; });
  return buildGuide('new', list, '/app/b');
};
const base = { base: '/app/b', productDone: false, storeLive: false, currentId: 'product', posted: false };

test('a new seller does not see AI Team before their first product is approved', () => {
  const g = guide('brand', 'product');
  const out = withAiTeam(g, base);
  assert.equal(out, g);
  assert.ok(!(out.allowedSegments as string[]).includes('ai-team'));
});

test('after the product it is open but dim, and does not steal the glow', () => {
  const g = guide('product', 'catalogue');
  const out = withAiTeam(g, { ...base, productDone: true, currentId: 'catalogue' });
  const at = out.steps.find((s) => s.segment === 'ai-team')!;
  assert.equal(at.tone, 'later'); assert.equal(at.locked, false);
  assert.ok((out.allowedSegments as string[]).includes('ai-team'));
  assert.equal(out.glowSegment, g.glowSegment);
  assert.equal(out.steps.filter((s) => s.tone === 'next').length, 1);
});

test('with the shop live and the first order next, the glow moves to AI Team, and only one step glows', () => {
  const g = guide('payments', 'first_order');
  const out = withAiTeam(g, { ...base, productDone: true, storeLive: true, currentId: 'first_order' });
  assert.equal(out.glowSegment, 'ai-team');
  assert.deepEqual(out.steps.filter((s) => s.tone === 'next').map((s) => s.segment), ['ai-team']);
  assert.equal(out.steps.find((s) => s.segment === 'marketing')!.locked, false);
});

test('once a post is approved, AI Team is done and the glow goes back to the checklist', () => {
  const g = guide('payments', 'first_order');
  const out = withAiTeam(g, { ...base, productDone: true, storeLive: true, currentId: 'first_order', posted: true });
  assert.equal(out.steps.find((s) => s.segment === 'ai-team')!.tone, 'done');
  assert.equal(out.glowSegment, g.glowSegment);
});

test('existing sellers are never changed', () => {
  const g = buildGuide('existing', steps('x'), '/app/b');
  assert.equal(withAiTeam(g, { ...base, productDone: true }), g);
});
