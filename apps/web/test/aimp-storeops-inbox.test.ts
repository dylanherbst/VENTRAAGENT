import test from 'node:test';
import assert from 'node:assert/strict';
import { createInbox } from '../lib/aimp/storeops/inbox.ts';
import type { InboxDeps } from '../lib/aimp/storeops/inbox.ts';
import type { OrderFacts } from '../lib/aimp/storeops/order-status.ts';

const order: OrderFacts = { orderId: 'o1', buyerEmail: 'sam@example.com', title: 'Weekly Planner', payment: 'paid', delivery: 'delivered', deliveredAt: '2026-11-15T01:00:00Z' };
function make(over: Partial<InboxDeps> = {}) {
  const sent: { to: string; text: string; idempotencyKey: string }[] = [];
  let n = 0;
  const deps: InboxDeps = {
    now: () => 1000 + n, newId: () => `t${++n}`,
    orders: async (b) => (b === 'biz1' ? [order] : []),
    shop: () => ({ name: 'Ivy Co', products: [{ title: 'Weekly Planner', priceLabel: '$19', summary: 'A printable PDF planner.' }], policies: [], allowedLinks: ['https://ivy.example/s/ivy'] }),
    model: null,
    send: async (m) => { sent.push(m); return { id: `m${sent.length}` }; },
    ...over,
  };
  return { inbox: createInbox(deps), sent };
}

test('a buyer asking about their order gets a verified draft that waits for approval', async () => {
  const { inbox, sent } = make();
  const r = await inbox.add('biz1', { fromEmail: 'Sam@Example.com', message: 'Where is my download?' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.thread.kind, 'order');
  assert.equal(r.thread.status, 'waiting');
  assert.match(r.thread.body, /emailed to sam@example.com/i);
  assert.equal(sent.length, 0);
});

test('approve sends once, even twice; edits are used; rejecting sends nothing', async () => {
  const { inbox, sent } = make();
  const a = await inbox.add('biz1', { fromEmail: 'sam@example.com', message: 'download?' });
  if (!a.ok) throw new Error('add');
  const d1 = await inbox.decide('biz1', a.thread.id, 'approve', { body: 'Hi Sam, resent!' });
  const d2 = await inbox.decide('biz1', a.thread.id, 'approve');
  assert.ok(d1.ok && d2.ok);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.text, 'Hi Sam, resent!');
  assert.equal(sent[0]!.idempotencyKey, `inbox:${a.thread.id}`);
  if (d2.ok) assert.equal(d2.alreadyDecided, true);
  const b = await inbox.add('biz1', { fromEmail: 'sam@example.com', message: 'another order question' });
  if (!b.ok) throw new Error('add');
  await inbox.decide('biz1', b.thread.id, 'reject');
  assert.equal(sent.length, 1);
  assert.equal(inbox.list('biz1').find((t) => t.id === b.thread.id)?.status, 'rejected');
});

test('another business cannot see or decide a thread; unknown buyers learn nothing about orders', async () => {
  const { inbox, sent } = make();
  const a = await inbox.add('biz1', { fromEmail: 'stranger@x.com', message: 'where is my order' });
  if (!a.ok) throw new Error('add');
  assert.doesNotMatch(a.thread.body, /Weekly Planner/);
  assert.equal(inbox.list('biz2').length, 0);
  const d = await inbox.decide('biz2', a.thread.id, 'approve');
  assert.deepEqual(d.ok, false);
  assert.equal(sent.length, 0);
});

test('general enquiries go through the receptionist and fall back to the owner without a model', async () => {
  const { inbox } = make();
  const r = await inbox.add('biz1', { fromEmail: 'new@x.com', message: 'How much is the planner?' });
  if (!r.ok) throw new Error('add');
  assert.equal(r.thread.kind, 'enquiry');
  assert.equal(r.thread.source, 'fallback');
  assert.equal(r.thread.handToOwner, true);
  const smart = make({ model: { run: async () => ({ text: JSON.stringify({ intent: 'pricing', reply: 'It is $19.', handToOwner: false, note: 'price' }) }) } });
  const s = await smart.inbox.add('biz1', { fromEmail: 'new@x.com', message: 'How much is the planner?' });
  if (!s.ok) throw new Error('add');
  assert.equal(s.thread.source, 'agent');
  assert.equal(s.thread.body, 'It is $19.');
});

test('validation, duplicates, send failure and the cap', async () => {
  const { inbox } = make();
  assert.deepEqual((await inbox.add('biz1', { fromEmail: 'nope', message: 'hi' })).ok, false);
  assert.deepEqual((await inbox.add('biz1', { fromEmail: 'a@b.co', message: ' ' })).ok, false);
  const one = await inbox.add('biz1', { fromEmail: 'a@b.co', message: 'hello there' });
  const two = await inbox.add('biz1', { fromEmail: 'A@b.co', message: 'hello there' });
  assert.ok(one.ok && two.ok);
  if (one.ok && two.ok) { assert.equal(one.thread.id, two.thread.id); assert.equal(two.created, false); }
  const failing = make({ send: async () => { throw new Error('smtp'); } });
  const t = await failing.inbox.add('biz1', { fromEmail: 'sam@example.com', message: 'download?' });
  if (!t.ok) throw new Error('add');
  const d = await failing.inbox.decide('biz1', t.thread.id, 'approve');
  assert.equal(d.ok, false);
  assert.equal(failing.inbox.list('biz1')[0]!.status, 'waiting');
  for (let i = 0; i < 60; i++) await inbox.add('biz1', { fromEmail: `u${i}@x.co`, message: `question ${i}` });
  assert.equal(inbox.list('biz1').length, 50);
  assert.equal((await inbox.add('biz1', { fromEmail: 'z@x.co', message: 'one more' })).ok, false);
});
