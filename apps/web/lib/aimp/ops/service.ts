// P01 platform operations service (AMP-063 slice 1): audit history, admin job recovery, rate limit on recovery.
// Job state changes go ONLY through the job engine's JobService (get, list, retry). Nothing here edits a job record.
import type { OperationContext } from '../contracts.ts';
import type { JobService } from '../jobs/service.ts';
import { JobsError, safeText } from '../jobs/types.ts';
import type { JobRecord } from '../jobs/types.ts';
import { boundedLimit } from './store.ts';
import { auditMetadataKeys } from './types.ts';
import type {
  AuditAction, AuditEntry, AuditMetadata, AuditReadResult, AuditStore, JobSummary, ListResult, OpsActor, RateLimiter, RecoverResult,
  RecoveryStore, Refusal, RefusalCode, StuckJob, Tenant,
} from './types.ts';

/** A queued or waiting job this far past its run time is reported as stuck. */
export const STUCK_AFTER_MS = 15 * 60_000;
export const MAX_REASON_CHARS = 200;
export const RECOVERY_ACTION = 'job.recover';

const SECRET_KEY = /token|secret|password|key|authorization/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const CONTROL = /\p{Cc}|\p{Cf}/u;
const MAX_ID = 100;

/** Keeps only allow-listed keys, drops anything secret-looking, keeps primitives only, redacts and shortens strings. */
export function sanitizeMetadata(input: unknown): AuditMetadata {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY.test(k) || !(auditMetadataKeys as readonly string[]).includes(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = safeText(v.replace(EMAIL, '[email]')).slice(0, 80);
  }
  return out as AuditMetadata;
}

function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || CONTROL.test(s)) return null;
  return safeText(s.replace(EMAIL, '[email]')).slice(0, MAX_REASON_CHARS);
}

/** Ids that come from the caller are redacted like the reason before they are stored. */
function redactId(raw: unknown): string {
  return safeText(String(raw).replace(EMAIL, '[email]')).slice(0, MAX_ID);
}

const validId =(s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID && !CONTROL.test(s);

export interface AuditLogOptions { store: AuditStore; now?: () => number; newId?: () => string }
export interface AuditRecord {
  tenant: Tenant;
  actor: OpsActor;
  action: AuditAction;
  target: AuditEntry['target'];
  outcome: AuditEntry['outcome'];
  reason?: string | null;
  metadata?: unknown;
  /** Write to the bounded unattributed list instead of under the named workspace. */
  unattributed?: boolean;
}
export interface AuditLog {
  /** Appends one entry. Never throws: returns the new id, or null if the store failed or (unattributed) is full. */
  record(r: AuditRecord): Promise<string | null>;
  unattributedReader(): { list(limit?: number): Promise<AuditEntry[]> };
  /** A reader fixed to one workspace. It has no way to name another. */
  reader(workspaceId: string): { list(opts?: { businessId?: string; limit?: number }): Promise<AuditEntry[]> };
}

export function createAuditLog(o: AuditLogOptions): AuditLog {
  const now = o.now ?? Date.now;
  const newId = o.newId ?? (() => globalThis.crypto.randomUUID());
  return {
    async record(r) {
      const reason = cleanReason(r.reason);
      const entry: AuditEntry = {
        id: newId(), at: now(), workspaceId: r.unattributed ? redactId(r.tenant.workspaceId) : r.tenant.workspaceId,
        businessId: r.tenant.businessId === undefined ? null : r.unattributed ? redactId(r.tenant.businessId) : r.tenant.businessId,
        actor: { kind: r.actor.kind, id: redactId(r.actor.id) }, action: r.action,
        target: { kind: r.target.kind, id: redactId(r.target.id) }, outcome: r.outcome,
        ...(reason ? { reason } : {}), metadata: sanitizeMetadata(r.metadata),
      };
      try {
        if (r.unattributed) return (await o.store.appendUnattributed(entry)) ? entry.id : null;
        await o.store.append(entry);
        return entry.id;
      } catch { return null; }
    },
    unattributedReader() { return { list: (limit) => o.store.listUnattributed(boundedLimit(limit)) }; },
    reader(workspaceId) {
      return {
        list: (opts = {}) => o.store.list(workspaceId, {
          businessId: opts.businessId,
          limit: boundedLimit(opts.limit),
        }),
      };
    },
  };
}

export interface OpsDeps {
  jobs: JobService;
  audit: AuditLog;
  recoveries: RecoveryStore;
  /** Limiter for the recovery action (see RECOVERY_LIMIT / RECOVERY_WINDOW_MS). */
  limiter: RateLimiter;
  /** True only for a workspace that really exists. History is written under a workspace only when this says so; a throw counts as
   *  "does not exist". Required: there is no safe default. */
  workspaceExists: (workspaceId: string) => Promise<boolean>;
  now?: () => number;
}

export interface OpsService {
  /** Failed and stuck jobs of one tenant. */
  listProblemJobs(actor: OpsActor, req: Tenant & { reason?: string }): Promise<ListResult>;
  /** Re-queues one FAILED job through JobService.retry. Idempotent: a second request is `already_recovered`. */
  recoverJob(actor: OpsActor, req: Tenant & { jobId: string; reason?: string }): Promise<RecoverResult>;
  readAudit(actor: OpsActor, req: Tenant & { limit?: number }): Promise<AuditReadResult>;
  /** Admin only: refusals that were not written under any tenant (system actor, admin without a reason). */
  readUnattributedAudit(actor: OpsActor, req?: { limit?: number }): Promise<AuditReadResult>;
}

const MESSAGES: Record<RefusalCode, string> = {
  invalid: 'That request is not valid.',
  not_permitted: 'You are not allowed to do that.',
  reason_required: 'A short reason is required.',
  rate_limited: 'Too many recoveries just now. Try again shortly.',
  job_not_found: 'Job not found.',
  not_recoverable: 'Only a failed job can be recovered.',
  already_recovered: 'That job was already recovered.',
  unavailable: 'That could not be done right now.',
};

function summarise(j: JobRecord): JobSummary {
  const failed = j.steps.find((s) => s.status === 'failed');
  return { id: j.id, businessId: j.businessId, kind: j.kind, status: j.status, attempts: j.attempts, failedStep: failed?.name ?? null, lastError: j.lastError, updatedAt: j.updatedAt };
}

export function createOpsService(deps: OpsDeps): OpsService {
  const now = deps.now ?? Date.now;
  // Same-job recoveries that are running right now. Checked and set before any await, so two concurrent calls cannot both proceed.
  const inflight = new Set<string>();

  const ctxFor = (actor: OpsActor, t: Tenant): OperationContext => ({
    workspaceId: t.workspaceId, ...(t.businessId !== undefined ? { businessId: t.businessId } : {}), actorUserId: actor.id, idempotencyKey: `ops:${actor.kind}`,
  });

  /** Writes the one audit entry for an attempt and builds the refusal. Owner attempts on a foreign tenant are written to the
   *  owner's OWN workspace so they cannot add rows to someone else's history. */
  async function refuse(actor: OpsActor, t: Tenant, action: AuditAction, target: AuditEntry['target'], code: RefusalCode, reason: string | null, extra: Record<string, unknown> = {}, notVerified = false, concealId = false): Promise<Refusal> {
    const home: Tenant = actor.kind === 'owner' && actor.workspaceId !== t.workspaceId ? { workspaceId: actor.workspaceId } : t;
    // A system actor, an admin with no reason, or a workspace that was not confirmed to exist may name any workspace id: those
    // refusals go to the bounded unattributed list instead of growing a history under the named tenant.
    const unattributed = notVerified || actor.kind === 'system' || code === 'reason_required';
    const auditId = await deps.audit.record({ tenant: home, actor, action, target, outcome: 'refused', reason, metadata: { refusal: code, ...extra }, unattributed });
    // `concealId`: the entry is still written, but its id is not handed back, so the id cannot show which list it went to (a real
    // workspace's history or the unattributed list) and so cannot tell an existing workspace from a missing one (AMP-162).
    return { ok: false, code, message: MESSAGES[code], ...(typeof extra.retryAfterSeconds === 'number' ? { retryAfterSeconds: extra.retryAfterSeconds } : {}), auditId: concealId ? null : auditId };
  }

  /** Refusal AFTER the tenant was named and passed the permission gate. Whether the workspace exists decides only where the entry is
   *  written; for an admin the answer (code, message, retry-after, audit id) is the same either way (AMP-162). */
  async function refuseTenant(actor: OpsActor, t: Tenant, action: AuditAction, target: AuditEntry['target'], code: RefusalCode, reason: string | null, extra: Record<string, unknown> = {}): Promise<Refusal> {
    const known = await exists(t.workspaceId);
    return refuse(actor, t, action, target, code, reason, extra, !known, actor.kind === 'admin');
  }

  const exists = async (workspaceId: string): Promise<boolean> => {
    try { return (await deps.workspaceExists(workspaceId)) === true; } catch { return false; }
  };

  const validActor = (a: OpsActor): boolean => !!a && validId(a.id) && (a.kind === 'owner' ? validId(a.workspaceId) : a.kind === 'admin' || a.kind === 'system');
  const validTenant = (t: Tenant): boolean => !!t && validId(t.workspaceId) && (t.businessId === undefined || validId(t.businessId));
  /** Owner: own workspace only. Admin: any tenant, with a reason. System: never. */
  const gate = (actor: OpsActor, t: Tenant, rawReason: unknown, needReason: boolean): { code: RefusalCode } | { reason: string | null } => {
    if (actor.kind === 'system') return { code: 'not_permitted' };
    if (actor.kind === 'owner' && actor.workspaceId !== t.workspaceId) return { code: 'not_permitted' };
    const reason = cleanReason(rawReason);
    if (actor.kind === 'admin' && needReason && !reason) return { code: 'reason_required' };
    return { reason };
  };

  return {
    async listProblemJobs(actor, req) {
      const tenant: Tenant = { workspaceId: req?.workspaceId, ...(req?.businessId !== undefined ? { businessId: req.businessId } : {}) };
      const target = { kind: 'tenant', id: String(req?.workspaceId ?? '').slice(0, MAX_ID) } as const;
      if (!validActor(actor) || !validTenant(tenant)) return { ok: false, code: 'invalid', message: MESSAGES.invalid, auditId: null };
      const g = gate(actor, tenant, req.reason, true);
      if ('code' in g) return refuse(actor, tenant, 'job.list', target, g.code, cleanReason(req.reason));
      let known: boolean;
      if (actor.kind === 'admin') {
        // FAIL CLOSED for an admin: a lookup that throws is an outage, not "no such workspace" (same as readAudit).
        try { known = (await deps.workspaceExists(tenant.workspaceId)) === true; } catch { return { ok: false, code: 'unavailable', message: MESSAGES.unavailable, auditId: null }; }
      } else known = await exists(tenant.workspaceId);
      if (!known) {
        // AMP-163 (see the contract, P01-platform-operations.md, "AMP-163 accepted difference"): an admin gets the same answer for a missing workspace as for an existing one with no problem jobs (an empty list and
        // an audit id), so the list cannot show which workspaces exist. The entry goes to the unattributed list, not to a tenant history.
        if (actor.kind === 'admin') {
          const ghostId = await deps.audit.record({ tenant, actor, action: 'job.list', target, outcome: 'allowed', reason: g.reason, metadata: { failedCount: 0, stuckCount: 0 }, unattributed: true });
          if (ghostId === null) return refuseTenant(actor, tenant, 'job.list', target, 'unavailable', g.reason);
          return { ok: true, failed: [], stuck: [], auditId: ghostId };
        }
        // An owner naming a workspace that does not exist (their own session is stale) answers like a missing job and gets no history.
        return refuseTenant(actor, tenant, 'job.list', target, 'job_not_found', g.reason);
      }
      let jobs: JobRecord[];
      try {
        jobs = await deps.jobs.list(ctxFor(actor, tenant));
      } catch { return refuseTenant(actor, tenant, 'job.list', target, 'unavailable', g.reason); }
      const t = now();
      const scoped = jobs.filter((j) => j.workspaceId === tenant.workspaceId && (tenant.businessId === undefined || j.businessId === tenant.businessId));
      const failed = scoped.filter((j) => j.status === 'failed').map(summarise);
      const stuck: StuckJob[] = [];
      for (const j of scoped) {
        if (j.status === 'running' && j.leaseExpiresAt !== null && j.leaseExpiresAt <= t) stuck.push({ ...summarise(j), stuckReason: 'lease_expired' });
        else if ((j.status === 'queued' || j.status === 'waiting-retry') && j.nextRunAt + STUCK_AFTER_MS <= t) stuck.push({ ...summarise(j), stuckReason: 'overdue' });
      }
      const auditId = await deps.audit.record({ tenant, actor, action: 'job.list', target, outcome: 'allowed', reason: g.reason, metadata: { failedCount: failed.length, stuckCount: stuck.length } });
      // FAIL CLOSED for an admin (AMP-162): an admin reading another tenant's jobs is always audited. If that entry cannot be stored,
      // nothing is returned. An owner reading their own workspace still gets the list with `auditId: null`.
      if (actor.kind === 'admin' && auditId === null) return refuseTenant(actor, tenant, 'job.list', target, 'unavailable', g.reason);
      return { ok: true, failed, stuck, auditId };
    },

    async recoverJob(actor, req) {
      const tenant: Tenant = { workspaceId: req?.workspaceId, ...(req?.businessId !== undefined ? { businessId: req.businessId } : {}) };
      const target = { kind: 'job', id: String(req?.jobId ?? '').slice(0, MAX_ID) } as const;
      if (!validActor(actor) || !validTenant(tenant) || !validId(req.jobId)) return { ok: false, code: 'invalid', message: MESSAGES.invalid, auditId: null };
      const g = gate(actor, tenant, req.reason, true);
      if ('code' in g) return refuse(actor, tenant, RECOVERY_ACTION, target, g.code, cleanReason(req.reason));
      const reason = g.reason;

      // AMP-162: the in-flight check and the limiter both come BEFORE the existence check, and both are keyed by something that does not
      // depend on the workspace existing (the admin's own id, or the owner's own workspace). So an existing workspace and a missing one
      // spend the same counter, answer `already_recovered` / `rate_limited` at the same moments, and an admin cannot use either to tell
      // them apart. Existence then only decides where the entry is written, and the audit id is not returned to an admin on these refusals.
      // The in-flight check comes BEFORE the limiter so a duplicate call spends no counter. Check and add have no await between them.
      const flightKey = JSON.stringify([tenant.workspaceId, req.jobId]);
      if (inflight.has(flightKey)) return refuseTenant(actor, tenant, RECOVERY_ACTION, target, 'already_recovered', reason);
      inflight.add(flightKey);
      try {
        // Only permitted callers reach the limiter, so a stranger cannot use up anyone's recoveries.
        const lim = deps.limiter.check(actor.kind === 'admin' ? `admin:${actor.id}` : tenant.workspaceId, RECOVERY_ACTION);
        if (!lim.ok) return refuseTenant(actor, tenant, RECOVERY_ACTION, target, 'rate_limited', reason, { retryAfterSeconds: lim.retryAfterSeconds });
        // A workspace that does not exist answers exactly like a missing job and gets no history (the refusal goes to the unattributed list).
        if (!(await exists(tenant.workspaceId))) return refuseTenant(actor, tenant, RECOVERY_ACTION, target, 'job_not_found', reason);
        const ctx = ctxFor(actor, tenant);
        let before: JobRecord;
        try {
          before = await deps.jobs.get(ctx, req.jobId, tenant.businessId);
        } catch (e) {
          // Another tenant's job, another business's job and a missing job all answer the same way.
          return refuseTenant(actor, tenant, RECOVERY_ACTION, target, e instanceof JobsError && e.code === 'not_found' ? 'job_not_found' : 'unavailable', reason);
        }
        const wasRecovered = async () => (await deps.recoveries.get(tenant.workspaceId, req.jobId).catch(() => null)) !== null;
        if (before.status !== 'failed') {
          return refuseTenant(actor, tenant, RECOVERY_ACTION, target, (await wasRecovered()) ? 'already_recovered' : 'not_recoverable', reason, { jobKind: before.kind, statusBefore: before.status });
        }
        // Fail closed: the "attempt" entry is written BEFORE the retry. If it cannot be stored, nothing is retried.
        const attemptId = await deps.audit.record({
          tenant, actor, action: RECOVERY_ACTION, target, outcome: 'attempted', reason,
          metadata: { jobKind: before.kind, statusBefore: before.status },
        });
        if (attemptId === null) return refuseTenant(actor, tenant, RECOVERY_ACTION, target, 'unavailable', reason, { jobKind: before.kind });
        let after: JobRecord;
        try {
          after = await deps.jobs.retry(ctx, req.jobId, tenant.businessId);
        } catch (e) {
          const code: RefusalCode = e instanceof JobsError && e.code === 'not_found' ? 'job_not_found'
            : e instanceof JobsError && e.code === 'bad_state' ? ((await wasRecovered()) ? 'already_recovered' : 'not_recoverable') : 'unavailable';
          return refuseTenant(actor, tenant, RECOVERY_ACTION, target, code, reason, { jobKind: before.kind });
        }
        await deps.recoveries.put({ workspaceId: tenant.workspaceId, jobId: req.jobId, at: now(), actorId: actor.id }).catch(() => undefined);
        const outcomeId = await deps.audit.record({
          tenant, actor, action: RECOVERY_ACTION, target, outcome: 'allowed', reason,
          metadata: { jobKind: before.kind, statusBefore: before.status, statusAfter: after.status },
        });
        // The retry has happened and the attempt entry is durable; if only the outcome entry failed, point at the attempt.
        return { ok: true, job: summarise(after), auditId: outcomeId ?? attemptId };
      } finally {
        inflight.delete(flightKey);
      }
    },

    async readAudit(actor, req) {
      const tenant: Tenant = { workspaceId: req?.workspaceId, ...(req?.businessId !== undefined ? { businessId: req.businessId } : {}) };
      if (!validActor(actor) || !validTenant(tenant)) return { ok: false, code: 'invalid', message: MESSAGES.invalid, auditId: null };
      const g = gate(actor, tenant, undefined, false);
      if ('code' in g) return refuse(actor, tenant, 'audit.read', { kind: 'tenant', id: tenant.workspaceId }, g.code, null);
      try {
        // FAIL CLOSED for an admin (AMP-162): if the existence check itself cannot be read, the read is refused (not treated as "no such workspace").
        // AMP-163: and its answer is used: a workspace that does not exist reads as an existing one with an empty history, and the
        // audit store is not read for it, so the audit history cannot show which workspaces exist.
        if (actor.kind === 'admin' && (await deps.workspaceExists(tenant.workspaceId)) !== true) return { ok: true, entries: [] };
        const entries = await deps.audit.reader(tenant.workspaceId).list({ businessId: tenant.businessId, limit: req.limit });
        return { ok: true, entries };
      } catch { return { ok: false, code: 'unavailable', message: MESSAGES.unavailable, auditId: null }; }
    },

    async readUnattributedAudit(actor, req = {}) {
      if (!validActor(actor)) return { ok: false, code: 'invalid', message: MESSAGES.invalid, auditId: null };
      // Not written to any log when refused: the caller is not an admin and has no tenant here.
      if (actor.kind !== 'admin') return { ok: false, code: 'not_permitted', message: MESSAGES.not_permitted, auditId: null };
      try { return { ok: true, entries: await deps.audit.unattributedReader().list(req.limit) }; } catch { return { ok: false, code: 'unavailable', message: MESSAGES.unavailable, auditId: null }; }
    },
  };
}
