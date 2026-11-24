import test from 'node:test';
import assert from 'node:assert/strict';
import { blankAnswers, calculate, defaultAssumptions, opportunityKey, rangeText, restoreSavedAudit, validateAnswers, validateAssumptions } from '../lib/growth-opportunity.ts';

const gym = { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day' as const, bookingPct: 40, averageValue: 50, noShowPct: 20 };

test('the calculation follows the blueprint formula and shows its basis', () => {
  const r = calculate(gym);
  const missed = r.findings.find(f => f.id === 'missed')!;
  // 30 missed × 20–50% recoverable × 40% booking = 2.4–6 bookings; × $50
  assert.deepEqual(missed.bookings, { low: 2, high: 6 });
  assert.deepEqual(missed.value, { low: 120, high: 300 });
  const speed = r.findings.find(f => f.id === 'speed')!;
  // 70 answered × 40% = 28 bookings × 10–25% lift = 2.8–7
  assert.deepEqual(speed.bookings, { low: 3, high: 7 });
  const noShow = r.findings.find(f => f.id === 'no-show')!;
  // 28 bookings × 20% no-show = 5.6 × 20–40% = 1.12–2.24
  assert.deepEqual(noShow.bookings, { low: 1, high: 2 });
  assert.equal(r.findings[0].id, 'speed', 'largest opportunity first');
  assert.ok(r.total.value.low <= r.total.value.high);
  assert.ok(r.basis.some(b => b.includes('not a promise')));
  assert.ok(r.findings.every(f => f.href.startsWith('/') && !f.href.startsWith('/tools')));
});

test('fast repliers get no speed finding; zero inputs produce no invented findings', () => {
  assert.equal(calculate({ ...gym, replySpeed: 'minutes' }).findings.some(f => f.id === 'speed'), false);
  const none = calculate({ ...blankAnswers, enquiriesPerMonth: 50 });
  assert.equal(none.findings.length, 0);
  assert.deepEqual(none.total.value, { low: 0, high: 0 });
});

test('assumptions are owner-adjustable and validated', () => {
  const wide = calculate(gym, { ...defaultAssumptions, recoverLow: 0, recoverHigh: 1 });
  assert.deepEqual(wide.findings.find(f => f.id === 'missed')!.bookings, { low: 0, high: 12 });
  assert.equal(validateAssumptions({ ...defaultAssumptions, recoverLow: 0.6, recoverHigh: 0.5 }).length, 1);
  assert.equal(validateAssumptions(defaultAssumptions).length, 0);
});

test('answers are validated with plain-language fixes', () => {
  assert.equal(validateAnswers(gym).length, 0);
  assert.ok(validateAnswers({ ...gym, enquiriesPerMonth: 0 })[0].includes('normal month'));
  assert.ok(validateAnswers({ ...gym, missedPct: 140 }).length);
  assert.equal(rangeText({ low: 3, high: 3 }), '3');
  assert.equal(rangeText({ low: 1, high: 2 }), '1–2');
});

test('saved progress restores only well-formed records', () => {
  const saved = { version: 1, step: 3, answers: gym, assumptions: defaultAssumptions, updatedAt: '2026-11-09T00:00:00Z' };
  assert.deepEqual(restoreSavedAudit(JSON.stringify(saved)), saved);
  for (const bad of ['nope', JSON.stringify({ ...saved, step: 9 }), JSON.stringify({ ...saved, answers: { ...gym, replySpeed: 'never' } }), JSON.stringify({ ...saved, assumptions: { ...defaultAssumptions, recoverLow: 0.9 } })]) assert.equal(restoreSavedAudit(bad), null);
  assert.equal(restoreSavedAudit(null), null);
  assert.ok(opportunityKey.startsWith('ventra.'));
});
