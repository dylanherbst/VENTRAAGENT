// G02/G03/G04/G08 automation settings, approvals, usage caps and activity. Pure types and small helpers; no I/O.
// Reuses JobStatus and AutomationStatus values; adds no job state. "Waiting for owner" is an approval record, not a job.
import type { AutomationStatus } from '../contracts.ts';
import type { JobStatus } from '../jobs/types.ts';

export const automationAreas = ['marketing', 'product-generation', 'publishing'] as const;
export type AutomationArea = (typeof automationAreas)[number];
export const automationModes = ['automatic', 'owner_approval', 'paused'] as const;
export type AutomationMode = (typeof automationModes)[number];
export const approvalStatuses = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const DEFAULT_MODES: Readonly<Record<AutomationArea, AutomationMode>> = {
  marketing: 'owner_approval', 'product-generation': 'automatic', publishing: 'owner_approval',
};
export const AREA_LABELS: Readonly<Record<AutomationArea, string>> = { marketing: 'Marketing', 'product-generation': 'Product generation', publishing: 'Publishing' };
export const MODE_LABELS: Readonly<Record<AutomationMode, string>> = { automatic: 'Automatic', owner_approval: 'Ask me first', paused: 'Paused' };

/** Which area gates each job kind. Delivery (`fulfil-order`) is deliberately in no area: paid work is never blocked. */
export const AREA_FOR_KIND: Readonly<Record<string, AutomationArea>> = {
  'generate-product': 'product-generation', 'publish-site': 'publishing', 'scheduled-post': 'marketing',
};
export const UNGATED_KINDS: readonly string[] = ['fulfil-order'];
/** Kinds that spend one AI generation from the allowance. */
export const GENERATION_KINDS: readonly string[] = ['generate-product'];
export const KIND_LABELS: Readonly<Record<string, string>> = {
  'generate-product': 'Product generation', 'publish-site': 'Site publishing', 'scheduled-post': 'Scheduled post', 'fulfil-order': 'Order delivery',
};

export const DEFAULT_CAP = 20;
export const MAX_CAP = 100_000;
export const APPROVAL_TTL_MS = 24 * 60 * 60_000;
export const MAX_DESCRIPTION = 200;

export interface Scope { workspaceId: string; businessId: string }

export interface UsageSummary {
  used: number;
  limit: number;
  remaining: number;
  /** UTC calendar month, `YYYY-MM`. */
  periodKey: string;
  /** Epoch ms of the start of the next period. */
  resetsAt: number;
  reached: boolean;
}

export interface AutomationSettings { modes: Record<AutomationArea, AutomationMode>; usage: UsageSummary }

export interface ApprovalRecord {
  id: string;
  scope: Scope;
  area: AutomationArea;
  kind: string;
  /** Plain-English text for the owner, secrets removed. */
  description: string;
  /** Stored for execution; never returned to a screen. */
  input: unknown;
  requestHash: string;
  /** The start() idempotency key; the same key returns this approval. */
  requestKey: string;
  status: ApprovalStatus;
  requestedAt: number;
  expiresAt: number;
  decidedAt: number | null;
  jobId: string | null;
}

export interface ApprovalView {
  id: string; area: AutomationArea; kind: string; description: string; status: ApprovalStatus;
  requestedAt: number; expiresAt: number; decidedAt: number | null; jobId: string | null;
}

export const eventTypes = ['mode-changed', 'cap-changed', 'approval-requested', 'approval-approved', 'approval-rejected', 'approval-expired', 'blocked-paused', 'blocked-cap', 'jobs-paused', 'jobs-resumed', 'job-retried'] as const;
export type AutomationEventType = (typeof eventTypes)[number];
export interface AutomationEvent {
  schemaVersion: 1;
  /** Stable: appending the same id twice stores one row. */
  id: string;
  type: AutomationEventType;
  workspaceId: string;
  businessId: string;
  at: number;
  area: AutomationArea | null;
  /** Safe text only. */
  text: string;
  approvalId: string | null;
}

export type ActivityStatus = JobStatus | AutomationStatus;
export interface ActivityEntry {
  id: string;
  at: number;
  source: 'job' | 'approval' | 'setting' | 'limit';
  status: ActivityStatus;
  /** Readable label for `status`. */
  label: string;
  title: string;
  detail: string | null;
  area: AutomationArea | null;
  needsOwner: boolean;
  /** Exact next step for the owner, or null when nothing is needed. */
  nextAction: string | null;
  /** Epoch ms of the next automatic retry, or null. */
  nextRetryAt: number | null;
  approvalId: string | null;
  jobId: string | null;
}
export interface ActivityFeed { entries: ActivityEntry[]; needsYou: number; failed: number; retrying: number }

export type StartResult =
  | { outcome: 'started'; jobId: string; jobStatus: JobStatus; created: boolean; message: string }
  | { outcome: 'needs_approval'; approvalId: string; created: boolean; message: string }
  /** The same request key was already decided (rejected or expired). Nothing is created; ask again with a new key. */
  | { outcome: 'already_decided'; decision: 'rejected' | 'expired'; approvalId: string; message: string }
  | { outcome: 'paused'; message: string }
  | { outcome: 'cap_reached'; message: string; usage: UsageSummary };

export interface DecideResult {
  approval: ApprovalView;
  /** True only on the call that actually started the job. */
  ran: boolean;
  alreadyDecided: boolean;
  message: string;
}

export interface RetryResult { jobId: string; jobStatus: JobStatus; message: string }

export type AutomationErrorCode = 'invalid' | 'not_found' | 'conflict' | 'blocked' | 'expired';
export class AutomationError extends Error {
  readonly code: AutomationErrorCode;
  constructor(code: AutomationErrorCode, message: string) { super(message); this.name = 'AutomationError'; this.code = code; }
}

export const STATUS_LABELS: Readonly<Record<ActivityStatus, string>> = {
  queued: 'Queued', running: 'Building', 'waiting-retry': 'Retrying', succeeded: 'Complete', failed: 'Failed', cancelled: 'Cancelled', paused: 'Paused',
  draft: 'Draft', generating: 'Building', checking: 'Checking', needs_approval: 'Needs you', scheduled: 'Scheduled', live: 'Live', complete: 'Complete',
};

/** UTC calendar month key and the start of the next month. */
export function periodOf(now: number): { key: string; resetsAt: number } {
  const d = new Date(now);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, resetsAt: Date.UTC(y, m + 1, 1) };
}
