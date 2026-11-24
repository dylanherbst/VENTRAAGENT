import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../lib/rate-limit.ts';

test('allows the limit, then blocks with a retry time, per key, and recovers after the window', () => {
  let t = 1_000_000;
  const check = createRateLimiter(3, 60_000, () => t);
  for (let i = 0; i < 3; i++) assert.equal(check('a').allowed, true);
  const blocked = check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(check('b').allowed, true, 'other users are unaffected');
  t += 30_000;
  assert.equal(check('a').allowed, false);
  assert.equal(check('a').retryAfterSeconds, 30);
  t += 30_001;
  assert.equal(check('a').allowed, true, 'window has passed');
});
