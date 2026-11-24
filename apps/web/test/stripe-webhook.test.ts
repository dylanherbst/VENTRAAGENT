import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderLedger, orderFromEvent, signForTest, verifyStripeSignature } from '../lib/stripe-webhook.ts';

const SECRET = 'whsec_' + 'b'.repeat(32);
const now = 1_800_000_000;
const event = { id: 'evt_1', type: 'checkout.session.completed', created: now, livemode: false, data: { object: { id: 'cs_test_1', amount_total: 4900, currency: 'aud', payment_status: 'paid', customer_details: { email: 'a@example.test' } } } };
const raw = JSON.stringify(event);

test('accepts a correctly signed body and rejects tampering, wrong secret, stale timestamps and malformed headers', () => {
  const header = signForTest(raw, SECRET, now);
  assert.doesNotThrow(() => verifyStripeSignature(raw, header, SECRET, now));
  assert.throws(() => verifyStripeSignature(raw + ' ', header, SECRET, now), /does not match/);
  assert.throws(() => verifyStripeSignature(raw, signForTest(raw, 'whsec_' + 'c'.repeat(32), now), SECRET, now), /does not match/);
  assert.throws(() => verifyStripeSignature(raw, header, SECRET, now + 301), /window/);
  assert.throws(() => verifyStripeSignature(raw, 't=abc,v1=zz', SECRET, now), /Malformed/);
  assert.throws(() => verifyStripeSignature(raw, null, SECRET, now), /Missing/);
  assert.throws(() => verifyStripeSignature(raw, header, undefined, now), /not configured/);
});
test('maps a completed checkout to an order, ignores other events, refuses live-mode and malformed events', () => {
  assert.deepEqual(orderFromEvent(event), { eventId: 'evt_1', sessionId: 'cs_test_1', amountMinor: 4900, currency: 'AUD', paid: true, customerEmail: 'a@example.test', createdAt: new Date(now * 1000).toISOString() });
  assert.equal(orderFromEvent({ ...event, type: 'customer.created' }), null);
  assert.throws(() => orderFromEvent({ ...event, livemode: true }), /test mode only/);
  assert.throws(() => orderFromEvent({ ...event, data: { object: { id: 'x' } } }), /Invalid checkout session/);
  assert.equal(orderFromEvent({ ...event, data: { object: { ...event.data.object, payment_status: 'unpaid' } } })?.paid, false);
});
test('the same event id is recorded once (Stripe retries)', () => {
  const ledger = createOrderLedger();
  const order = orderFromEvent(event)!;
  assert.equal(ledger.record(order).duplicate, false);
  assert.equal(ledger.record(order).duplicate, true);
  assert.equal(ledger.list().length, 1);
});
