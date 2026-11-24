import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTestKey, checkoutBody, createTestCheckout } from '../lib/stripe-checkout.ts';
import type { CheckoutRequest } from '../lib/stripe-checkout.ts';

const req: CheckoutRequest = { name: 'Lash Basics', amountMinor: 4900, currency: 'AUD', successUrl: 'http://127.0.0.1:3000/ok', cancelUrl: 'http://127.0.0.1:3000/no' };
const TEST_KEY = 'sk_test_' + 'a'.repeat(24);

test('only test keys are accepted; live and missing keys are refused before any network call', () => {
  assert.equal(assertTestKey(TEST_KEY), TEST_KEY);
  for (const bad of ['sk_live_' + 'a'.repeat(24), 'rk_live_' + 'a'.repeat(24), 'pk_test_' + 'a'.repeat(24), 'nonsense', '']) assert.throws(() => assertTestKey(bad));
  assert.throws(() => assertTestKey(undefined), /not configured/);
});
test('builds the exact Stripe form body from the offer', () => {
  const p = new URLSearchParams(checkoutBody(req));
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'aud');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '4900');
  assert.equal(p.get('line_items[0][price_data][product_data][name]'), 'Lash Basics');
});
test('rejects invalid amount, name, currency and non-http addresses', () => {
  assert.throws(() => checkoutBody({ ...req, amountMinor: 10 }), /Price/);
  assert.throws(() => checkoutBody({ ...req, amountMinor: 12.5 }), /Price/);
  assert.throws(() => checkoutBody({ ...req, name: ' ' }), /Offer name/);
  assert.throws(() => checkoutBody({ ...req, currency: 'XXX' as never }), /currency/);
  assert.throws(() => checkoutBody({ ...req, successUrl: 'javascript:alert(1)' }), /Success address/);
});
test('returns a TEST session, sends the key only as a bearer header, and refuses live-mode or failed responses', async () => {
  let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
  const ok = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => { seen = { url, headers: init.headers, body: init.body }; return { ok: true, status: 200, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', livemode: false }) }; };
  const result = await createTestCheckout(req, TEST_KEY, ok);
  assert.deepEqual(result, { mode: 'TEST', sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  assert.equal(seen!.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(seen!.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.ok(!seen!.body.includes(TEST_KEY), 'key is never in the body');
  const live = async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_live_1', url: 'https://x', livemode: true }) });
  await assert.rejects(createTestCheckout(req, TEST_KEY, live), /test mode only/);
  const fail = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'secret detail' } }) });
  await assert.rejects(createTestCheckout(req, TEST_KEY, fail), (e: Error) => !e.message.includes('secret detail'));
  let called = false;
  await assert.rejects(createTestCheckout(req, 'sk_live_' + 'a'.repeat(24), async () => { called = true; throw new Error('x'); }));
  assert.equal(called, false, 'no network call with a live key');
});
