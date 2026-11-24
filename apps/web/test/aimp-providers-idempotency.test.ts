import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureAdapters } from '../lib/aimp/providers/fixtures.ts';

test('email.send: same key returns the first result and sends once; a new key or no key sends again', async () => {
  const { email } = createFixtureAdapters();
  const input = { to: 'a@example.invalid', subject: 's', text: 't' };
  const a = await email.send({ ...input, idempotencyKey: 'k1' });
  const b = await email.send({ ...input, idempotencyKey: 'k1' });
  assert.deepEqual(b, a);
  assert.equal(email.outbox().length, 1);
  await email.send({ ...input, idempotencyKey: 'k2' });
  await email.send(input);
  assert.equal(email.outbox().length, 3);
});

test('social.queuePost: same key queues once', async () => {
  const { social } = createFixtureAdapters();
  const input = { title: 'T', link: 'https://x.invalid', imageUrl: 'https://x.invalid/i.png', idempotencyKey: 'k' };
  const a = await social.queuePost(input);
  const b = await social.queuePost(input);
  assert.deepEqual(b, a);
  assert.equal(social.queue().length, 1);
});

test('payments: same key creates one checkout session and one completion event', async () => {
  const { payments } = createFixtureAdapters();
  const input = { amountCents: 500, currency: 'usd', productName: 'P', successUrl: 'https://a.invalid', cancelUrl: 'https://b.invalid', idempotencyKey: 'pay-1' };
  const s1 = await payments.createCheckoutSession(input);
  const s2 = await payments.createCheckoutSession(input);
  assert.equal(s2.id, s1.id);
  const e1 = await payments.completeSession(s1.id, { idempotencyKey: 'done-1' });
  const e2 = await payments.completeSession(s1.id, { idempotencyKey: 'done-1' });
  assert.equal(e2.id, e1.id);
  assert.equal(payments.listEvents().length, 1);
});

test('llm.generate, storage.put and domains.provision: same key returns the first result object', async () => {
  const a = createFixtureAdapters();
  const l1 = await a.llm.generate({ prompt: 'p', idempotencyKey: 'k' });
  assert.equal(await a.llm.generate({ prompt: 'different', idempotencyKey: 'k' }), l1, 'the first result wins');
  const f1 = await a.storage.put('w/a.txt', new Uint8Array(3), { idempotencyKey: 'k' });
  assert.equal(await a.storage.put('w/a.txt', new Uint8Array(9), { idempotencyKey: 'k' }), f1);
  const d1 = await a.domains.provision('shop', { idempotencyKey: 'k' });
  assert.equal(await a.domains.provision('shop', { idempotencyKey: 'k' }), d1);
});
