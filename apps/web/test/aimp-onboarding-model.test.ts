import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerText, nextStep, parseStepText, progress, setAnswer, toProfile, validateBudget, validateEffort,
  validateHours, validateInterests, validateSkills,
} from '../lib/aimp/onboarding/model.ts';
import { PROFILE_LIMITS, findOpportunities } from '../lib/aimp/opportunities/index.ts';
import type { Answers } from '../lib/aimp/onboarding/model.ts';

const full: Answers = { budgetMinor: 25_000, weeklyHours: 6, interests: ['Pets', 'Home decor'], skills: ['Writing'], effort: 'medium' };

test('budget validation gives plain errors', () => {
  assert.deepEqual(validateBudget(25_000), { ok: true, value: 25_000 });
  assert.deepEqual(validateBudget(0), { ok: true, value: 0 });
  for (const bad of [-1, 1.5, Number.NaN, '250', null, 10_000_001]) {
    const r = validateBudget(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /budget/i);
  }
});

test('limits match the Opportunity Finder', () => {
  assert.equal(validateBudget(PROFILE_LIMITS.budgetMinor.max).ok, true);
  assert.equal(validateBudget(PROFILE_LIMITS.budgetMinor.max + 1).ok, false);
  assert.equal(validateHours(PROFILE_LIMITS.weeklyHours.max).ok, true);
  assert.equal(validateHours(PROFILE_LIMITS.weeklyHours.max + 1).ok, false);
});

test('budget text converts dollars to minor units', () => {
  assert.deepEqual(parseStepText('budget', '250'), { ok: true, value: 25_000 });
  assert.deepEqual(parseStepText('budget', '$1,250.50'), { ok: true, value: 125_050 });
  assert.equal(parseStepText('budget', 'lots').ok, false);
  assert.equal(parseStepText('budget', '').ok, false);
  assert.equal(parseStepText('budget', '1.234').ok, false);
});

test('hours validation', () => {
  assert.equal(validateHours(1).ok, true);
  assert.equal(validateHours(40).ok, true);
  for (const bad of [0, 41, 2.5, '5', undefined]) assert.equal(validateHours(bad).ok, false);
  assert.equal(parseStepText('hours', '5').ok, true);
  assert.equal(parseStepText('hours', 'five').ok, false);
});

test('interests are required, trimmed, de-duplicated and capped', () => {
  assert.deepEqual(validateInterests([' Pets ', 'pets', 'Gardening']), { ok: true, value: ['Pets', 'Gardening'] });
  assert.equal(validateInterests([]).ok, false);
  assert.equal(validateInterests(['   ']).ok, false);
  assert.equal(validateInterests('pets').ok, false);
  assert.equal(validateInterests(['a']).ok, false);
  assert.equal(validateInterests(['ab']).ok, true);
  assert.equal(validateInterests(Array.from({ length: 11 }, (_, i) => `item${i}`)).ok, false);
  assert.equal(validateInterests(['x'.repeat(41)]).ok, false);
  assert.deepEqual(parseStepText('interests', 'pets, fitness\nbaking'), { ok: true, value: ['pets', 'fitness', 'baking'] });
});

test('skills may be empty', () => {
  assert.deepEqual(validateSkills([]), { ok: true, value: [] });
  assert.deepEqual(parseStepText('skills', ''), { ok: true, value: [] });
  assert.equal(validateSkills([1]).ok, false);
});

test('effort accepts only low, medium or high', () => {
  for (const e of ['low', 'medium', 'high']) assert.equal(validateEffort(e).ok, true);
  for (const bad of ['extreme', '', 3, undefined]) assert.equal(validateEffort(bad).ok, false);
});

test('progress and next step follow the step order', () => {
  assert.equal(nextStep({}), 'budget');
  assert.deepEqual(progress({}), { answered: 0, total: 5, percent: 0, next: 'budget', complete: false });
  const part = progress({ budgetMinor: 0, weeklyHours: 3 });
  assert.equal(part.answered, 2);
  assert.equal(part.next, 'interests');
  assert.equal(part.percent, 40);
  assert.equal(nextStep({ budgetMinor: 100, interests: ['a'] }), 'hours');
  assert.deepEqual(progress(full), { answered: 5, total: 5, percent: 100, next: null, complete: true });
  assert.equal(progress({ ...full, skills: [] }).complete, true);
});

test('setAnswer keeps old answers when the new value is invalid', () => {
  const r = setAnswer(full, 'hours', 99);
  assert.equal(r.answers, full);
  assert.match(r.error ?? '', /40/);
  assert.equal(setAnswer(full, 'hours', 10).answers.weeklyHours, 10);
});

test('answerText round-trips through parseStepText', () => {
  assert.equal(answerText(full, 'budget'), '250');
  assert.equal(answerText({ budgetMinor: 25_050 }, 'budget'), '250.50');
  assert.equal(answerText(full, 'interests'), 'Pets, Home decor');
  assert.equal(answerText({}, 'hours'), '');
});

test('toProfile produces the Opportunity Finder input', () => {
  const r = toProfile(full);
  assert.deepEqual(r, {
    ok: true,
    profile: { budgetMinor: 25_000, weeklyHours: 6, interests: ['Pets', 'Home decor'], skills: ['Writing'], preferredEffort: 'medium' },
  });
  if (r.ok) { r.profile.interests.push('x'); assert.equal(full.interests?.length, 2); }
});

test('a complete toProfile output is accepted by the Opportunity Finder', () => {
  const r = toProfile(full);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  let result: ReturnType<typeof findOpportunities> | undefined;
  assert.doesNotThrow(() => { result = findOpportunities(r.profile, { now: () => new Date('2026-11-14T00:00:00.000Z') }); });
  assert.ok(result && result.ideas.length > 0);
});

test('toProfile reports missing steps for partial answers', () => {
  assert.deepEqual(toProfile({ budgetMinor: 100, effort: 'low' }), { ok: false, missing: ['hours', 'interests', 'skills'] });
});
