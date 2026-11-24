import assert from 'node:assert/strict';
import test from 'node:test';
import { clampStep, progressLabel, stepDots, stepState } from '../app/design-system/aimp-glass/steps.ts';

test('progress is announced as "Step N of M"', () => {
  assert.equal(progressLabel(2, 3), 'Step 2 of 3');
  assert.equal(progressLabel(1, 3), 'Step 1 of 3');
  assert.equal(progressLabel(3, 3), 'Step 3 of 3');
});

test('out-of-range steps are clamped rather than announced wrongly', () => {
  assert.deepEqual(clampStep(0, 3), { current: 1, total: 3 });
  assert.deepEqual(clampStep(9, 3), { current: 3, total: 3 });
  assert.deepEqual(clampStep(2.9, 3.9), { current: 2, total: 3 });
  assert.deepEqual(clampStep(Number.NaN, 0), { current: 1, total: 1 });
  assert.equal(progressLabel(7, 3), 'Step 3 of 3');
  assert.equal(progressLabel(-1, 3), 'Step 1 of 3');
});

test('each dot knows whether it is done, current or upcoming', () => {
  assert.equal(stepState(1, 2), 'done');
  assert.equal(stepState(2, 2), 'current');
  assert.equal(stepState(3, 2), 'upcoming');
  const dots = stepDots(2, 3);
  assert.deepEqual(dots.map((d) => d.state), ['done', 'current', 'upcoming']);
  assert.deepEqual(dots.map((d) => d.label), ['Step 1, done', 'Step 2, current step', 'Step 3, not started']);
  assert.equal(dots.filter((d) => d.state === 'current').length, 1);
});

test('there is exactly one current dot for any input', () => {
  for (const total of [1, 2, 3, 5]) {
    for (const current of [-2, 0, 1, 2, 3, 5, 99]) {
      const dots = stepDots(current, total);
      assert.equal(dots.length, total);
      assert.equal(dots.filter((d) => d.state === 'current').length, 1);
    }
  }
});
