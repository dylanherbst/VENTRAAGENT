import assert from 'node:assert/strict';
import test from 'node:test';
import { createStripe, encodeSession, keyMode, type SessionInput } from '../lib/aimp/payments/stripe.ts';
import type { FetchLike } from '../lib/aimp/social/ayrshare.ts';

const input: SessionInput = { amountCents: 1900, currency: 'aud', productName: 'Dinner Plan', successUrl: 'https://x.test/ok', cancelUrl: 'https://x.test/no', buyerEmail: 'a@b.co', orderId: 'ord_1', idempotencyKey: 'order:ord_1:start' };
const reply = (status: number, body: unknown) => ({ status, json: async () => body });
const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
const fake = (status: number, body: unknown): FetchLike => (async (url, init) => { calls.push({ url, init }); return reply(status, body); }) as FetchLike;

test('keys: only well-formed test/live keys are accepted', () => {
  assert.equal(keyMode('sk_test_abcdefgh12'), 'test');
  assert.equal(keyMode('sk_live_abcdefgh12'), 'live');
  assert.equal(keyMode('pk_test_abcdefgh12'), null);
  assert.equal(keyMode(''), null);
});

test('session body uses our price and order id, and refuses bad input', () => {
  const e = encodeSession(input); assert.ok(e.ok);
  if (e.ok) { assert.match(e.body, /unit_amount%5D=1900/); assert.match(e.body, /metadata%5BorderId%5D=ord_1/); assert.match(e.body, /mode=payment/); }
  assert.equal(encodeSession({ ...input, amountCents: 10 }).ok, false);
  assert.equal(encodeSession({ ...input, successUrl: 'http://x.test' }).ok, false);
  assert.equal(encodeSession({ ...input, idempotencyKey: 'x' }).ok, false);
});

test('createSession sends the idempotency key and returns the hosted url; failures charge nothing', async () => {
  calls.length = 0;
  const s = createStripe({ secretKey: 'sk_test_abcdefgh12', fetch: fake(200, { id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' }) });
  const r = await s.createSession(input);
  assert.deepEqual(r, { ok: true, sessionId: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' });
  assert.equal(calls[0]?.init.headers['idempotency-key'], 'order:ord_1:start');
  assert.equal(calls[0]?.url, 'https://api.stripe.com/v1/checkout/sessions');
  const failed = await createStripe({ secretKey: 'sk_test_abcdefgh12', fetch: fake(400, { error: {} }) }).createSession(input);
  assert.equal(failed.ok, false);
  const nokey = await createStripe({ secretKey: 'nope', fetch: fake(200, {}) }).createSession(input);
  assert.equal(nokey.ok, false);
});

test('verifyPaid needs paid status, matching amount, currency and order', async () => {
  const ok = { payment_status: 'paid', amount_total: 1900, currency: 'aud', client_reference_id: 'ord_1' };
  const exp = { amountCents: 1900, currency: 'aud', orderId: 'ord_1' };
  const v = (body: unknown) => createStripe({ secretKey: 'sk_test_abcdefgh12', fetch: fake(200, body) }).verifyPaid('cs_test_abc123', exp);
  assert.equal((await v(ok)).paid, true);
  assert.equal((await v({ ...ok, payment_status: 'unpaid' })).paid, false);
  assert.equal((await v({ ...ok, amount_total: 100 })).paid, false);
  assert.equal((await v({ ...ok, currency: 'usd' })).paid, false);
  assert.equal((await v({ ...ok, client_reference_id: 'ord_2' })).paid, false);
});
