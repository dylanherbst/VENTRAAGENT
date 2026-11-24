import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuide, isBusinessPath } from '../lib/aimp/home/path.ts';
import type { ChecklistStep } from '../lib/aimp/home/build.ts';

const B = '/app/b1';
const steps: ChecklistStep[] = [
  { label: 'Choose your idea', done: true, current: false, href: `${B}/offers` },
  { label: 'Save your brand', done: false, current: true, href: `${B}/brand` },
  { label: 'Approve your prices', done: false, current: false, href: `${B}/products` },
  { label: 'Payments', done: false, current: false, href: `${B}/payments` },
];

test('new path: guided, only done and next pages open, next step glows', () => {
  const g = buildGuide('new', steps, B);
  assert.equal(g.showFullMenu, false);
  assert.deepEqual(g.steps.map((s) => s.tone), ['done', 'next', 'later', 'later']);
  assert.equal(g.glowSegment, 'brand');
  assert.deepEqual(g.allowedSegments, ['', 'home', 'settings', 'offers', 'brand']);
  assert.equal(g.steps[2]?.locked, true);
  assert.equal(g.tones.next, 'accent-glow');
});

test('existing path: everything open, nothing locked, still marks the next step', () => {
  const g = buildGuide('existing', steps, B);
  assert.equal(g.showFullMenu, true);
  assert.equal(g.allowedSegments, 'all');
  assert.ok(g.steps.every((s) => !s.locked));
  assert.equal(g.glowSegment, 'brand');
});

test('all done: no glow; path values are validated', () => {
  const g = buildGuide('new', steps.map((s) => ({ ...s, done: true, current: false })), B);
  assert.equal(g.glowSegment, null);
  assert.ok(isBusinessPath('new') && isBusinessPath('existing') && !isBusinessPath('x') && !isBusinessPath(undefined));
});
