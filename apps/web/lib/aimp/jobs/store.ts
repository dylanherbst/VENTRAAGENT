// JobStore: persistence boundary for durable jobs, plus the in-memory implementation used by tests and the demo page.
//
// PROPOSED TABLES (no migration in AMP-060; a later task adds them to supabase/migrations). The AMP-003 migration
// (202611140001_aimp_commerce_core.sql) has no jobs table, so nothing here matches an existing column set.
//
//   create table public.aimp_jobs (
//     id               uuid primary key default gen_random_uuid(),
//     workspace_id     uuid not null references public.workspaces(id) on delete cascade,
//     business_id      uuid,                      -- composite FK below: a job can only point at a business of its own workspace
//     kind            text not null check (kind ~ '^[a-z][a-z0-9-]{1,40}$'),
//     idempotency_key  text not null check (char_length(idempotency_key) between 1 and 200),
//     input_hash       text not null,
//     input            jsonb not null default '{}',
//     status           text not null check (status in ('queued','running','waiting-retry','succeeded','failed','cancelled','paused')),
//     steps            jsonb not null,            -- [{name,status,attempts,costMinor,output,error,finishedAt}] in order
//     max_attempts     int  not null default 5 check (max_attempts between 1 and 20),
//     attempts         int  not null default 0,
//     next_run_at      timestamptz not null default now(),
//     last_error       text,                      -- safe message only
//     lease_owner      text,
//     lease_expires_at timestamptz,
//     lease_version    int  not null default 0,
//     created_at       timestamptz not null default now(),
//     updated_at       timestamptz not null default now(),
//     -- business_id is nullable and nulls are distinct in a plain unique constraint, so use a unique index that treats null as one value:
//     --   create unique index aimp_jobs_idem on public.aimp_jobs (workspace_id, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, idempotency_key);
//     -- (or declare it `unique nulls not distinct (workspace_id, business_id, kind, idempotency_key)` on Postgres 15+)
//     unique nulls not distinct (workspace_id, business_id, kind, idempotency_key),
//     unique (workspace_id, id),                  -- target of the composite foreign keys below
//     foreign key (workspace_id, business_id) references public.aimp_businesses (workspace_id, id)   -- needs unique (workspace_id, id) there too
//   );
//   create index aimp_jobs_due on public.aimp_jobs (next_run_at) where status in ('queued','waiting-retry');
//   create index aimp_jobs_leases on public.aimp_jobs (lease_expires_at) where status = 'running';   -- reclaiming dead workers
//
//   create table public.aimp_job_charges (       -- usage ledger; the primary key is what makes a charge happen once
//     id           text primary key,             -- '<job id>:<step name>'
//     workspace_id uuid not null,
//     job_id       uuid not null,
//     step_name    text not null,
//     amount_minor bigint not null check (amount_minor > 0),
//     at           timestamptz not null default now(),
//     unique (workspace_id, job_id, step_name),
//     foreign key (workspace_id, job_id) references public.aimp_jobs (workspace_id, id) on delete restrict   -- billing rows outlive a deleted job on purpose
//   );
//
//   create table public.aimp_job_tenant_pauses (workspace_id uuid primary key references public.workspaces(id) on delete cascade, paused_at timestamptz not null default now());
//
//   RLS: enable on all three; owners may select their workspace rows; there are no client write policies.
//   claim() and settle() are SECURITY DEFINER plpgsql functions with `set search_path = ''` (schema-qualified names), granted to
//   service_role only, and every statement filters by workspace_id:
//   - claim(owner, lease_ms, limit, workspace_id default null): UPDATE ... WHERE id IN (SELECT id FROM public.aimp_jobs j
//     WHERE <due or running-with-expired-lease> AND NOT EXISTS (select 1 from public.aimp_job_tenant_pauses p where p.workspace_id = j.workspace_id)
//     [AND j.workspace_id = $ws] ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $n) RETURNING *, bumping lease_version.
//   - settle(workspace_id, job_id, owner, lease_version, outcome jsonb): UPDATE ... WHERE workspace_id = $1 AND id = $2 AND
//     lease_owner = $3 AND lease_version = $4 AND status = 'running'; the charge row (ON CONFLICT DO NOTHING) is inserted in the
//     same transaction as the step checkpoint. Zero rows updated = lease lost (returns null).
//   Pausing, cancelling or pausing a tenant does NOT stop a step already running; its late result is discarded at settle and its
//   external effect may still have happened, which is why handlers must be idempotent on the step key.
import { JobsError, safeText, terminalStatuses } from './types.ts';
import type { ChargeEntry, JobKind, JobRecord, JobStatus, JobStep, JsonValue } from './types.ts';

export interface NewJob {
  id: string;
  workspaceId: string;
  businessId: string | null;
  kind: JobKind;
  idempotencyKey: string;
  inputHash: string;
  input: JsonValue;
  stepNames: { name: string; costMinor: number }[];
  maxAttempts: number;
  nextRunAt: number;
  now: number;
}

export interface ClaimOptions { now: number; owner: string; leaseMs: number; limit: number; workspaceId?: string }
export interface Claim { job: JobRecord; stepIndex: number }
export interface ClaimToken { owner: string; leaseVersion: number }

export type SettleOutcome =
  | { type: 'succeeded'; stepIndex: number; output: JsonValue; costMinor: number }
  | { type: 'retry'; stepIndex: number; error: string; nextRunAt: number }
  | { type: 'failed'; stepIndex: number; error: string }
  /** Usage guard said no: park the job without consuming the attempt. */
  | { type: 'paused'; stepIndex: number; error: string };

export interface JobStore {
  /** Creates the job, or returns the existing one for the same workspace + business + kind + key (created: false). */
  enqueue(job: NewJob): Promise<{ job: JobRecord; created: boolean }>;
  get(workspaceId: string, id: string): Promise<JobRecord>;
  list(workspaceId: string): Promise<JobRecord[]>;
  /** Atomically leases due jobs (also running jobs whose lease expired) and marks their next incomplete step running. */
  claim(opts: ClaimOptions): Promise<Claim[]>;
  /** Applies a step outcome only if the claim is still current. Returns null when the lease was lost (cancel, pause, reclaim). */
  settle(workspaceId: string, id: string, token: ClaimToken, outcome: SettleOutcome, now: number): Promise<JobRecord | null>;
  pause(workspaceId: string, id: string, now: number): Promise<JobRecord>;
  resume(workspaceId: string, id: string, now: number): Promise<JobRecord>;
  cancel(workspaceId: string, id: string, now: number): Promise<JobRecord>;
  /** Failed job only: the failed step gets a fresh attempt budget and the job runs again from that step. Completed steps stay done. */
  retry(workspaceId: string, id: string, now: number): Promise<JobRecord>;
  setTenantPaused(workspaceId: string, paused: boolean): Promise<void>;
  isTenantPaused(workspaceId: string): Promise<boolean>;
  /** Cancels every job of the tenant that is not finished. Returns how many changed. */
  cancelAll(workspaceId: string, now: number): Promise<number>;
  charges(workspaceId: string): Promise<ChargeEntry[]>;
}

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryJobStore(): JobStore {
  const jobs = new Map<string, JobRecord>();
  const byKey = new Map<string, string>();
  const ledger = new Map<string, ChargeEntry>();
  const pausedTenants = new Set<string>();
  const keyOf = (w: string, b: string | null, k: string, i: string) => JSON.stringify([w, b, k, i]);
  // Every method below is synchronous inside, so each is atomic within one JS context (two runners cannot interleave a claim).
  const own = (workspaceId: string, id: string): JobRecord => {
    const j = jobs.get(id);
    if (!j || j.workspaceId !== workspaceId) throw new JobsError('not_found', 'Job not found.');
    return j;
  };
  const touch = (j: JobRecord, now: number) => { j.updatedAt = now; };
  const release = (j: JobRecord) => { j.leaseOwner = null; j.leaseExpiresAt = null; };
  const resetRunningStep = (j: JobRecord) => { for (const s of j.steps) if (s.status === 'running') s.status = 'pending'; };

  return {
    async enqueue(n) {
      const k = keyOf(n.workspaceId, n.businessId, n.kind, n.idempotencyKey);
      const existingId = byKey.get(k);
      if (existingId) {
        const e = jobs.get(existingId)!;
        if (e.inputHash !== n.inputHash) throw new JobsError('conflict', 'That idempotency key was already used with different input.');
        return { job: clone(e), created: false };
      }
      const steps: JobStep[] = n.stepNames.map((s) => ({ name: s.name, status: 'pending', attempts: 0, costMinor: s.costMinor, output: null, error: null, finishedAt: null }));
      const job: JobRecord = {
        id: n.id, workspaceId: n.workspaceId, businessId: n.businessId, kind: n.kind, idempotencyKey: n.idempotencyKey, inputHash: n.inputHash,
        input: clone(n.input), status: 'queued', steps, maxAttempts: n.maxAttempts, attempts: 0, nextRunAt: n.nextRunAt, lastError: null,
        leaseOwner: null, leaseExpiresAt: null, leaseVersion: 0, createdAt: n.now, updatedAt: n.now,
      };
      jobs.set(job.id, job);
      byKey.set(k, job.id);
      return { job: clone(job), created: true };
    },
    async get(w, id) { return clone(own(w, id)); },
    async list(w) { return [...jobs.values()].filter((j) => j.workspaceId === w).map(clone).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)); },

    async claim(o) {
      const due = [...jobs.values()].filter((j) => {
        if (o.workspaceId && j.workspaceId !== o.workspaceId) return false;
        if (pausedTenants.has(j.workspaceId)) return false;
        if (j.status === 'queued' || j.status === 'waiting-retry') return j.nextRunAt <= o.now;
        return j.status === 'running' && j.leaseExpiresAt !== null && j.leaseExpiresAt <= o.now;
      }).sort((a, b) => a.nextRunAt - b.nextRunAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const out: Claim[] = [];
      for (const j of due.slice(0, Math.max(0, o.limit))) {
        const idx = j.steps.findIndex((s) => s.status !== 'succeeded');
        if (idx < 0) { j.status = 'succeeded'; release(j); touch(j, o.now); continue; }
        resetRunningStep(j);
        j.status = 'running'; j.leaseOwner = o.owner; j.leaseExpiresAt = o.now + o.leaseMs; j.leaseVersion += 1;
        j.attempts += 1; j.steps[idx].status = 'running'; j.steps[idx].attempts += 1;
        touch(j, o.now);
        out.push({ job: clone(j), stepIndex: idx });
      }
      return out;
    },

    async settle(w, id, token, outcome, now) {
      const j = own(w, id);
      if (j.status !== 'running' || j.leaseOwner !== token.owner || j.leaseVersion !== token.leaseVersion) return null;
      const step = j.steps[outcome.stepIndex];
      if (!step || step.status !== 'running') return null;
      release(j); touch(j, now);
      if (outcome.type === 'succeeded') {
        step.status = 'succeeded'; step.output = clone(outcome.output); step.error = null; step.finishedAt = now;
        if (outcome.costMinor > 0) {
          const cid = `${j.id}:${step.name}`;
          if (!ledger.has(cid)) ledger.set(cid, { id: cid, workspaceId: j.workspaceId, jobId: j.id, stepName: step.name, amountMinor: outcome.costMinor, at: now });
        }
        j.lastError = null;
        if (j.steps.every((s) => s.status === 'succeeded')) j.status = 'succeeded';
        else { j.status = 'queued'; j.nextRunAt = now; }
      } else if (outcome.type === 'retry') {
        step.status = 'pending'; step.error = safeText(outcome.error); j.lastError = step.error; j.status = 'waiting-retry'; j.nextRunAt = outcome.nextRunAt;
      } else if (outcome.type === 'failed') {
        step.status = 'failed'; step.error = safeText(outcome.error); j.lastError = step.error; j.status = 'failed';
      } else {
        step.status = 'pending'; step.attempts = Math.max(0, step.attempts - 1); j.attempts = Math.max(0, j.attempts - 1);
        j.lastError = safeText(outcome.error); j.status = 'paused';
      }
      return clone(j);
    },

    async pause(w, id, now) {
      const j = own(w, id);
      if (terminalStatuses.includes(j.status)) throw new JobsError('bad_state', `A ${j.status} job cannot be paused.`);
      // A step in flight loses its lease: its result is refused and it re-runs on resume with the same idempotency key.
      // The interrupted run was not a failure, so its attempt is given back: pause/resume cycles must not use up the budget.
      // Only when the lease is still live: a crashed worker's expired lease keeps its attempt counted, so a step that always crashes still reaches maxAttempts.
      const leaseLive = j.leaseExpiresAt !== null && j.leaseExpiresAt > now;
      if (leaseLive) for (const s of j.steps) if (s.status === 'running') { s.attempts = Math.max(0, s.attempts - 1); j.attempts = Math.max(0, j.attempts - 1); }
      resetRunningStep(j); release(j); j.status = 'paused'; touch(j, now);
      return clone(j);
    },
    async resume(w, id, now) {
      const j = own(w, id);
      if (j.status !== 'paused') throw new JobsError('bad_state', 'Only a paused job can be resumed.');
      // A future run time is kept (a post scheduled for tomorrow and paused for an hour is still due tomorrow); a past one becomes due now.
      // (The proposed SQL above has no resume statement; its equivalent is `next_run_at = greatest(next_run_at, now())`.)
      j.status = 'queued'; j.nextRunAt = Math.max(j.nextRunAt, now); j.lastError = null; touch(j, now);
      return clone(j);
    },
    async retry(w, id, now) {
      const j = own(w, id);
      if (j.status !== 'failed') throw new JobsError('bad_state', 'Only a failed job can be retried.');
      for (const s of j.steps) if (s.status === 'failed') { s.status = 'pending'; s.attempts = 0; s.error = null; }
      j.status = 'queued'; j.nextRunAt = now; j.lastError = null; touch(j, now);
      return clone(j);
    },
    async cancel(w, id, now) {
      const j = own(w, id);
      if (j.status === 'cancelled') return clone(j);
      if (terminalStatuses.includes(j.status)) throw new JobsError('bad_state', `A ${j.status} job cannot be cancelled.`);
      resetRunningStep(j); release(j); j.status = 'cancelled'; touch(j, now);
      return clone(j);
    },
    async setTenantPaused(w, paused) { if (paused) pausedTenants.add(w); else pausedTenants.delete(w); },
    async isTenantPaused(w) { return pausedTenants.has(w); },
    async cancelAll(w, now) {
      let n = 0;
      for (const j of jobs.values()) {
        if (j.workspaceId !== w || terminalStatuses.includes(j.status)) continue;
        resetRunningStep(j); release(j); j.status = 'cancelled' as JobStatus; touch(j, now); n++;
      }
      return n;
    },
    async charges(w) { return [...ledger.values()].filter((c) => c.workspaceId === w).map(clone); },
  };
}
