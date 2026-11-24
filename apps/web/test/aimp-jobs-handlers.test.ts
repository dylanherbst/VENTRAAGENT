import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoJobs, demoCtx, otherCtx } from '../lib/aimp/jobs/demo.ts';
import { createEffectLog, createFaultPlan, JobsError } from '../lib/aimp/jobs/index.ts';

const fresh = (env: Record<string, string | undefined> = {}, opts: { honourKeys?: boolean } = {}) => createDemoJobs(env, opts);

test('generate-product: a crash after the provider call resumes without a second call or a second charge', async () => {
  const d = fresh();
  // The effect (llm call) happens, then the worker "crashes" before the checkpoint is saved.
  d.faults.add({ kind: 'generate-product', step: 'draft-spec', times: 1, type: 'temporary', when: 'after' });
  const { job } = await d.service.enqueue(demoCtx('gen-1'), { kind: 'generate-product', input: { niche: 'planners' } });
  await d.runner.drain();
  let j = await d.service.get(demoCtx('gen-1'), job.id);
  assert.equal(j.status, 'waiting-retry');
  assert.deepEqual(await d.service.charges(demoCtx('x')), [], 'no charge until the step is checkpointed');
  d.clock.advance(60_000);
  await d.runner.drain();
  j = await d.service.get(demoCtx('gen-1'), job.id);
  assert.equal(j.status, 'succeeded');
  assert.equal(d.effects.executed().filter((e) => e.label === 'llm.generate').length, 1, 'one provider call');
  assert.equal(d.effects.suppressed(), 1, 'the retry was answered from the first result');
  const charges = await d.service.charges(demoCtx('x'));
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amountMinor, 5);
  assert.equal(d.effects.executed().filter((e) => e.label === 'storage.put').length, 1);
});

test('fulfil-order: repeated failures after sending still deliver exactly one email', async () => {
  const d = fresh();
  d.faults.add({ kind: 'fulfil-order', step: 'email-buyer', times: 2, type: 'temporary', when: 'after' });
  await d.service.enqueue(demoCtx('order-7'), { kind: 'fulfil-order', input: { orderId: 'order-7', buyerEmail: 'b@example.invalid' } });
  await d.service.enqueue(demoCtx('order-7'), { kind: 'fulfil-order', input: { orderId: 'order-7', buyerEmail: 'b@example.invalid' } });
  for (let i = 0; i < 6; i++) { await d.runner.drain(); d.clock.advance(60_000); }
  const [job] = await d.service.list(demoCtx('x'));
  assert.equal((await d.service.list(demoCtx('x'))).length, 1, 'the duplicate enqueue made no second order job');
  assert.equal(job.status, 'succeeded');
  const email = d.providers.email.adapter!;
  assert.equal(email.outbox().length, 1, 'one email, not three');
  assert.equal(d.effects.executed().filter((e) => e.label === 'files.grant').length, 1);
});

test('scheduled-post: a retry after queueing does not post twice', async () => {
  const d = fresh();
  d.faults.add({ kind: 'scheduled-post', step: 'publish-post', times: 1, type: 'temporary', when: 'after' });
  await d.service.enqueue(demoCtx('post-1'), { kind: 'scheduled-post', input: { title: 'Pin A' } });
  await d.runner.drain();
  d.clock.advance(60_000);
  await d.runner.drain();
  assert.equal((await d.service.list(demoCtx('x')))[0].status, 'succeeded');
  assert.equal(d.providers.social.adapter!.queue().length, 1);
});

test('publish-site: a permanent failure stops with the provider message and is not retried', async () => {
  const d = fresh();
  d.faults.add({ kind: 'publish-site', step: 'publish', times: 1, type: 'permanent', message: 'The domain is not verified yet.' });
  await d.service.enqueue(demoCtx('site-1'), { kind: 'publish-site' });
  await d.runner.drain();
  d.clock.advance(3_600_000);
  assert.deepEqual(await d.runner.drain(), []);
  const [j] = await d.service.list(demoCtx('x'));
  assert.equal(j.status, 'failed');
  assert.equal(j.lastError, 'The domain is not verified yet.');
  assert.equal(j.steps[0].status, 'succeeded', 'earlier checkpoint kept');
});

test('a disconnected provider fails the job with an actionable message', async () => {
  const d = fresh({ AIMP_EMAIL_ENABLED: '0' });
  assert.equal(d.providers.email.adapter, null);
  await d.service.enqueue(demoCtx('order-8'), { kind: 'fulfil-order' });
  await d.runner.drain();
  const [j] = await d.service.list(demoCtx('x'));
  assert.equal(j.status, 'failed');
  assert.match(j.lastError ?? '', /Email is not connected/);
  assert.equal(j.steps[1].status, 'succeeded', 'steps before the broken one are kept');
});

test('effect then crash before the checkpoint: the second attempt reuses the same key, and a key-honouring provider does the work once', async () => {
  const d = fresh({}, { honourKeys: true });
  d.faults.add({ kind: 'scheduled-post', step: 'publish-post', times: 1, type: 'temporary', when: 'after' });
  const { job } = await d.service.enqueue(demoCtx('post-key'), { kind: 'scheduled-post' });
  await d.runner.drain();
  d.clock.advance(60_000);
  await d.runner.drain();
  const key = `${job.id}:publish-post`;
  const calls = d.effects.calls().filter((c) => c.label === 'social.queuePost');
  assert.deepEqual(calls.map((c) => [c.key, c.duplicate]), [[key, false], [key, true]], 'same key on both attempts; the provider can tell it is a repeat');
  assert.equal(d.effects.suppressed(), 1);
  assert.equal(d.providers.social.adapter!.queue().length, 1);
});

test('effect log not honouring keys: the repeat is detected, but the provider adapter still dedupes by the step key', async () => {
  const d = fresh({}, { honourKeys: false });
  d.faults.add({ kind: 'fulfil-order', step: 'email-buyer', times: 1, type: 'temporary', when: 'after' });
  const { job } = await d.service.enqueue(demoCtx('order-dup'), { kind: 'fulfil-order' });
  await d.runner.drain();
  d.clock.advance(60_000);
  await d.runner.drain();
  assert.equal((await d.service.get(demoCtx('x'), job.id)).status, 'succeeded');
  assert.deepEqual(d.effects.duplicateKeys(), [`${job.id}:email-buyer`], 'the provider fake saw the same key twice');
  assert.equal(d.providers.email.adapter!.outbox().length, 1, 'the provider adapter dedupes by key even when the effect log does not, so the buyer gets one email');
  // Steps that had already been checkpointed were never repeated.
  assert.equal(d.effects.calls().filter((c) => c.label === 'files.grant').length, 1);
});

test('demo wiring is tenant-scoped', async () => {
  const d = fresh();
  const { job } = await d.service.enqueue(demoCtx('t1'), { kind: 'scheduled-post' });
  await assert.rejects(d.service.cancel(otherCtx('t1'), job.id), (e: unknown) => e instanceof JobsError && e.code === 'not_found');
  assert.deepEqual(await d.service.list(otherCtx('t1')), []);
});

test('EffectLog and FaultPlan behave as documented', async () => {
  const log = createEffectLog();
  let n = 0;
  assert.equal(await log.once('k', 'x', async () => ++n), 1);
  assert.equal(await log.once('k', 'x', async () => ++n), 1);
  assert.equal(log.suppressed(), 1);
  await assert.rejects(log.once('bad', 'y', async () => { throw new Error('boom'); }));
  assert.equal(await log.once('bad', 'y', async () => 9), 9, 'a failed effect did not happen, so it may be tried again');
  const f = createFaultPlan();
  f.add({ kind: 'k', step: 's', times: 1, type: 'temporary' });
  assert.doesNotThrow(() => f.check('k', 's', 'after'));
  assert.throws(() => f.check('k', 's', 'before'), /busy/);
  assert.doesNotThrow(() => f.check('k', 's', 'before'));
  assert.equal(f.remaining(), 0);
});

test('crash after the provider effect, before the checkpoint: the re-run does the effect exactly once at the provider', async () => {
  // honourKeys=false removes the effect-log guard, so only the provider adapter's own key dedupe is under test.
  const d = fresh({}, { honourKeys: false });
  d.faults.add({ kind: 'generate-product', step: 'store-file', times: 1, type: 'temporary', when: 'after' });
  d.faults.add({ kind: 'fulfil-order', step: 'email-buyer', times: 1, type: 'temporary', when: 'after' });
  d.faults.add({ kind: 'scheduled-post', step: 'publish-post', times: 1, type: 'temporary', when: 'after' });
  await d.service.enqueue(demoCtx('c1'), { kind: 'generate-product' });
  await d.service.enqueue(demoCtx('c2'), { kind: 'fulfil-order' });
  await d.service.enqueue(demoCtx('c3'), { kind: 'scheduled-post' });
  for (let i = 0; i < 4; i++) { await d.runner.drain(); d.clock.advance(60_000); }
  for (const j of await d.service.list(demoCtx('x'))) assert.equal(j.status, 'succeeded');
  assert.equal(d.effects.duplicateKeys().length, 3, 'each crashed step really was run twice by the runner');
  assert.equal(d.providers.email.adapter!.outbox().length, 1);
  assert.equal(d.providers.social.adapter!.queue().length, 1);
});
