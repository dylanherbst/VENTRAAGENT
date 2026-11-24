import assert from 'node:assert/strict';
import test from 'node:test';
import type { OperationContext } from '../lib/aimp/contracts.ts';
import { createJobRegistry, createJobRunner, createJobService, createMemoryJobStore, JobsError } from '../lib/aimp/jobs/index.ts';
import type { JsonValue } from '../lib/aimp/jobs/index.ts';

const ctx = (businessId: string | undefined, key: string): OperationContext => ({ workspaceId: 'ws-1', businessId, actorUserId: 'user-1', idempotencyKey: key });
const code = (c: string) => (e: unknown) => e instanceof JobsError && e.code === c;

function setup() {
  const t = 1_000_000;
  const store = createMemoryJobStore();
  const runs: string[] = [];
  const registry = createJobRegistry([{ kind: 'demo', maxAttempts: 3, steps: [{ name: 'a', run: async (a: { idempotencyKey: string }) => { runs.push(a.idempotencyKey); return { output: { ok: true } as JsonValue }; } }] }]);
  const service = createJobService({ store, registry, now: () => t, newId: (() => { let n = 0; return () => `job-${++n}`; })() });
  const runner = createJobRunner({ store, registry, owner: 'r1', now: () => t, random: () => 0, leaseMs: 60_000, backoff: { baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0 } });
  return { service, runner, runs };
}

test('two businesses in one workspace with the same key each get their own job and each runs once', async () => {
  const s = setup();
  const a = await s.service.enqueue(ctx('biz-a', 'order-1'), { kind: 'demo', input: { n: 1 } });
  const b = await s.service.enqueue(ctx('biz-b', 'order-1'), { kind: 'demo', input: { n: 1 } });
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.notEqual(a.job.id, b.job.id);
  await s.runner.drain();
  assert.equal(s.runs.length, 2, 'one run per business');
  assert.equal((await s.service.get(ctx('biz-a', 'x'), a.job.id)).status, 'succeeded');
  assert.equal((await s.service.get(ctx('biz-b', 'x'), b.job.id)).status, 'succeeded');
});

test('same business replay dedupes; different input on the same key still conflicts', async () => {
  const s = setup();
  const first = await s.service.enqueue(ctx('biz-a', 'order-1'), { kind: 'demo', input: { n: 1 } });
  const again = await s.service.enqueue(ctx('biz-a', 'order-1'), { kind: 'demo', input: { n: 1 } });
  assert.equal(again.created, false);
  assert.equal(again.job.id, first.job.id);
  await assert.rejects(s.service.enqueue(ctx('biz-a', 'order-1'), { kind: 'demo', input: { n: 2 } }), code('conflict'));
  await s.runner.drain();
  assert.equal(s.runs.length, 1);
});

test('controls with another business id answer as not found and change nothing', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(ctx('biz-a', 'k'), { kind: 'demo' });
  const c = ctx('biz-b', 'x');
  await assert.rejects(s.service.get(c, job.id, 'biz-b'), code('not_found'));
  await assert.rejects(s.service.pause(c, job.id, 'biz-b'), code('not_found'));
  await assert.rejects(s.service.retry(c, job.id, 'biz-b'), code('not_found'));
  await assert.rejects(s.service.cancel(c, job.id, 'biz-b'), code('not_found'));
  await assert.rejects(s.service.get(c, 'missing', 'biz-b'), code('not_found'));
  assert.equal((await s.service.get(c, job.id)).status, 'queued', 'untouched');
  assert.equal((await s.service.get(c, job.id, 'biz-a')).id, job.id, 'own business can read it');
});

test('controls without a business id behave as before', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(ctx('biz-a', 'k'), { kind: 'demo' });
  const c = ctx('biz-b', 'x');
  assert.equal((await s.service.pause(c, job.id)).status, 'paused');
  assert.equal((await s.service.resume(c, job.id)).status, 'queued');
  await assert.rejects(s.service.retry(c, job.id), code('bad_state'));
  assert.equal((await s.service.cancel(c, job.id)).status, 'cancelled');
});
