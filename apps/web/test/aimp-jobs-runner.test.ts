import assert from 'node:assert/strict';
import test from 'node:test';
import type { OperationContext } from '../lib/aimp/contracts.ts';
import { backoffMs, createJobRegistry, createJobRunner, createJobService, createMemoryJobStore, DEFAULT_BACKOFF, JobError, JobsError, safeText } from '../lib/aimp/jobs/index.ts';
import type { JobStore, JsonValue, UsageGuard } from '../lib/aimp/jobs/index.ts';

const ctxFor = (workspaceId: string, key: string, businessId?: string): OperationContext => ({ workspaceId, businessId, actorUserId: `user-${workspaceId}`, idempotencyKey: key });
const A = (key = 'k1') => ctxFor('ws-a', key, 'biz-a');
const B = (key = 'k1') => ctxFor('ws-b', key, 'biz-b');
const code = (c: string) => (e: unknown) => e instanceof JobsError && e.code === c;

/** Three steps: a (free), b (cost 7), c (free). Handlers record every execution and the idempotency key they were given. */
function setup(opts: { maxAttempts?: number; guard?: UsageGuard; leaseMs?: number; owner?: string; stepTimeoutMs?: number } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const store = createMemoryJobStore();
  const calls: string[] = [];
  const keys: Record<string, string[]> = {};
  const failures = new Map<string, Error[]>();
  const gates = new Map<string, Promise<void>>();
  const signals: AbortSignal[] = [];
  const run = (name: string) => async (a: { idempotencyKey: string; signal: AbortSignal }) => {
    calls.push(name);
    signals.push(a.signal);
    (keys[name] ??= []).push(a.idempotencyKey);
    const gate = gates.get(name);
    if (gate) await gate;
    const err = failures.get(name)?.shift();
    if (err) throw err;
    return { output: { [name]: calls.length } as JsonValue };
  };
  const registry = createJobRegistry([{
    kind: 'demo', maxAttempts: opts.maxAttempts ?? 3,
    steps: [{ name: 'a', run: run('a') }, { name: 'b', costMinor: 7, run: run('b') }, { name: 'c', run: run('c') }],
  }]);
  const service = createJobService({ store, registry, now: clock.now, newId: (() => { let n = 0; return () => `job-${++n}`; })() });
  const mkRunner = (owner: string, over: { guard?: UsageGuard; store?: JobStore } = {}) => createJobRunner({
    store: over.store ?? store, registry, owner, now: clock.now, random: () => 0, leaseMs: opts.leaseMs ?? 60_000, stepTimeoutMs: opts.stepTimeoutMs,
    backoff: { baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0 }, guard: over.guard ?? opts.guard,
  });
  return { clock, store, calls, keys, signals, failures, gates, registry, service, runner: mkRunner(opts.owner ?? 'r1'), mkRunner };
}
const temp = (m = 'The provider is busy.') => new JobError('temporary', m);
const perm = (m = 'The provider refused this.') => new JobError('permanent', m);

test('happy path runs one step per claim, in order, and checkpoints each', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(A(), { kind: 'demo', input: { x: 1 } });
  const r1 = await s.runner.runDue();
  assert.deepEqual(r1.map((r) => [r.step, r.outcome, r.jobStatus]), [['a', 'succeeded', 'queued']]);
  const mid = await s.service.get(A(), job.id);
  assert.equal(mid.steps[0].status, 'succeeded');
  assert.deepEqual(mid.steps[0].output, { a: 1 });
  assert.equal(mid.steps[1].status, 'pending');
  await s.runner.drain();
  const done = await s.service.get(A(), job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(s.calls, ['a', 'b', 'c']);
  assert.equal(done.leaseOwner, null);
});

test('temporary error retries with capped backoff, then succeeds; the cost is recorded once', async () => {
  const s = setup();
  s.failures.set('b', [temp(), temp()]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue(); // a
  const f1 = await s.runner.runDue(); // b fails (attempt 1)
  assert.equal(f1[0].outcome, 'retry');
  let j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'waiting-retry');
  assert.equal(j.nextRunAt, s.clock.now() + 1_000);
  assert.equal(j.lastError, 'The provider is busy.');
  assert.deepEqual(await s.runner.runDue(), [], 'not due yet');
  s.clock.advance(999);
  assert.deepEqual(await s.runner.runDue(), [], 'still not due');
  s.clock.advance(1);
  const f2 = await s.runner.runDue(); // b fails (attempt 2)
  assert.equal(f2[0].outcome, 'retry');
  j = await s.service.get(A(), job.id);
  assert.equal(j.nextRunAt, s.clock.now() + 2_000, 'doubles');
  assert.deepEqual(await s.service.charges(A()), [], 'no charge while the step keeps failing');
  s.clock.advance(2_000);
  await s.runner.drain();
  j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'succeeded');
  assert.equal(s.calls.filter((c) => c === 'b').length, 3);
  assert.equal(s.calls.filter((c) => c === 'a').length, 1, 'completed step was not re-run');
  const charges = await s.service.charges(A());
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amountMinor, 7);
  assert.equal(j.steps[1].attempts, 3);
});

test('backoffMs doubles, is capped and adds bounded jitter', () => {
  const o = { baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0.5 };
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => backoffMs(n, { ...o, jitterRatio: 0 })), [1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(backoffMs(2, o, () => 0), 2000);
  assert.equal(backoffMs(2, o, () => 0.999), Math.round(2000 * (1 - 0.5 * 0.999)), 'jitter only shortens the wait');
  assert.equal(backoffMs(30, o, () => 0), 8000, 'never past the cap');
  assert.ok(backoffMs(30, o, () => 0.999) < 8000 && backoffMs(30, o, () => 0.5) !== backoffMs(30, o, () => 0.1), 'jitter still spreads runners at the cap');
  assert.ok(DEFAULT_BACKOFF.maxDelayMs >= DEFAULT_BACKOFF.baseDelayMs);
});

test('permanent error fails at once without retry and without a charge', async () => {
  const s = setup();
  s.failures.set('b', [perm('The card was refused.')]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.drain();
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'failed');
  assert.equal(j.lastError, 'The card was refused.');
  assert.equal(j.steps[1].status, 'failed');
  assert.equal(j.steps[1].attempts, 1);
  s.clock.advance(3_600_000);
  assert.deepEqual(await s.runner.runDue(), []);
  assert.equal((await s.service.charges(A())).length, 0);
});

test('retries stop at max attempts with an actionable message', async () => {
  const s = setup({ maxAttempts: 3 });
  s.failures.set('a', [temp(), temp(), temp(), temp()]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  for (let i = 0; i < 5; i++) { await s.runner.runDue(); s.clock.advance(10_000); }
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'failed');
  assert.equal(s.calls.filter((c) => c === 'a').length, 3);
  assert.match(j.lastError ?? '', /did not work after 3 tries/);
  assert.match(j.lastError ?? '', /retry the job/);
  assert.doesNotMatch(j.lastError ?? '', /start the job again/);
});

test('an unknown error is retried and its text is never shown', async () => {
  const s = setup();
  s.failures.set('a', [new Error('connect ECONNREFUSED sk_live_SECRET at /srv/app.js:10')]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue();
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'waiting-retry');
  assert.ok(!/sk_live|ECONNREFUSED|srv/.test(j.lastError ?? ''));
});

test('crash mid-job: the lease expires and the next runner resumes at the right step', async () => {
  const s = setup({ leaseMs: 60_000 });
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue(); // a done
  // A worker claims step b and dies without settling.
  const dead = await s.store.claim({ now: s.clock.now(), owner: 'dead-worker', leaseMs: 60_000, limit: 5 });
  assert.equal(dead.length, 1);
  assert.equal(dead[0].stepIndex, 1);
  const r2 = s.mkRunner('r2');
  s.clock.advance(59_999);
  assert.deepEqual(await r2.runDue(), [], 'lease still held');
  s.clock.advance(1);
  const resumed = await r2.runDue();
  assert.deepEqual(resumed.map((r) => [r.step, r.outcome]), [['b', 'succeeded']]);
  await r2.drain();
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'succeeded');
  assert.deepEqual(s.calls, ['a', 'b', 'c'], 'a was never re-run; b ran once (the dead worker never executed)');
  assert.equal(j.steps[1].attempts, 2, 'the lost lease counted as an attempt');
  assert.equal((await s.service.charges(A())).length, 1);
});

test('a stale worker cannot settle after its lease was reclaimed', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  const [c1] = await s.store.claim({ now: s.clock.now(), owner: 'w1', leaseMs: 1_000, limit: 1 });
  s.clock.advance(1_000);
  const [c2] = await s.store.claim({ now: s.clock.now(), owner: 'w2', leaseMs: 1_000, limit: 1 });
  assert.equal(c2.job.leaseVersion, c1.job.leaseVersion + 1);
  const stale = await s.store.settle('ws-a', job.id, { owner: 'w1', leaseVersion: c1.job.leaseVersion }, { type: 'succeeded', stepIndex: 0, output: { late: true }, costMinor: 9 }, s.clock.now());
  assert.equal(stale, null);
  const j = await s.service.get(A(), job.id);
  assert.equal(j.steps[0].output, null);
  assert.deepEqual(await s.service.charges(A()), []);
});

test('a step that keeps losing its lease is stopped instead of looping forever', async () => {
  const s = setup({ maxAttempts: 2, leaseMs: 1_000 });
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  for (let i = 0; i < 2; i++) { await s.store.claim({ now: s.clock.now(), owner: `dead-${i}`, leaseMs: 1_000, limit: 1 }); s.clock.advance(1_000); }
  const r = await s.runner.runDue();
  assert.equal(r[0].outcome, 'failed');
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'failed');
  assert.deepEqual(s.calls, [], 'the handler was not run a third time');
});

test('two concurrent runners never execute the same step', async () => {
  const s = setup();
  let release!: () => void;
  s.gates.set('a', new Promise<void>((r) => { release = r; }));
  await s.service.enqueue(A(), { kind: 'demo' });
  const r1 = s.mkRunner('r1'), r2 = s.mkRunner('r2');
  const both = Promise.all([r1.runDue(), r2.runDue(), r1.runDue()]);
  await Promise.resolve();
  release();
  const reports = (await both).flat();
  assert.equal(reports.length, 1);
  assert.equal(s.calls.filter((c) => c === 'a').length, 1);
  // Draining from two runners at once still runs each step exactly once.
  s.gates.clear();
  await Promise.all([r1.drain(), r2.drain()]);
  assert.deepEqual(s.calls, ['a', 'b', 'c']);
});

test('duplicate enqueue returns the same job; keys are per tenant and per kind', async () => {
  const s = setup();
  s.registry.register({ kind: 'other', steps: [{ name: 'only', run: async () => ({ output: 1 }) }] });
  const first = await s.service.enqueue(A('order-1'), { kind: 'demo', input: { n: 1, m: 2 } });
  const again = await s.service.enqueue(A('order-1'), { kind: 'demo', input: { m: 2, n: 1 } });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.job.id, first.job.id);
  assert.equal((await s.service.list(A())).length, 1);
  await assert.rejects(s.service.enqueue(A('order-1'), { kind: 'demo', input: { n: 2 } }), code('conflict'));
  const otherKind = await s.service.enqueue(A('order-1'), { kind: 'other' });
  assert.notEqual(otherKind.job.id, first.job.id);
  const otherTenant = await s.service.enqueue(B('order-1'), { kind: 'demo', input: { n: 2 } });
  assert.notEqual(otherTenant.job.id, first.job.id);
  await s.runner.drain();
  assert.equal(s.calls.filter((c) => c === 'a').length, 2, 'one run per real job: tenant A once, tenant B once');
});

test('duplicate enqueue after the job ran does not run or charge again', async () => {
  const s = setup();
  await s.service.enqueue(A('order-9'), { kind: 'demo' });
  await s.runner.drain();
  const again = await s.service.enqueue(A('order-9'), { kind: 'demo' });
  assert.equal(again.created, false);
  await s.runner.drain();
  assert.deepEqual(s.calls, ['a', 'b', 'c']);
  assert.equal((await s.service.charges(A())).length, 1);
});

test('each step gets a stable idempotency key across retries; keys differ between steps and jobs', async () => {
  const s = setup();
  s.failures.set('b', [temp()]);
  const j1 = (await s.service.enqueue(A('x'), { kind: 'demo' })).job;
  const j2 = (await s.service.enqueue(A('y'), { kind: 'demo' })).job;
  for (let i = 0; i < 12; i++) { await s.runner.runDue(); s.clock.advance(1_000); }
  const bKeys = s.keys.b;
  assert.equal(bKeys.length, 3);
  assert.equal(bKeys.filter((k) => k === `${j1.id}:b`).length, 2, 'both attempts of j1/b used the same key');
  assert.deepEqual(new Set(bKeys), new Set([`${j1.id}:b`, `${j2.id}:b`]));
  assert.notEqual(s.keys.a[0], s.keys.b[0]);
});

test('cost is recorded once per successful step, not for failed, cancelled or duplicate work', async () => {
  const s = setup();
  s.failures.set('b', [temp()]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.drain();
  s.clock.advance(1_000);
  await s.runner.drain();
  await s.service.enqueue(A(), { kind: 'demo' });
  assert.equal((await s.service.get(A(), job.id)).status, 'succeeded');
  assert.deepEqual((await s.service.charges(A())).map((c) => [c.stepName, c.amountMinor, c.jobId]), [['b', 7, job.id]]);
  const c = await s.store.claim({ now: s.clock.now(), owner: 'x', leaseMs: 10, limit: 1 });
  assert.deepEqual(c, [], 'a finished job is never claimed again');
});

test('usage guard can park a job without using an attempt or charging; allow lets it run', async () => {
  let allow = false;
  const seen: number[] = [];
  const guard: UsageGuard = async (r) => { seen.push(r.costMinor); return allow ? { allow: true } : { allow: false, reason: 'Monthly generation limit reached.' }; };
  const s = setup({ guard });
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue(); // a is free: the guard is not asked
  const r = await s.runner.runDue(); // b costs 7
  assert.equal(r[0].outcome, 'paused');
  let j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'paused');
  assert.equal(j.lastError, 'Monthly generation limit reached.');
  assert.equal(j.steps[1].attempts, 0);
  assert.deepEqual(seen, [7]);
  assert.equal(s.calls.filter((c) => c === 'b').length, 0);
  allow = true;
  await s.service.resume(A(), job.id);
  await s.runner.drain();
  j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'succeeded');
  assert.equal((await s.service.charges(A())).length, 1);
});

test('a handler may lower the declared cost but never raise it past what the guard saw', async () => {
  const s = setup();
  s.registry.register({ kind: 'metered', steps: [
    { name: 'm1', costMinor: 12, run: async () => ({ output: 1, costMinor: 5 }) },
    { name: 'm2', costMinor: 5, run: async () => ({ output: 2, costMinor: 0 }) },
  ] });
  s.registry.register({ kind: 'overspend', steps: [{ name: 'o1', costMinor: 5, run: async () => ({ output: 1, costMinor: 50 }) }] });
  await s.service.enqueue(A('m'), { kind: 'metered' });
  const over = (await s.service.enqueue(A('o'), { kind: 'overspend' })).job;
  await s.runner.drain();
  assert.deepEqual((await s.service.charges(A())).map((c) => [c.stepName, c.amountMinor]), [['m1', 5]]);
  const j = await s.service.get(A(), over.id);
  assert.equal(j.status, 'failed');
  assert.match(j.lastError ?? '', /above its declared limit/);
});

test('a guard that throws becomes a temporary failure for that job and the batch carries on', async () => {
  let boom = true;
  const guard: UsageGuard = async () => { if (boom) throw new Error('billing service down: sk_live_ABCDEF1234'); return { allow: true }; };
  const s = setup({ guard });
  s.registry.register({ kind: 'free', steps: [{ name: 'f', run: async () => ({ output: 1 }) }] });
  const paid = (await s.service.enqueue(A('paid'), { kind: 'demo' })).job;
  const free = (await s.service.enqueue(A('free'), { kind: 'free' })).job;
  await s.runner.runDue(); // a (free step) for paid, f for free
  const r = await s.runner.runDue(); // paid job reaches the costed step b: guard throws
  assert.deepEqual(r.map((x) => [x.step, x.outcome]), [['b', 'retry']]);
  assert.ok(!/sk_live|billing service/.test(r[0].message ?? ''));
  assert.equal((await s.service.get(A(), free.id)).status, 'succeeded');
  assert.equal((await s.service.get(A(), paid.id)).status, 'waiting-retry');
  assert.equal(s.calls.filter((c) => c === 'b').length, 0, 'the handler did not run without a usage check');
  boom = false;
  s.clock.advance(1_000);
  await s.runner.drain();
  assert.equal((await s.service.get(A(), paid.id)).status, 'succeeded');
});

test('a store whose settle throws once only affects that job; the lease expires and the step is picked up again', async () => {
  const s = setup({ leaseMs: 10_000 });
  let thrown = false;
  const flaky: JobStore = { ...s.store, settle: async (...args) => {
    if (!thrown) { thrown = true; throw new Error('connection reset'); }
    return s.store.settle(...args);
  } };
  const r = s.mkRunner('r-flaky', { store: flaky });
  const one = (await s.service.enqueue(A('one'), { kind: 'demo' })).job;
  const two = (await s.service.enqueue(A('two'), { kind: 'demo' })).job;
  const reports = await r.runDue(); // does not reject
  assert.deepEqual(reports.map((x) => x.outcome).sort(), ['error', 'succeeded']);
  assert.match(reports.find((x) => x.outcome === 'error')?.message ?? '', /could not be saved/);
  const errored = reports.find((x) => x.outcome === 'error')!;
  const stuck = await s.service.get(A(), errored.jobId);
  assert.equal(stuck.status, 'running', 'still leased, never lost');
  assert.deepEqual(await r.runDue().then((x) => x.filter((y) => y.jobId === errored.jobId)), [], 'not reclaimable before the lease expires');
  s.clock.advance(10_000);
  await r.drain();
  for (const id of [one.id, two.id]) assert.equal((await s.service.get(A(), id)).status, 'succeeded');
  assert.equal(s.calls.filter((c) => c === 'a').length, 3, 'at-least-once: the step whose checkpoint was lost ran twice');
  assert.equal(new Set(s.keys.a).size, 2, 'with the same idempotency key both times');
});

test('a step that outlives the timeout is aborted and retried as a temporary error', async () => {
  const s = setup({ leaseMs: 1_000, stepTimeoutMs: 20 });
  let release!: () => void;
  s.gates.set('a', new Promise<void>((r) => { release = r; }));
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  const [report] = await s.runner.runDue();
  assert.equal(report.outcome, 'retry');
  assert.match(report.message ?? '', /took too long/);
  assert.equal(s.signals[0].aborted, true, 'the handler was told to stop');
  let j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'waiting-retry');
  release(); // the late result must not be saved
  await new Promise((r) => setTimeout(r, 5));
  j = await s.service.get(A(), job.id);
  assert.equal(j.steps[0].output, null);
  assert.equal(j.steps[0].status, 'pending');
  // The timeout is clamped below the lease so the lease cannot expire mid-step.
  const clamped = setup({ leaseMs: 50, stepTimeoutMs: 5_000 });
  clamped.gates.set('a', new Promise<void>(() => {}));
  await clamped.service.enqueue(A(), { kind: 'demo' });
  const [c] = await clamped.runner.runDue();
  assert.equal(c.outcome, 'retry');
});

test('the same key with a different input or run time is a conflict; the same request is a duplicate; another business (or none) gets its own job', async () => {
  const s = setup();
  const at = s.clock.now() + 5_000;
  const first = await s.service.enqueue(ctxFor('ws-a', 'k', 'biz-1'), { kind: 'demo', input: { a: 1 }, runAt: at });
  assert.equal((await s.service.enqueue(ctxFor('ws-a', 'k', 'biz-1'), { kind: 'demo', input: { a: 1 }, runAt: at })).job.id, first.job.id);
  // The idempotency key is scoped per business: another business is neither blocked by nor able to probe this key.
  const other = await s.service.enqueue(ctxFor('ws-a', 'k', 'biz-2'), { kind: 'demo', input: { a: 1 }, runAt: at });
  assert.equal(other.created, true);
  assert.notEqual(other.job.id, first.job.id);
  assert.equal(other.job.businessId, 'biz-2');
  // No business is its own scope (matches the proposed unique nulls not distinct index): a separate job, not a duplicate or conflict.
  const none = await s.service.enqueue(ctxFor('ws-a', 'k', undefined), { kind: 'demo', input: { a: 1 }, runAt: at });
  assert.equal(none.created, true);
  assert.equal(none.job.businessId, null);
  assert.equal(new Set([first.job.id, other.job.id, none.job.id]).size, 3);
  assert.equal((await s.service.enqueue(ctxFor('ws-a', 'k', undefined), { kind: 'demo', input: { a: 1 }, runAt: at })).job.id, none.job.id, 'the null scope still dedupes');
  await assert.rejects(s.service.enqueue(ctxFor('ws-a', 'k', 'biz-1'), { kind: 'demo', input: { a: 1 }, runAt: at + 1 }), code('conflict'));
  await assert.rejects(s.service.enqueue(ctxFor('ws-a', 'k', 'biz-1'), { kind: 'demo', input: { a: 1 } }), code('conflict'));
  assert.match(first.job.inputHash, /^[0-9a-f]{64}$/, 'SHA-256 hex');
});

test('retry gives a failed step a fresh attempt budget and keeps completed steps and charges', async () => {
  const s = setup({ maxAttempts: 2 });
  s.failures.set('c', [temp(), temp()]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  for (let i = 0; i < 8; i++) { await s.runner.runDue(); s.clock.advance(10_000); }
  let j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'failed');
  assert.equal(j.steps[2].attempts, 2);
  await assert.rejects(s.service.retry(B(), job.id), code('not_found'));
  const r = await s.service.retry(A(), job.id);
  assert.equal(r.status, 'queued');
  assert.equal(r.steps[2].attempts, 0);
  assert.equal(r.steps[2].status, 'pending');
  assert.equal(r.lastError, null);
  await s.runner.drain();
  j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'succeeded');
  assert.deepEqual(s.calls, ['a', 'b', 'c', 'c', 'c'], 'a and b were not re-run');
  assert.equal((await s.service.charges(A())).length, 1, 'b was not charged again');
  await assert.rejects(s.service.retry(A(), job.id), code('bad_state'));
});

test('secret-looking tokens and file paths are removed from stored and reported messages', async () => {
  const s = setup();
  s.failures.set('a', [perm('Refused with key sk_live_ABCDEF123456 at /srv/app/handlers/run.js:42 using Bearer abcdef1234567890 and C:\\Users\\me\\x.txt')]);
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  const [r] = await s.runner.runDue();
  const j = await s.service.get(A(), job.id);
  for (const text of [j.lastError ?? '', r.message ?? '']) {
    assert.ok(!/sk_live|ABCDEF|\/srv|run\.js|abcdef1234567890|Users/.test(text), text);
    assert.match(text, /Refused with key/);
  }
  assert.equal(safeText('see https://example.invalid/a/b ok'), 'see https://example.invalid/a/b ok', 'URLs are left alone');
  assert.ok(safeText('x'.repeat(500)).length <= 240);
});

test('cross-tenant access is refused on every read and write', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue();
  await assert.rejects(s.service.get(B(), job.id), code('not_found'));
  await assert.rejects(s.service.pause(B(), job.id), code('not_found'));
  await assert.rejects(s.service.resume(B(), job.id), code('not_found'));
  await assert.rejects(s.service.cancel(B(), job.id), code('not_found'));
  assert.deepEqual(await s.service.list(B()), []);
  assert.deepEqual(await s.service.charges(B()), []);
  assert.equal((await s.service.get(A(), job.id)).status, 'queued', 'tenant A job untouched');
  // settle with the wrong workspace is refused too
  await assert.rejects(s.store.settle('ws-b', job.id, { owner: 'r1', leaseVersion: 1 }, { type: 'failed', stepIndex: 0, error: 'x' }, 0), code('not_found'));
  // a runner scoped to one workspace never claims another's work
  await s.service.enqueue(B(), { kind: 'demo' });
  const scoped = await s.runner.runDue({ workspaceId: 'ws-b' });
  assert.deepEqual(scoped.map((r) => r.workspaceId), ['ws-b']);
  await assert.rejects(s.service.enqueue({ ...A(), workspaceId: '' }, { kind: 'demo' }), code('invalid'));
});

test('pause stops a job; resume continues from the checkpoint', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(A(), { kind: 'demo' });
  await s.runner.runDue();
  const p = await s.service.pause(A(), job.id);
  assert.equal(p.status, 'paused');
  assert.deepEqual(await s.runner.runDue(), []);
  const r = await s.service.resume(A(), job.id);
  assert.equal(r.status, 'queued');
  await s.runner.drain();
  assert.deepEqual(s.calls, ['a', 'b', 'c']);
  await assert.rejects(s.service.pause(A(), job.id), code('bad_state'));
  await assert.rejects(s.service.resume(A(), job.id), code('bad_state'));
});

test('resume keeps a future run time (not due until runAt) and makes a time that passed while paused due now', async () => {
  const s = setup();
  const future = (await s.service.enqueue(A('future'), { kind: 'demo', runAt: s.clock.now() + 60 * 60_000 })).job;
  const soon = (await s.service.enqueue(A('soon'), { kind: 'demo', runAt: s.clock.now() + 5_000 })).job;
  await s.service.pause(A(), future.id);
  await s.service.pause(A(), soon.id);
  s.clock.advance(10_000); // `soon` came due while paused; `future` has not
  assert.equal((await s.service.resume(A(), future.id)).nextRunAt, future.nextRunAt, 'a future time is kept');
  assert.equal((await s.service.resume(A(), soon.id)).nextRunAt, s.clock.now(), 'a past time becomes due now');
  const ran = await s.runner.runDue();
  assert.deepEqual(ran.map((r) => r.jobId), [soon.id], 'only the job whose time came is run');
  s.clock.advance(60 * 60_000);
  assert.ok((await s.runner.runDue()).some((r) => r.jobId === future.id), 'the future job runs once its time is reached');
});

test('cancel stops a queued job and discards the result of a step already in flight', async () => {
  const s = setup();
  const queued = (await s.service.enqueue(A('q'), { kind: 'demo' })).job;
  await s.service.cancel(A(), queued.id);
  assert.deepEqual(await s.runner.runDue(), []);
  assert.equal((await s.service.cancel(A(), queued.id)).status, 'cancelled', 'cancelling twice is harmless');

  let release!: () => void;
  s.gates.set('a', new Promise<void>((r) => { release = r; }));
  const live = (await s.service.enqueue(A('live'), { kind: 'demo' })).job;
  const inflight = s.runner.runDue();
  await Promise.resolve();
  await s.service.cancel(A(), live.id);
  release();
  const [report] = await inflight;
  assert.equal(report.outcome, 'lost-lease');
  const j = await s.service.get(A(), live.id);
  assert.equal(j.status, 'cancelled');
  assert.equal(j.steps[0].output, null, 'the late result was not saved');
  assert.deepEqual(await s.runner.runDue(), []);
  await assert.rejects(s.service.cancel(A(), (await finished(s)).id), code('bad_state'));
});
test('AMP-048: pausing a job whose step is mid-flight never uses up an attempt, however often it happens', async () => {
  const s = setup({ maxAttempts: 3 });
  const job = (await s.service.enqueue(A('pr'), { kind: 'demo' })).job;
  for (let i = 0; i < 4; i++) {
    let release!: () => void;
    s.gates.set('a', new Promise<void>((r) => { release = r; }));
    const inflight = s.runner.runDue();
    await Promise.resolve();
    await s.service.pause(A(), job.id);
    release();
    const [report] = await inflight;
    assert.equal(report.outcome, 'lost-lease');
    const p = await s.service.get(A(), job.id);
    assert.equal(p.status, 'paused');
    assert.equal(p.steps[0].attempts, 0, `cycle ${i + 1}: the interrupted run did not count`);
    assert.equal(p.attempts, 0);
    await s.service.resume(A(), job.id);
  }
  s.gates.clear();
  await s.runner.drain();
  const done = await s.service.get(A(), job.id);
  assert.equal(done.status, 'succeeded', 'the job completes after the final resume');
});

test('AMP-048: real failures still use attempts and fail the job at max attempts', async () => {
  const s = setup({ maxAttempts: 3 });
  const job = (await s.service.enqueue(A('rf'), { kind: 'demo' })).job;
  s.failures.set('a', [temp(), temp(), temp()]);
  for (let i = 0; i < 6; i++) { await s.runner.runDue(); s.clock.advance(60_000); }
  const j = await s.service.get(A(), job.id);
  assert.equal(j.status, 'failed');
  assert.equal(j.steps[0].attempts, 3);
});

test('AMP-048: a crashed worker (expired lease) keeps its attempt when the area is paused, so repeated crashes still end in failed', async () => {
  const s = setup({ maxAttempts: 2, leaseMs: 1_000 });
  const { job } = await s.service.enqueue(A('crash'), { kind: 'demo' });
  await s.store.claim({ now: s.clock.now(), owner: 'dead-0', leaseMs: 1_000, limit: 1 });
  s.clock.advance(1_000);
  await s.service.pause(A(), job.id);
  await s.service.resume(A(), job.id);
  const p = await s.service.get(A(), job.id);
  assert.equal(p.steps[0].attempts, 1, 'the crashed run stays counted');
  assert.equal(p.attempts, 1);
  await s.store.claim({ now: s.clock.now(), owner: 'dead-1', leaseMs: 1_000, limit: 1 });
  s.clock.advance(1_000);
  await s.service.pause(A(), job.id);
  await s.service.resume(A(), job.id);
  const r = await s.runner.runDue();
  assert.equal(r[0].outcome, 'failed');
  assert.equal((await s.service.get(A(), job.id)).status, 'failed');
  assert.deepEqual(s.calls, [], 'the handler was not run a third time');
});

async function finished(s: ReturnType<typeof setup>) {
  const { job } = await s.service.enqueue(A('fin'), { kind: 'demo' });
  await s.runner.drain();
  return job;
}

test('tenant pause blocks only that tenant; resume and cancel-all work', async () => {
  const s = setup();
  const a = (await s.service.enqueue(A(), { kind: 'demo' })).job;
  const b = (await s.service.enqueue(B(), { kind: 'demo' })).job;
  await s.service.pauseTenant(A());
  await s.runner.drain();
  assert.equal((await s.service.get(A(), a.id)).steps[0].status, 'pending');
  assert.equal((await s.service.get(B(), b.id)).status, 'succeeded');
  await s.service.resumeTenant(A());
  await s.runner.drain();
  assert.equal((await s.service.get(A(), a.id)).status, 'succeeded');
  await s.service.enqueue(A('n1'), { kind: 'demo' });
  await s.service.enqueue(A('n2'), { kind: 'demo' });
  assert.equal(await s.service.cancelTenant(A()), 2, 'finished jobs are left alone');
  assert.equal(await s.service.cancelTenant(B()), 0);
  await s.runner.drain();
  assert.equal((await s.service.list(A())).filter((j) => j.status === 'cancelled').length, 2);
});

test('future runAt waits until due', async () => {
  const s = setup();
  await s.service.enqueue(A(), { kind: 'demo', runAt: s.clock.now() + 5_000 });
  assert.deepEqual(await s.runner.runDue(), []);
  s.clock.advance(5_000);
  assert.equal((await s.runner.runDue()).length, 1);
});

test('enqueue validates kind, input and key; a removed kind fails safely', async () => {
  const s = setup();
  await assert.rejects(s.service.enqueue(A(), { kind: 'nope' }), code('unknown_kind'));
  await assert.rejects(s.service.enqueue(A(), { kind: 'demo', input: { f: () => 1 } as unknown as JsonValue }), code('invalid'));
  await assert.rejects(s.service.enqueue(A(), { kind: 'demo', input: { big: 'x'.repeat(30_000) } }), code('invalid'));
  await assert.rejects(s.service.enqueue(ctxFor('ws-a', ''), { kind: 'demo' }), code('invalid'));
  await assert.rejects(s.service.enqueue(A(), { kind: 'demo', runAt: Number.NaN }), code('invalid'));
  assert.throws(() => createJobRegistry([{ kind: 'Bad Kind', steps: [{ name: 's', run: async () => ({ output: 1 }) }] }]), JobsError);
  assert.throws(() => createJobRegistry([{ kind: 'dup', steps: [{ name: 's', run: async () => ({ output: 1 }) }, { name: 's', run: async () => ({ output: 1 }) }] }]), JobsError);
  assert.throws(() => createJobRegistry([{ kind: 'empty', steps: [] }]), JobsError);
  // A job whose kind is missing from the runner's registry fails with a plain message instead of crashing the runner.
  const store = createMemoryJobStore();
  const withKind = createJobRegistry([{ kind: 'gone', steps: [{ name: 's', run: async () => ({ output: 1 }) }] }]);
  const svc = createJobService({ store, registry: withKind, now: () => 5 });
  const { job } = await svc.enqueue(A(), { kind: 'gone' });
  const r = await createJobRunner({ store, registry: createJobRegistry(), owner: 'r', now: () => 5 }).runDue();
  assert.equal(r[0].outcome, 'failed');
  assert.match((await svc.get(A(), job.id)).lastError ?? '', /no longer supported/);
});

test('a handler returning unsavable output fails the job instead of corrupting the checkpoint', async () => {
  const s = setup();
  s.registry.register({ kind: 'bad-output', steps: [{ name: 's', run: async () => ({ output: { fn: () => 1 } as unknown as JsonValue }) }] });
  const { job } = await s.service.enqueue(A(), { kind: 'bad-output' });
  await s.runner.drain();
  assert.equal((await s.service.get(A(), job.id)).status, 'failed');
});

test('returned jobs are copies: mutating them never changes the store', async () => {
  const s = setup();
  const { job } = await s.service.enqueue(A(), { kind: 'demo', input: { n: 1 } });
  job.status = 'succeeded';
  job.steps[0].status = 'succeeded';
  const fresh = await s.service.get(A(), job.id);
  assert.equal(fresh.status, 'queued');
  assert.equal(fresh.steps[0].status, 'pending');
});
