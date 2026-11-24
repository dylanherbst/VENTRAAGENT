import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationStatus } from '../lib/integration-status.ts';
import type { IntegrationEnv } from '../lib/integration-status.ts';

// Fixture values are assembled from a prefix plus filler so no key-shaped literal appears in the source.
const fake = (prefix: string, filler = 'zq') => prefix + filler.repeat(10);
const full: IntegrationEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://projref12345.zzhost.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fake('sb_publishable_', 'ab'),
  STRIPE_SECRET_KEY: fake('sk_test_', 'abcde'), STRIPE_WEBHOOK_SECRET: fake('whsec_', 'wx'), OPENAI_API_KEY: fake('sk-openai-', 'mn'), OPENAI_MODEL: 'model-name-xyz',
};
const get = (env: IntegrationEnv, id: string, probes = {}) => integrationStatus(env, probes).find(i => i.id === id)!;

test('supabase: verified only with vars and a successful probe', () => {
  assert.equal(get(full, 'supabase', { supabaseHealth: 'ok' }).state, 'verified');
  assert.equal(get(full, 'supabase', { supabaseHealth: 'failed' }).state, 'configured');
  assert.equal(get(full, 'supabase', { supabaseHealth: 'skipped' }).state, 'configured');
  assert.equal(get(full, 'supabase').state, 'configured');
});
test('supabase: missing or partial vars are not configured, even if probe says ok', () => {
  assert.equal(get({}, 'supabase', { supabaseHealth: 'ok' }).state, 'not-configured');
  assert.equal(get({ NEXT_PUBLIC_SUPABASE_URL: full.NEXT_PUBLIC_SUPABASE_URL }, 'supabase', { supabaseHealth: 'ok' }).state, 'not-configured');
  assert.equal(get({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }, 'supabase').state, 'not-configured');
  assert.equal(get({ ...full, NEXT_PUBLIC_SUPABASE_URL: '  ' }, 'supabase').state, 'not-configured');
});
test('stripe checkout: test key configured, never verified', () => {
  assert.equal(get(full, 'stripe-checkout').state, 'configured');
  assert.equal(get(full, 'stripe-checkout', { supabaseHealth: 'ok' }).state, 'configured');
  assert.equal(get({}, 'stripe-checkout').state, 'not-configured');
});
test('stripe checkout: live keys are blocked', () => {
  for (const k of [fake('sk_live_', 'abcde'), fake('rk_live_', 'abcde'), 'garbage']) {
    const i = get({ STRIPE_SECRET_KEY: k }, 'stripe-checkout');
    assert.equal(i.state, 'blocked');
    assert.match(i.detail, /refused|not a TEST/);
  }
});
test('stripe webhook: whsec_ pattern', () => {
  assert.equal(get(full, 'stripe-webhook').state, 'configured');
  assert.equal(get({}, 'stripe-webhook').state, 'not-configured');
  assert.equal(get({ STRIPE_WEBHOOK_SECRET: 'nope' }, 'stripe-webhook').state, 'blocked');
});
test('openai: needs both key and model, never verified', () => {
  assert.equal(get(full, 'openai').state, 'configured');
  assert.equal(get({ OPENAI_API_KEY: 'k' }, 'openai').state, 'not-configured');
  assert.equal(get({ OPENAI_MODEL: 'm' }, 'openai').state, 'not-configured');
  assert.equal(get({}, 'openai').state, 'not-configured');
  assert.ok(integrationStatus(full, { supabaseHealth: 'ok' }).filter(i => i.state === 'verified').every(i => i.id === 'supabase'));
});
test('result contains every id once and no secret value or fragment', () => {
  const variants: IntegrationEnv[] = [full, { ...full, STRIPE_SECRET_KEY: fake('sk_live_', 'lmnop') }, { ...full, STRIPE_WEBHOOK_SECRET: fake('bad', 'rs') }, { OPENAI_API_KEY: fake('only-', 'kv') }];
  for (const env of variants) for (const probe of ['ok', 'failed', 'skipped'] as const) {
    const items = integrationStatus(env, { supabaseHealth: probe });
    assert.deepEqual(items.map(i => i.id), ['supabase', 'stripe-checkout', 'stripe-webhook', 'openai']);
    const json = JSON.stringify(items);
    for (const v of Object.values(env)) {
      if (!v) continue;
      assert.ok(!json.includes(v), 'leaked a value');
      for (let n = 9; n + 6 <= v.length; n += 3) assert.ok(!json.includes(v.slice(n, n + 6)), 'leaked a fragment: ' + v.slice(n, n + 6));
    }
    assert.ok(!/https?:\/\//.test(json) && !/zzhost\.test/.test(json));
  }
});

import { statusRateKey, SIGN_IN_MESSAGE } from '../lib/status-access.ts';
import { createRateLimiter } from '../lib/rate-limit.ts';
test('status rate key is per user, else per first forwarded IP', () => {
  assert.equal(statusRateKey('u1', '1.2.3.4'), 'user:u1');
  assert.equal(statusRateKey(null, '1.2.3.4, 5.6.7.8'), 'ip:1.2.3.4');
  assert.equal(statusRateKey(undefined, null), 'ip:unknown');
  assert.match(SIGN_IN_MESSAGE, /^Sign in to see integration status$/);
});
test('one caller hitting the limit does not lock out another', () => {
  const check = createRateLimiter(2, 60_000);
  check(statusRateKey('abuser', null)); check(statusRateKey('abuser', null));
  assert.equal(check(statusRateKey('abuser', null)).allowed, false);
  assert.equal(check(statusRateKey('owner', null)).allowed, true);
});
