// AMP-063 slice 1 (P01): audit history, admin job recovery, recovery rate limit. Real job engine on its in-memory store.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuditLog, createMemoryAuditStore, createMemoryRecoveryStore, createOpsService, createRateLimiter, RECOVERY_LIMIT, RECOVERY_WINDOW_MS,
  boundedLimit, MAX_AUDIT_LIMIT, sanitizeMetadata, STUCK_AFTER_MS, type AuditStore, type OpsActor, type RefusalCode,
} from '../lib/aimp/ops/index.ts';
import { createJobRegistry, createJobRunner, createJobService, createMemoryJobStore, JobError, JobsError } from '../lib/aimp/jobs/index.ts';

const A = 'ws-a';
const B = 'ws-b';
const ownerA: OpsActor = { kind: 'owner', id: 'u-a', workspaceId: A };
const ownerB: OpsActor = { kind: 'owner', id: 'u-b', workspaceId: B };
const admin: OpsActor = { kind: 'admin', id: 'admin-1' };

function setup(opts: { limit?: number; auditStore?: AuditStore } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const effects: string[] = [];
  const failures = new Set<string>(); // step idempotency keys that must fail permanently once
  const registry = createJobRegistry([{
    kind: 'demo', maxAttempts: 2,
    steps: [
      { name: 'first', run: async (a) => { effects.push(a.idempotencyKey); return { output: { ok: true } }; } },
      { name: 'second', run: async (a) => {
        if (failures.delete(a.idempotencyKey)) throw new JobError('permanent', 'The provider refused the request.');
        effects.push(a.idempotencyKey); return { output: { ok: true } };
      } },
    ],
  }]);
  const store = createMemoryJobStore();
  let n = 0;
  const jobs = createJobService({ store, registry, now, newId: () => `job-${++n}` });
  const runner = createJobRunner({ store, registry, owner: 'r1', now });
  const auditStore = opts.auditStore ?? createMemoryAuditStore();
  let a = 0;
  const audit = createAuditLog({ store: auditStore, now, newId: () => `aud-${++a}` });
  const limiter = createRateLimiter({ now, limit: opts.limit ?? RECOVERY_LIMIT, windowMs: RECOVERY_WINDOW_MS });
  const knownWorkspaces = new Set([A, B]);
  const workspaceExists = async (w: string) => knownWorkspaces.has(w);
  const recoveries = createMemoryRecoveryStore();
  const ops = createOpsService({ jobs, audit, recoveries, limiter, workspaceExists, now });
  const ctx = (w: string, key: string, businessId?: string) => ({ workspaceId: w, ...(businessId ? { businessId } : {}), actorUserId: 'x', idempotencyKey: key });
  /** Enqueue a job whose second step fails permanently the first time, run it, and return its id. */
  async function failedJob(w: string, key: string, businessId?: string) {
    const { job } = await jobs.enqueue(ctx(w, key, businessId), { kind: 'demo' });
    failures.add(`${job.id}:second`);
    await runner.drain();
    assert.equal((await jobs.get(ctx(w, key), job.id)).status, 'failed');
    return job.id;
  }
  return { workspaceExists, ops, jobs, runner, audit, auditStore, limiter, effects, failures, failedJob, ctx, advance: (ms: number) => { t += ms; }, store };
}

const refusal = (r: { ok: boolean }): RefusalCode | undefined => (r as unknown as { code?: RefusalCode }).code;

test('P01 recovery: a failed job is re-queued through the engine, runs again, and nothing is done twice', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  assert.deepEqual(s.effects, [`${id}:first`]);
  const r = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.job.status, 'queued');
  await s.runner.drain();
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'succeeded');
  // The first step was not run again; the second ran once, with its stable key.
  assert.deepEqual(s.effects, [`${id}:first`, `${id}:second`]);
  // The job id and idempotency key are unchanged: no second job exists.
  assert.equal((await s.jobs.list(s.ctx(A, 'k'))).length, 1);
});

test('P01 recovery: recovering twice (sequential and concurrent) creates no second run', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  const [x, y] = await Promise.all([s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id }), s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id })]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.equal([x, y].filter((r) => !r.ok).map(refusal)[0], 'already_recovered');
  const again = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(refusal(again), 'already_recovered');
  await s.runner.drain();
  const third = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id }); // now succeeded
  assert.equal(refusal(third), 'already_recovered');
  assert.deepEqual(s.effects, [`${id}:first`, `${id}:second`]);
});

test('P01 recovery: a job that fails again can be recovered again', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id })).ok, true);
  s.failures.add(`${id}:second`); // fails permanently again when the engine runs it
  await s.runner.drain();
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'failed');
  const again = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(again.ok, true);
  await s.runner.drain();
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'succeeded');
  assert.deepEqual(s.effects, [`${id}:first`, `${id}:second`]);
});

test('P01 refusals: not found, other tenant answers the same, not recoverable, not permitted, reason required, invalid', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  const missing = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: 'nope' });
  const foreign = await s.ops.recoverJob(ownerB, { workspaceId: B, jobId: idA });
  assert.equal(refusal(missing), 'job_not_found');
  assert.equal(refusal(foreign), 'job_not_found');
  assert.equal((missing as { message: string }).message, (foreign as { message: string }).message);
  // The foreign attempt did not touch the job.
  assert.equal((await s.jobs.get(s.ctx(A, 'k'), idA)).status, 'failed');

  const { job: queued } = await s.jobs.enqueue(s.ctx(A, 'k2'), { kind: 'demo' });
  assert.equal(refusal(await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: queued.id })), 'not_recoverable');

  assert.equal(refusal(await s.ops.recoverJob(ownerB, { workspaceId: A, jobId: idA })), 'not_permitted');
  assert.equal(refusal(await s.ops.recoverJob({ kind: 'system', id: 'cron' }, { workspaceId: A, jobId: idA })), 'not_permitted');
  assert.equal(refusal(await s.ops.recoverJob(admin, { workspaceId: A, jobId: idA })), 'reason_required');
  assert.equal(refusal(await s.ops.recoverJob(admin, { workspaceId: A, jobId: idA, reason: '   ' })), 'reason_required');
  assert.equal(refusal(await s.ops.recoverJob(admin, { workspaceId: '', jobId: idA, reason: 'x' })), 'invalid');
  assert.equal(refusal(await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: '' })), 'invalid');
  // Still failed after every refusal.
  assert.equal((await s.jobs.get(s.ctx(A, 'k'), idA)).status, 'failed');
});

test('P01 recovery: a business-scoped request cannot reach another business job of the same workspace', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1', 'biz-1');
  assert.equal(refusal(await s.ops.recoverJob(ownerA, { workspaceId: A, businessId: 'biz-2', jobId: id })), 'job_not_found');
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, businessId: 'biz-1', jobId: id })).ok, true);
});

test('P01 admin: needs a reason, may act on any tenant, reason is stored redacted', async () => {
  const s = setup();
  const id = await s.failedJob(B, 'k1');
  const r = await s.ops.recoverJob(admin, { workspaceId: B, jobId: id, reason: 'Owner jane@example.com asked; token sk_live_abcdef1234' });
  assert.equal(r.ok, true);
  const entries = (await s.ops.readAudit(ownerB, { workspaceId: B }))
  assert.ok(entries.ok);
  if (!entries.ok) return;
  const e = entries.entries[0]!;
  assert.equal(e.actor.kind, 'admin');
  assert.equal(e.outcome, 'allowed');
  assert.ok(e.reason && !e.reason.includes('jane@example.com') && !e.reason.includes('sk_live_abcdef1234'));
});

test('P01 audit: every refusal writes one entry; a recovery writes an attempt entry and then its outcome', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: 'nope' });       // job_not_found
  await s.ops.recoverJob(admin, { workspaceId: A, jobId: id });             // reason_required
  await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });            // allowed
  await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });            // already_recovered
  const r = await s.ops.readAudit(ownerA, { workspaceId: A });
  assert.ok(r.ok);
  if (!r.ok) return;
  // The reason_required refusal is not written under the tenant (see the unattributed test below).
  assert.equal(r.entries.length, 4);
  assert.deepEqual(r.entries.map((e) => e.metadata.refusal ?? 'ok').reverse(), ['job_not_found', 'ok', 'ok', 'already_recovered']);
  assert.deepEqual(r.entries.map((e) => e.outcome).reverse(), ['refused', 'attempted', 'allowed', 'refused']);
  assert.ok(r.entries.every((e) => e.workspaceId === A && e.action === 'job.recover' && e.target.kind === 'job'));
  assert.equal(new Set(r.entries.map((e) => e.id)).size, 4);
  assert.ok(r.entries.every((e) => e.at === 1_000_000));
  const un = await s.ops.readUnattributedAudit(admin);
  assert.ok(un.ok && un.entries.length === 1 && un.entries[0]!.metadata.refusal === 'reason_required');
});

test('P01 audit: a refused cross-tenant owner attempt is written to the owner own history, not the victim', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  assert.equal(refusal(await s.ops.recoverJob(ownerB, { workspaceId: A, jobId: idA })), 'not_permitted');
  const a = await s.ops.readAudit(ownerA, { workspaceId: A });
  const b = await s.ops.readAudit(ownerB, { workspaceId: B });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.entries.length, 0);
  assert.equal(b.entries.length, 1);
  assert.equal(b.entries[0]!.metadata.refusal, 'not_permitted');
});

test('P01 audit: a reader for tenant A never sees tenant B, and an owner cannot read another tenant', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  const idB = await s.failedJob(B, 'k2');
  await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: idA });
  await s.ops.recoverJob(ownerB, { workspaceId: B, jobId: idB });
  const a = await s.ops.readAudit(ownerA, { workspaceId: A });
  assert.ok(a.ok);
  if (a.ok) { assert.equal(a.entries.length, 2); assert.ok(a.entries.every((e) => e.target.id === idA)); assert.ok(a.entries.every((e) => e.workspaceId === A)); }
  assert.equal(refusal(await s.ops.readAudit(ownerA, { workspaceId: B })), 'not_permitted');
  const direct = await s.audit.reader(A).list();
  assert.ok(direct.every((e) => e.workspaceId === A));
  assert.equal(JSON.stringify(direct).includes(idB), false);
});

test('P01 audit: entries cannot be changed or removed through the interface', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.deepEqual(Object.keys(s.auditStore).sort(), ['append', 'appendUnattributed', 'droppedUnattributed', 'list', 'listUnattributed']);
  const first = await s.audit.reader(A).list();
  assert.throws(() => { (first[0] as { outcome: string }).outcome = 'refused'; }, TypeError);
  assert.throws(() => { (first[0]!.metadata as Record<string, unknown>).statusAfter = 'x'; }, TypeError);
  const second = await s.audit.reader(A).list();
  assert.equal(second[0]!.outcome, 'allowed');
});

test('P01 audit: secret-looking and unknown metadata keys are dropped, values redacted, no free text kept', async () => {
  const clean = sanitizeMetadata({
    refusal: 'x', apiToken: 'abc', password: 'p', client_secret: 's', apiKey: 'k', Authorization: 'Bearer abcdefgh', jobKind: 'demo',
    email: 'a@b.co', note: 'free text about a person', retryAfterSeconds: 5, statusBefore: 'contact a@b.co now', nested: { a: 1 },
  });
  assert.deepEqual(Object.keys(clean).sort(), ['jobKind', 'refusal', 'retryAfterSeconds', 'statusBefore']);
  assert.equal(clean.statusBefore, 'contact [email] now');
  const s = setup();
  await s.audit.record({ tenant: { workspaceId: A }, actor: admin, action: 'job.list', target: { kind: 'tenant', id: A }, outcome: 'allowed', metadata: { password: 'hunter2', token: 'zzz', jobKind: 'demo' } });
  const [e] = await s.audit.reader(A).list();
  assert.deepEqual(e!.metadata, { jobKind: 'demo' });
  assert.equal(JSON.stringify(e).includes('hunter2'), false);
});

test('P01 audit: a failing audit store fails recovery closed (AMP-160 a) and the read-only list still answers', async () => {
  const broken: AuditStore = { append: async () => { throw new Error('down'); }, list: async () => [], appendUnattributed: async () => { throw new Error('down'); }, listUnattributed: async () => [] };
  const s = setup({ auditStore: broken });
  const id = await s.failedJob(A, 'k1');
  const r = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(refusal(r), 'unavailable');
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'failed');
  const l = await s.ops.listProblemJobs(ownerA, { workspaceId: A });
  assert.ok(l.ok);
  if (l.ok) { assert.equal(l.auditId, null); assert.equal(l.failed.length, 1); }
});

test('P01 list: failed and stuck jobs of ONE tenant only, no job input exposed', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  await s.failedJob(B, 'k2');
  const { job: overdue } = await s.jobs.enqueue(s.ctx(A, 'k3'), { kind: 'demo', input: { email: 'private@example.com' }, runAt: 1_000_000 + 10 });
  s.advance(STUCK_AFTER_MS + 1000);
  const r = await s.ops.listProblemJobs(ownerA, { workspaceId: A });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.failed.map((j) => j.id), [idA]);
  assert.deepEqual(r.stuck.map((j) => [j.id, j.stuckReason]), [[overdue.id, 'overdue']]);
  assert.equal(r.failed[0]!.failedStep, 'second');
  assert.equal(JSON.stringify(r).includes('private@example.com'), false);
  assert.equal(JSON.stringify(r).includes(B), false);
  const log = await s.ops.readAudit(ownerA, { workspaceId: A });
  assert.ok(log.ok && log.entries[0]!.action === 'job.list' && log.entries[0]!.metadata.failedCount === 1 && log.entries[0]!.metadata.stuckCount === 1);
});

test('P01 list: an expired lease is stuck; owner of another tenant and system are refused (and audited)', async () => {
  const s = setup();
  await s.jobs.enqueue(s.ctx(A, 'k1'), { kind: 'demo' });
  const claimed = await s.store.claim({ now: 1_000_000, owner: 'dead', leaseMs: 1000, limit: 5 });
  assert.equal(claimed.length, 1);
  s.advance(5000);
  const r = await s.ops.listProblemJobs(ownerA, { workspaceId: A });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.stuck.map((j) => j.stuckReason), ['lease_expired']);
  const denied = await s.ops.listProblemJobs(ownerB, { workspaceId: A });
  assert.equal(refusal(denied), 'not_permitted');
  assert.equal(refusal(await s.ops.listProblemJobs({ kind: 'system', id: 'c' }, { workspaceId: A })), 'not_permitted');
  assert.equal(refusal(await s.ops.listProblemJobs(admin, { workspaceId: A })), 'reason_required');
  const own = await s.ops.listProblemJobs(ownerB, { workspaceId: B });
  assert.ok(own.ok);
  if (own.ok) assert.deepEqual([own.failed, own.stuck], [[], []]);
});

test('P01 recovery: stuck (not failed) jobs are refused as not recoverable; the engine reclaims them itself', async () => {
  const s = setup();
  const { job } = await s.jobs.enqueue(s.ctx(A, 'k1'), { kind: 'demo' });
  await s.store.claim({ now: 1_000_000, owner: 'dead', leaseMs: 1000, limit: 5 });
  s.advance(5000);
  assert.equal(refusal(await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: job.id })), 'not_recoverable');
});

test('P01 rate limit: recovery is limited per tenant, with a retry-after, and audited', async () => {
  const s = setup({ limit: 3 });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await s.failedJob(A, `k${i}`));
  const idB = await s.failedJob(B, 'kb');
  for (let i = 0; i < 3; i++) assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[i]! })).ok, true);
  const limited = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[3]! });
  assert.equal(refusal(limited), 'rate_limited');
  assert.equal((limited as { retryAfterSeconds: number }).retryAfterSeconds, 60);
  assert.equal((await s.jobs.get(s.ctx(A, 'k'), ids[3]!)).status, 'failed');
  // Another tenant has its own counter.
  assert.equal((await s.ops.recoverJob(ownerB, { workspaceId: B, jobId: idB })).ok, true);
  // A stranger is refused before the limiter, so cannot use up the tenant's quota.
  s.advance(RECOVERY_WINDOW_MS);
  for (let i = 0; i < 5; i++) assert.equal(refusal(await s.ops.recoverJob(ownerB, { workspaceId: A, jobId: ids[3]! })), 'not_permitted');
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[3]! })).ok, true);
  const log = await s.ops.readAudit(ownerA, { workspaceId: A });
  assert.ok(log.ok && log.entries.some((e) => e.metadata.refusal === 'rate_limited' && e.metadata.retryAfterSeconds === 60));
});

test('P01 rate limit: a duplicate in-flight recovery of the same job spends no counter', async () => {
  const s = setup({ limit: 3 });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await s.failedJob(A, `k${i}`));
  const first = s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[0]! });
  const dup = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[0]! });
  assert.equal(refusal(dup), 'already_recovered');
  assert.equal((await first).ok, true);
  // One counter spent so far: two more recoveries still fit in the limit of 3, the next is limited.
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[1]! })).ok, true);
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[2]! })).ok, true);
  assert.equal(refusal(await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: ids[3]! })), 'rate_limited');
});

test('P01 limiter: window roll-over, per-tenant and per-action separation, memory bound', () => {
  let t = 0;
  const l = createRateLimiter({ now: () => t, limit: 2, windowMs: 1000, maxKeys: 3 });
  assert.deepEqual(l.check('a', 'x'), { ok: true, remaining: 1 });
  assert.deepEqual(l.check('a', 'x'), { ok: true, remaining: 0 });
  t = 400;
  assert.deepEqual(l.check('a', 'x'), { ok: false, retryAfterSeconds: 1 });
  assert.equal(l.check('b', 'x').ok, true);
  assert.equal(l.check('a', 'y').ok, true);
  t = 1000; // window of ('a','x') started at 0: rolled over
  assert.equal(l.check('a', 'x').ok, true);
  // memory bound: many tenants never exceed maxKeys, and expired windows are dropped
  for (let i = 0; i < 50; i++) l.check(`t${i}`, 'x');
  assert.ok(l.size() <= 3);
  t = 10_000;
  l.check('z', 'x');
  assert.equal(l.size(), 1);
});

test('P01 limiter: a clock that goes backwards does not reset the window or the quota', () => {
  let t = 5000;
  const l = createRateLimiter({ now: () => t, limit: 2, windowMs: 1000 });
  assert.equal(l.check('a', 'x').ok, true);
  assert.equal(l.check('a', 'x').ok, true);
  t = 100; // clock stepped back
  const r = l.check('a', 'x');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.retryAfterSeconds >= 1 && r.retryAfterSeconds <= 1);
  t = 6000; // forward past the original window: fresh quota
  assert.equal(l.check('a', 'x').ok, true);
});

test('P01 limit: NaN, a string, Infinity, 0 and negatives never return an unbounded or empty page', async () => {
  assert.equal(boundedLimit(Number.NaN), 50);
  assert.equal(boundedLimit('abc' as unknown as number), 50);
  assert.equal(boundedLimit(Infinity), 50);
  assert.equal(boundedLimit(-Infinity), 50);
  assert.equal(boundedLimit(0), 1);
  assert.equal(boundedLimit(-5), 1);
  assert.equal(boundedLimit(2.9), 2);
  assert.equal(boundedLimit(10_000), MAX_AUDIT_LIMIT);
  const s = setup();
  for (let i = 0; i < 260; i++) await s.audit.record({ tenant: { workspaceId: A }, actor: ownerA, action: 'job.list', target: { kind: 'tenant', id: A }, outcome: 'allowed' });
  const len = async (limit: unknown) => { const r = await s.ops.readAudit(ownerA, { workspaceId: A, limit: limit as number }); assert.ok(r.ok); return r.ok ? r.entries.length : -1; };
  assert.equal(await len(Number.NaN), 50);
  assert.equal(await len('abc'), 50);
  assert.equal(await len(Infinity), 50);
  assert.equal(await len(undefined), 50);
  assert.equal(await len(0), 1);
  assert.equal(await len(-3), 1);
  assert.equal(await len(100_000), 200);
  // The store itself is bounded even if called directly with a bad limit.
  assert.equal((await s.auditStore.list(A, { limit: Number.NaN })).length, 50);
  assert.equal((await s.auditStore.list(A, { limit: Infinity })).length, 50);
  assert.equal((await s.auditStore.listUnattributed(Number.NaN)).length, 0);
});

test('P01 audit: an email-shaped job id or actor id is not stored', async () => {
  const s = setup();
  const r = await s.ops.recoverJob(admin, { workspaceId: A, jobId: 'jane.doe@example.com', reason: 'check' });
  assert.equal(refusal(r), 'job_not_found');
  await s.audit.record({ tenant: { workspaceId: A }, actor: { kind: 'admin', id: 'bob@example.com' }, action: 'job.list', target: { kind: 'tenant', id: A }, outcome: 'allowed' });
  const [newer, older] = await s.audit.reader(A).list();
  const dump = JSON.stringify([newer, older]);
  assert.equal(dump.includes('@example.com'), false);
  assert.equal(older!.target.id, '[email]');
  assert.equal(newer!.actor.id, '[email]');
});

test('P01 audit: system and no-reason-admin refusals never create history under a named workspace, and the unattributed list is bounded', async () => {
  const auditStore = createMemoryAuditStore({ maxUnattributed: 3 });
  const s = setup({ auditStore });
  for (let i = 0; i < 5; i++) {
    const r = await s.ops.recoverJob({ kind: 'system', id: 'cron' }, { workspaceId: `ghost-${i}`, jobId: 'j' });
    assert.equal(refusal(r), 'not_permitted');
    assert.equal((r as { auditId: string | null }).auditId, i < 3 ? `aud-${i + 1}` : null);
  }
  const nonReason = await s.ops.listProblemJobs(admin, { workspaceId: 'ghost-9' });
  assert.equal(refusal(nonReason), 'reason_required');
  assert.equal(auditStore.droppedUnattributed(), 3);
  for (let i = 0; i < 5; i++) assert.deepEqual(await auditStore.list(`ghost-${i}`, { limit: 10 }), []);
  assert.deepEqual(await auditStore.list('ghost-9', { limit: 10 }), []);
  const un = await s.ops.readUnattributedAudit(admin);
  assert.ok(un.ok);
  if (un.ok) { assert.equal(un.entries.length, 3); assert.deepEqual(un.entries.map((e) => e.id), ['aud-3', 'aud-2', 'aud-1']); }
  // Only an admin may read it.
  assert.equal(refusal(await s.ops.readUnattributedAudit(ownerA)), 'not_permitted');
  assert.equal(refusal(await s.ops.readUnattributedAudit({ kind: 'system', id: 'c' })), 'not_permitted');
});

test('P01 recovery: a bad_state from retry releases the in-flight guard, so a later recovery still works', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  let armed = true;
  const flaky = { ...s.jobs, retry: async (...a: Parameters<typeof s.jobs.retry>) => { if (armed) { armed = false; throw new JobsError('bad_state', 'raced'); } return s.jobs.retry(...a); } };
  const ops = createOpsService({ jobs: flaky, audit: s.audit, recoveries: createMemoryRecoveryStore(), limiter: s.limiter, workspaceExists: s.workspaceExists, now: () => 1_000_000 });
  assert.equal(refusal(await ops.recoverJob(ownerA, { workspaceId: A, jobId: id })), 'not_recoverable');
  assert.equal((await ops.recoverJob(ownerA, { workspaceId: A, jobId: id })).ok, true);
});

test('P01 audit: the businessId filter on readAudit returns only that business', async () => {
  const s = setup();
  const id1 = await s.failedJob(A, 'k1', 'biz-1');
  const id2 = await s.failedJob(A, 'k2', 'biz-2');
  await s.ops.recoverJob(ownerA, { workspaceId: A, businessId: 'biz-1', jobId: id1 });
  await s.ops.recoverJob(ownerA, { workspaceId: A, businessId: 'biz-2', jobId: id2 });
  const all = await s.ops.readAudit(ownerA, { workspaceId: A });
  const one = await s.ops.readAudit(ownerA, { workspaceId: A, businessId: 'biz-1' });
  assert.ok(all.ok && one.ok);
  if (all.ok && one.ok) {
    assert.equal(all.entries.length, 4);
    assert.deepEqual(one.entries.map((e) => [e.businessId, e.target.id]), [['biz-1', id1], ['biz-1', id1]]);
  }
});

// AMP-160 (P01 review fixes a, b, c)
function wrappedAuditStore() {
  const inner = createMemoryAuditStore();
  type Hook<T> = (e: { outcome: string }) => T;
  const state: { failAppend: Hook<boolean>; onAppend: Hook<Promise<void>> } = { failAppend: () => false, onAppend: () => Promise.resolve() };
  const store: AuditStore = {
    ...inner,
    async append(e) {
      await state.onAppend(e);
      if (state.failAppend(e)) throw new Error('audit store down');
      return inner.append(e);
    },
  };
  return { store, state };
}

test('P01 AMP-160 a: when the attempt entry cannot be stored, nothing is recovered and the job is untouched', async () => {
  const w = wrappedAuditStore();
  const s = setup({ auditStore: w.store });
  const id = await s.failedJob(A, 'k1');
  w.state.failAppend = () => true;
  const r = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(refusal(r), 'unavailable');
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'failed');
  await s.runner.drain();
  assert.deepEqual(s.effects, [`${id}:first`]);
  // Once the store is back, the same job can still be recovered, once.
  w.state.failAppend = () => false;
  assert.equal((await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id })).ok, true);
  await s.runner.drain();
  assert.deepEqual(s.effects, [`${id}:first`, `${id}:second`]);
});

test('P01 AMP-160 b: the attempt entry is stored before the retry runs, the outcome after, and no step runs twice', async () => {
  const w = wrappedAuditStore();
  const s = setup({ auditStore: w.store });
  const id = await s.failedJob(A, 'k1');
  const statusWhenWritten: string[] = [];
  w.state.onAppend = async (e) => { statusWhenWritten.push(`${e.outcome}:${(await s.jobs.get(s.ctx(A, 'k1'), id)).status}`); };
  const r = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.equal(r.ok, true);
  assert.deepEqual(statusWhenWritten, ['attempted:failed', 'allowed:queued']);
  await s.runner.drain();
  assert.deepEqual(s.effects, [`${id}:first`, `${id}:second`]);
  assert.equal(r.ok && r.auditId !== null, true);
});

test('P01 AMP-160 b: if only the outcome entry fails after the retry, the call still succeeds and points at the attempt entry', async () => {
  const w = wrappedAuditStore();
  const s = setup({ auditStore: w.store });
  const id = await s.failedJob(A, 'k1');
  w.state.failAppend = (e) => e.outcome === 'allowed';
  const r = await s.ops.recoverJob(ownerA, { workspaceId: A, jobId: id });
  assert.ok(r.ok);
  const list = await s.auditStore.list(A, { limit: 10 });
  assert.deepEqual(list.map((e) => e.outcome), ['attempted']);
  if (r.ok) assert.equal(r.auditId, list[0]!.id);
});

test('P01 AMP-160 c: an admin naming a workspace that does not exist gets the same refusal as a missing job and no history is created', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  const missingJob = await s.ops.recoverJob(admin, { workspaceId: A, jobId: 'nope', reason: 'checking' });
  const ghost = await s.ops.recoverJob(admin, { workspaceId: 'ghost-ws', jobId: idA, reason: 'checking' });
  const ghostList = await s.ops.listProblemJobs(admin, { workspaceId: 'ghost-ws', reason: 'checking' });
  assert.equal(refusal(missingJob), 'job_not_found');
  assert.equal(refusal(ghost), 'job_not_found');
  assert.ok(ghostList.ok, 'AMP-163: the admin list for a missing workspace is an ok empty list, see the AMP-163 test');
  if (ghostList.ok) {
    assert.deepEqual(ghostList.failed, []);
    assert.deepEqual(ghostList.stuck, []);
  }
  // The job.list entry is in the unattributed list, not under any tenant.
  const unAfterList = await s.ops.readUnattributedAudit(admin);
  assert.ok(unAfterList.ok && unAfterList.entries.some((e) => e.action === 'job.list'));
  assert.equal((await s.auditStore.list(A, { limit: 50 })).some((e) => e.action === 'job.list'), false);
  assert.equal((ghost as { message: string }).message, (missingJob as { message: string }).message);
  assert.deepEqual(await s.auditStore.list('ghost-ws', { limit: 50 }), []);
  assert.equal(((await s.ops.readAudit(admin, { workspaceId: 'ghost-ws' })) as { entries: unknown[] }).entries.length, 0);
  // The refusals are only in the bounded unattributed list, and no rate-limit counter was spent on the missing workspace.
  const un = await s.ops.readUnattributedAudit(admin);
  assert.ok(un.ok && un.entries.length === 2 && un.entries.filter((e) => e.metadata.refusal === 'job_not_found').length === 1);
  assert.equal(s.limiter.size(), 1); // AMP-162: one counter, the admin's own, for both the real and the missing workspace
});

test('P01 AMP-163: after an admin list on a missing workspace, readAudit for that id is ok with no entries (documented)', async () => {
  const s = setup();
  const l = await s.ops.listProblemJobs(admin, { workspaceId: 'ghost-ws', reason: 'checking' });
  assert.ok(l.ok);
  const a = await s.ops.readAudit(admin, { workspaceId: 'ghost-ws' });
  assert.ok(a.ok);
  if (a.ok) assert.equal(a.entries.length, 0);
  // The audit store itself holds nothing under the missing workspace id (the entry went to the unattributed list only).
  assert.deepEqual(await s.auditStore.list('ghost-ws', { limit: 200 }), []);
  assert.equal((await s.auditStore.listUnattributed(200)).length, 1);
});

test('AMP-162: an admin cannot tell an existing workspace from a missing one through the rate-limit counter', async () => {
  const s = setup({ limit: 3 });
  const idA = await s.failedJob(A, 'k1');
  // Alternate a missing and an existing workspace: they spend the SAME admin counter, so both hit the limit at the same call.
  const seen: Array<[string, string | undefined]> = [];
  for (let i = 0; i < 5; i++) {
    const ws = i % 2 === 0 ? 'ghost-ws' : A;
    const r = await s.ops.recoverJob(admin, { workspaceId: ws, jobId: i % 2 === 0 ? idA : 'nope', reason: 'checking' });
    seen.push([ws, refusal(r)]);
  }
  assert.deepEqual(seen.map(([, c]) => c), ['job_not_found', 'job_not_found', 'job_not_found', 'rate_limited', 'rate_limited']);
  // Once limited, a missing and an existing workspace answer the same, including the retry-after.
  const g = await s.ops.recoverJob(admin, { workspaceId: 'ghost-ws', jobId: idA, reason: 'checking' });
  const e = await s.ops.recoverJob(admin, { workspaceId: A, jobId: idA, reason: 'checking' });
  assert.deepEqual(g, e);
  assert.equal(s.limiter.size(), 1, 'no per-workspace counter exists for the admin');
  // The job was never touched by a limited call.
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), idA)).status, 'failed');
  // Another admin has their own counter (the limit is per admin, not per workspace).
  const other = await s.ops.recoverJob({ kind: 'admin', id: 'admin-2' }, { workspaceId: 'ghost-ws', jobId: idA, reason: 'checking' });
  assert.equal(refusal(other), 'job_not_found');
});

test('AMP-162: an admin cannot tell an existing workspace from a missing one through the audit id', async () => {
  const s = setup();
  const idA = await s.failedJob(A, 'k1');
  const results = [
    await s.ops.recoverJob(admin, { workspaceId: A, jobId: 'nope', reason: 'checking' }),
    await s.ops.recoverJob(admin, { workspaceId: 'ghost-ws', jobId: idA, reason: 'checking' }),
  ];
  for (const r of results) { assert.equal(refusal(r), 'job_not_found'); assert.equal((r as { auditId: string | null }).auditId, null); }
  // The entries are still written: the existing workspace's own history has its row, the missing one has none and the unattributed list has its row.
  assert.equal((await s.auditStore.list(A, { limit: 10 })).length, 1);
  assert.deepEqual(await s.auditStore.list('ghost-ws', { limit: 10 }), []);
  const un = await s.ops.readUnattributedAudit(admin);
  assert.ok(un.ok && un.entries.length === 1);
  // A full unattributed list cannot show up as a different answer either (the id is hidden, so null is the same as a stored id).
  const small = setup();
  const small2 = createOpsService({ jobs: small.jobs, audit: createAuditLog({ store: createMemoryAuditStore({ maxUnattributed: 0 }), now: () => 1 }), recoveries: createMemoryRecoveryStore(), limiter: small.limiter, workspaceExists: small.workspaceExists, now: () => 1 });
  const full = await small2.recoverJob(admin, { workspaceId: 'ghost-ws', jobId: 'x', reason: 'checking' });
  assert.equal(refusal(full), 'job_not_found');
  assert.equal((full as { auditId: string | null }).auditId, null);
  // Success still returns the id: only an existing workspace can succeed, so it tells nothing.
  const ok = await s.ops.recoverJob(admin, { workspaceId: A, jobId: idA, reason: 'checking' });
  assert.ok(ok.ok && ok.auditId);
});

test('AMP-162: admin reads fail closed when the audit entry or the permission lookup cannot be read', async () => {
  const broken: AuditStore = { append: async () => { throw new Error('down'); }, list: async () => [], appendUnattributed: async () => { throw new Error('down'); }, listUnattributed: async () => [] };
  const s = setup({ auditStore: broken });
  await s.failedJob(A, 'k1');
  // An admin list with no durable audit entry returns NOTHING (an owner of that workspace still gets theirs, see the AMP-160 test above).
  const l = await s.ops.listProblemJobs(admin, { workspaceId: A, reason: 'checking' });
  assert.equal(refusal(l), 'unavailable');
  assert.equal('failed' in l, false);
  assert.equal('stuck' in l, false);
  // The audit read: if the existence lookup throws, the admin read is refused instead of answering "no entries".
  const good = setup();
  const throwing = createOpsService({ jobs: good.jobs, audit: good.audit, recoveries: createMemoryRecoveryStore(), limiter: good.limiter, now: () => 1_000_000, workspaceExists: async () => { throw new Error('lookup down'); } });
  assert.equal(refusal(await throwing.readAudit(admin, { workspaceId: A })), 'unavailable');
  // AMP-163: a throwing lookup is an outage: the admin list fails closed with `unavailable`, never an empty ok list.
  const thrownList = await throwing.listProblemJobs(admin, { workspaceId: A, reason: 'x' });
  assert.equal(refusal(thrownList), 'unavailable');
  assert.equal('failed' in thrownList, false);
  // With the lookup working, the same admin read answers.
  assert.ok((await good.ops.readAudit(admin, { workspaceId: A })).ok);
  // And an audit store that cannot be read refuses the audit read.
  const unreadable: AuditStore = { ...broken, list: async () => { throw new Error('down'); } };
  assert.equal(refusal(await setup({ auditStore: unreadable }).ops.readAudit(admin, { workspaceId: A })), 'unavailable');
});

test('P01 AMP-160 c: a workspace check that throws counts as "does not exist"', async () => {
  const s = setup();
  const id = await s.failedJob(A, 'k1');
  const ops = createOpsService({
    jobs: s.jobs, audit: s.audit, recoveries: createMemoryRecoveryStore(), limiter: s.limiter, now: () => 1_000_000,
    workspaceExists: async () => { throw new Error('lookup down'); },
  });
  assert.equal(refusal(await ops.recoverJob(admin, { workspaceId: A, jobId: id, reason: 'x' })), 'job_not_found');
  assert.equal((await s.jobs.get(s.ctx(A, 'k1'), id)).status, 'failed');
});

test('AMP-163: an admin list for a missing workspace answers like an existing workspace with no problem jobs', async () => {
  const s = setup();
  const existing = await s.ops.listProblemJobs(admin, { workspaceId: A, reason: 'checking' });
  const ghost = await s.ops.listProblemJobs(admin, { workspaceId: 'ghost-ws', reason: 'checking' });
  assert.ok(existing.ok && ghost.ok);
  if (!existing.ok || !ghost.ok) return;
  assert.deepEqual({ ...ghost, auditId: null }, { ...existing, auditId: null });
  assert.ok(existing.auditId && ghost.auditId, 'both return an audit id');
  // The ghost entry is in the unattributed list only; the missing workspace has no history of its own.
  assert.deepEqual(await s.auditStore.list('ghost-ws', { limit: 10 }), []);
  const un = await s.ops.readUnattributedAudit(admin);
  assert.ok(un.ok && un.entries.length === 1);
});

test('AMP-163: an admin audit read of a missing workspace is an empty history, the same shape as an existing one with none', async () => {
  const s = setup();
  const existing = await s.ops.readAudit(admin, { workspaceId: B });
  const ghost = await s.ops.readAudit(admin, { workspaceId: 'ghost-ws' });
  assert.deepEqual(ghost, existing);
  assert.deepEqual(ghost, { ok: true, entries: [] });
  // The audit store is not read for a missing workspace.
  const reads: string[] = [];
  const store = createMemoryAuditStore();
  const spy: AuditStore = { ...store, list: async (w, o) => { reads.push(w); return store.list(w, o); } };
  const t = setup({ auditStore: spy });
  await t.ops.readAudit(admin, { workspaceId: 'ghost-ws' });
  assert.deepEqual(reads, []);
});
