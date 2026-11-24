import test from 'node:test';
import assert from 'node:assert/strict';
import { W, call, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';
// These suites cover the route logic behind the scope freeze; test/scope-freeze.test.ts covers the freeze itself.
process.env.VENTRA_SCOPE_FREEZE = 'off';
import { clientKey, workspaceLimits } from '../lib/rate-limit.ts';

const team = (await import('../app/api/workspace/team/route.ts')).GET;
const exp = (await import('../app/api/workspace/export/route.ts')).GET;
const search = (await import('../app/api/workspace/search/route.ts')).GET;
const activity = (await import('../app/api/workspace/activity/route.ts')).GET;
const launcher = (await import('../app/api/workspace/launcher/route.ts')).GET;
const checkout = (await import('../app/api/checkout/route.ts')).POST;

const cases = [
  ['team', team, `/api/workspace/team?workspace=${W}`, 60],
  ['export', exp, `/api/workspace/export?workspace=${W}`, 10],
  ['search', search, `/api/workspace/search?workspace=${W}&q=hello`, 60],
  ['activity', activity, `/api/workspace/activity?workspace=${W}`, 60],
  ['launcher', launcher, `/api/workspace/launcher?workspace=${W}&kind=business-plan`, 240],
] as const;

for (const [name, handler, url, limit] of cases) {
  test(`${name}: 429 with Retry-After once the per-user limit is used, normal use is not limited`, async () => {
    const restore = setEnv(configuredEnv); const fake = installFakeSupabase({ tables: { memberships: [], launcher_drafts: [] } });
    try {
      let last = await call(handler, url);
      assert.notEqual(last.status, 429, 'first request is allowed');
      for (let i = 1; i < limit; i++) last = await call(handler, url);
      assert.notEqual(last.status, 429, `${limit} requests in a window are allowed`);
      last = await call(handler, url);
      assert.equal(last.status, 429);
      assert.ok(Number(last.headers.get('retry-after')) >= 1);
      assert.match(last.headers.get('cache-control') ?? '', /no-store/);
    } finally { fake.restore(); restore(); }
  });
}
test('the limiters are separate per route', () => {
  assert.notEqual(workspaceLimits.team, workspaceLimits.search);
});
test('clientKey uses the first forwarded address, bounded, with a fallback', () => {
  assert.equal(clientKey('1.2.3.4, 5.6.7.8'), 'ip:1.2.3.4');
  assert.equal(clientKey(null), 'ip:unknown');
  assert.equal(clientKey('x'.repeat(200)).length, 'ip:'.length + 64);
});
test('checkout: limit is per client, not one global bucket', async () => {
  const saved = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const post = (ip: string) => checkout(makeRequest('/api/checkout', { method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name: 'x', amountMinor: 1, currency: 'zzz' }) })).then(r => r.status);
  try {
    for (let i = 0; i < 10; i++) assert.equal(await post('9.9.9.9'), 400, 'invalid currency is rejected before Stripe');
    assert.equal(await post('9.9.9.9'), 429);
    assert.equal(await post('8.8.8.8'), 400, 'another client is unaffected');
  } finally { if (saved === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved; }
});
