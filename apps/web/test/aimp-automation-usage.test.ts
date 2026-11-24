import assert from 'node:assert/strict';
import test from 'node:test';
import { automationCtx, createDemoAutomation, DEMO_CAP, OTHER_BUSINESS } from '../lib/aimp/automation/demo.ts';
import { AutomationError } from '../lib/aimp/automation/index.ts';

const fresh = () => createDemoAutomation({});
const A = (k: string) => automationCtx(k);
const B = (k: string) => automationCtx(k, OTHER_BUSINESS);
const code = (c: string) => (e: unknown) => e instanceof AutomationError && e.code === c;
const gen = (d: ReturnType<typeof fresh>, k: string, ctx = A) => d.automation.start(ctx(k), { kind: 'generate-product', input: { niche: k } });

test('the allowance is used by new generations and refused at the cap with a safe message', async () => {
  const d = fresh();
  for (let i = 1; i <= DEMO_CAP; i++) assert.equal((await gen(d, `g${i}`)).outcome, 'started');
  const u = await d.automation.usage(A('x'));
  assert.equal(u.used, DEMO_CAP);
  assert.equal(u.remaining, 0);
  assert.equal(u.reached, true);
  const r = await gen(d, 'g-over');
  assert.equal(r.outcome, 'cap_reached');
  const msg = (r as { message: string }).message;
  assert.match(msg, /used all 3 AI generations/);
  assert.match(msg, /Orders and deliveries are not affected/);
  assert.doesNotMatch(msg, /demo-workspace|g-over|Error|at /);
  assert.equal((await d.jobs.service.list(A('x'))).length, DEMO_CAP, 'no job was created over the cap');
  const feed = await d.automation.activity(A('x'));
  assert.ok(feed.entries.some((e) => e.source === 'limit' && e.status === 'paused' && /allowance/.test(e.title)), 'the refusal is in the activity feed');
});

test('a repeated key is never counted twice and a refused repeat does not change the count', async () => {
  const d = fresh();
  await gen(d, 'same');
  const again = await gen(d, 'same');
  assert.equal(again.outcome === 'started' && again.created, false);
  assert.equal((await d.automation.usage(A('x'))).used, 1);
  await gen(d, 'g2'); await gen(d, 'g3');
  assert.equal((await gen(d, 'g4')).outcome, 'cap_reached');
  assert.equal((await gen(d, 'g4')).outcome, 'cap_reached');
  assert.equal((await d.automation.usage(A('x'))).used, 3);
  const replay = await gen(d, 'same');
  assert.equal(replay.outcome, 'started', 'a request already paid for is still answered at the cap');
});

test('parallel starts cannot take more than the allowance', async () => {
  const d = fresh();
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => gen(d, `p${i}`)));
  assert.equal(rs.filter((r) => r.outcome === 'started').length, DEMO_CAP);
  assert.equal(rs.filter((r) => r.outcome === 'cap_reached').length, 3);
});

test('delivery and already-paid work are never blocked by the cap or by pausing', async () => {
  const d = fresh();
  for (let i = 1; i <= DEMO_CAP; i++) await gen(d, `g${i}`);
  await d.automation.setMode(A('x'), 'product-generation', 'paused');
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  const o = await d.automation.start(A('order-1'), { kind: 'fulfil-order', input: { orderId: 'o1' } });
  assert.equal(o.outcome, 'started');
  await d.jobs.runner.drain();
  const job = (await d.jobs.service.list(A('x'))).find((j) => j.kind === 'fulfil-order');
  assert.equal(job?.status, 'succeeded');
  assert.equal((await d.automation.usage(A('x'))).used, DEMO_CAP, 'delivery is not counted');
  // already-queued generation jobs still run
  await d.automation.setMode(A('x'), 'product-generation', 'automatic');
  await d.jobs.runner.drain();
  assert.equal((await d.jobs.service.list(A('x'))).filter((j) => j.kind === 'generate-product' && j.status === 'succeeded').length, DEMO_CAP);
});

test('the allowance is per business and resets with the period', async () => {
  const d = fresh();
  for (let i = 1; i <= DEMO_CAP; i++) await gen(d, `g${i}`);
  assert.equal((await gen(d, 'x')).outcome, 'cap_reached');
  assert.equal((await gen(d, 'b1', B)).outcome, 'started', 'another business has its own allowance');
  assert.equal((await d.automation.usage(B('x'))).used, 1);
  const u = await d.automation.usage(A('x'));
  d.jobs.clock.advance(u.resetsAt - d.jobs.clock.now() + 1);
  assert.equal((await d.automation.usage(A('x'))).used, 0);
  assert.equal((await gen(d, 'next-month')).outcome, 'started');
});

test('the owner can change the allowance; bad values are refused', async () => {
  const d = fresh();
  await d.automation.setCap(A('x'), 1);
  assert.equal((await gen(d, 'a')).outcome, 'started');
  assert.equal((await gen(d, 'b')).outcome, 'cap_reached');
  await d.automation.setCap(A('x'), 2);
  assert.equal((await gen(d, 'b')).outcome, 'started');
  await assert.rejects(d.automation.setCap(A('x'), -1), code('invalid'));
  await assert.rejects(d.automation.setCap(A('x'), 1.5), code('invalid'));
  assert.equal((await d.automation.usage(B('x'))).limit, DEMO_CAP, 'the other business keeps its default');
});

test('a failed enqueue releases the reserved generation', async () => {
  const d = fresh();
  const real = d.jobs.service.enqueue;
  d.jobs.service.enqueue = async () => { throw new Error('store down'); };
  await assert.rejects(gen(d, 'a'));
  d.jobs.service.enqueue = real;
  assert.equal((await d.automation.usage(A('x'))).used, 0);
});

test('approval path: the cap is checked when asking and when approving', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'product-generation', 'owner_approval');
  const ids: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const r = await gen(d, `q${i}`);
    assert.equal(r.outcome, 'needs_approval');
    ids.push((r as { approvalId: string }).approvalId);
  }
  assert.equal((await d.automation.usage(A('x'))).used, 0, 'asking does not spend the allowance');
  for (let i = 0; i < 3; i++) assert.equal((await d.automation.decide(A('c'), ids[i], 'approve')).ran, true);
  await assert.rejects(d.automation.decide(A('c'), ids[3], 'approve'), code('blocked'));
  assert.equal((await d.automation.approvals(A('x'), { status: 'pending' })).length, 1, 'the blocked request stays pending');
  assert.equal((await gen(d, 'q5')).outcome, 'cap_reached', 'new requests are refused once the allowance is used up');
});
