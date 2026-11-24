// P01 platform operations (AMP-063 slice 1): shapes. Library level, in-memory fixtures only.
// The tenant key is the workspace id (what the job engine and the account library use); a business id narrows it.
import type { JobStatus } from '../jobs/types.ts';

export interface Tenant { workspaceId: string; businessId?: string }

/** `owner` carries the workspace they own and may only act there. `admin` is a platform person (who counts as one is an open
 *  decision; nothing in the app builds this actor yet). `system` is reserved for automatic actions and may not recover jobs. */
export type OpsActor =
  | { kind: 'owner'; id: string; workspaceId: string }
  | { kind: 'admin'; id: string }
  | { kind: 'system'; id: string };

export const auditActions = ['job.list', 'job.recover', 'audit.read'] as const;
export type AuditAction = (typeof auditActions)[number];
export const auditTargetKinds = ['job', 'tenant'] as const;
export type AuditTargetKind = (typeof auditTargetKinds)[number];
/** `attempted` is written BEFORE a recovery is tried (so a recovery never takes effect without a durable entry); the outcome
 *  (`allowed` or `refused`) is written after. */
export type AuditOutcome = 'attempted' | 'allowed' | 'refused';

export const auditMetadataKeys = ['refusal', 'jobKind', 'statusBefore', 'statusAfter', 'retryAfterSeconds', 'failedCount', 'stuckCount'] as const;
export type AuditMetadata = Partial<Record<(typeof auditMetadataKeys)[number], string | number | boolean>>;

export interface AuditEntry {
  readonly id: string;
  /** Epoch ms from the injected clock. */
  readonly at: number;
  readonly workspaceId: string;
  readonly businessId: string | null;
  readonly actor: { readonly kind: OpsActor['kind']; readonly id: string };
  readonly action: AuditAction;
  readonly target: { readonly kind: AuditTargetKind; readonly id: string };
  readonly outcome: AuditOutcome;
  /** Short, redacted. Required from an admin; optional from an owner. */
  readonly reason?: string;
  readonly metadata: Readonly<AuditMetadata>;
}

/** Append-only by construction: there is no update or delete. */
export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  /** Bounded list for refusals that must not be written under a tenant the caller merely named (system actor, admin without a
   *  reason). Returns false when the list is full: the entry is refused, never overwriting an older one. */
  appendUnattributed(entry: AuditEntry): Promise<boolean>;
  /** Newest first. Admin readers only. */
  listUnattributed(limit: number): Promise<AuditEntry[]>;
  /** Newest first. Only ever returns entries of that workspace. */
  list(workspaceId: string, opts: { businessId?: string; limit: number }): Promise<AuditEntry[]>;
}

export interface RecoveryRecord { workspaceId: string; jobId: string; at: number; actorId: string }
/** Remembers which jobs were recovered so a second request can answer "already recovered". */
export interface RecoveryStore {
  get(workspaceId: string, jobId: string): Promise<RecoveryRecord | null>;
  put(rec: RecoveryRecord): Promise<void>;
}

/** What an admin sees of a job. Deliberately no `input` (it may hold personal data) and no lease details. */
export interface JobSummary {
  id: string;
  businessId: string | null;
  kind: string;
  status: JobStatus;
  attempts: number;
  failedStep: string | null;
  /** Safe message already redacted by the job engine. */
  lastError: string | null;
  updatedAt: number;
}
export type StuckReason = 'lease_expired' | 'overdue';
export interface StuckJob extends JobSummary { stuckReason: StuckReason }

export const refusalCodes = ['invalid', 'not_permitted', 'reason_required', 'rate_limited', 'job_not_found', 'not_recoverable', 'already_recovered', 'unavailable'] as const;
export type RefusalCode = (typeof refusalCodes)[number];

export interface Refusal { ok: false; code: RefusalCode; message: string; retryAfterSeconds?: number; auditId: string | null }

export type ListResult = { ok: true; failed: JobSummary[]; stuck: StuckJob[]; auditId: string | null } | Refusal;
export type RecoverResult = { ok: true; job: JobSummary; auditId: string | null } | Refusal;
export type AuditReadResult = { ok: true; entries: AuditEntry[] } | Refusal;

export type LimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };
export interface RateLimiter {
  check(tenantKey: string, action: string): LimitResult;
  /** Number of live counters (for the memory bound). */
  size(): number;
}
