// AMP-060 durable job model. Pure types and small helpers; no I/O.
// Mirrors the "existing job runner" pattern of lib/front-office/jobs.ts (due-time scheduling, atomic claim, backoff, outcome per
// job) but is its own module: the front-office runner is bound to Setter contacts, SMS/email routing and quiet hours via
// fo_* RPCs, none of which apply to generation, publishing, fulfilment or scheduled posts.
import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jobStatuses = ['queued', 'running', 'waiting-retry', 'succeeded', 'failed', 'cancelled', 'paused'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const terminalStatuses: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];

export const stepStatuses = ['pending', 'running', 'succeeded', 'failed'] as const;
export type StepStatus = (typeof stepStatuses)[number];

/** Built-in kinds. The registry is open: any string registered with the job registry is a valid kind. */
export const builtInJobKinds = ['generate-product', 'publish-site', 'fulfil-order', 'scheduled-post'] as const;
export type BuiltInJobKind = (typeof builtInJobKinds)[number];
export type JobKind = string;

export interface JobStep {
  name: string;
  status: StepStatus;
  /** Times this step has been claimed for execution (a crash that loses the lease counts as an attempt). */
  attempts: number;
  /** Declared cost in minor units, recorded exactly once when this step succeeds. */
  costMinor: number;
  /** Checkpoint: the JSON output of the step once it succeeded. Later steps read it; resume never re-runs the step. */
  output: JsonValue | null;
  /** Safe message from the last failed attempt, or null. */
  error: string | null;
  finishedAt: number | null;
}

export interface JobRecord {
  id: string;
  workspaceId: string;
  businessId: string | null;
  kind: JobKind;
  /** Unique per workspace + kind. Enqueueing the same key again returns this job. */
  idempotencyKey: string;
  inputHash: string;
  input: JsonValue;
  status: JobStatus;
  steps: JobStep[];
  /** Per-step attempt cap. */
  maxAttempts: number;
  /** Total step executions claimed across the job. */
  attempts: number;
  /** Epoch ms. Due when status is queued or waiting-retry and nextRunAt <= now. */
  nextRunAt: number;
  /** Safe, plain-English message for the owner. Never a stack trace or provider payload. */
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  /** Bumped on every claim; a settle with a stale version is refused (a newer runner owns the job). */
  leaseVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChargeEntry {
  /** `${jobId}:${stepName}`: the ledger refuses a second entry with the same id. */
  id: string;
  workspaceId: string;
  jobId: string;
  stepName: string;
  amountMinor: number;
  at: number;
}

export type JobsErrorCode = 'invalid' | 'not_found' | 'unknown_kind' | 'conflict' | 'bad_state';
export class JobsError extends Error {
  readonly code: JobsErrorCode;
  constructor(code: JobsErrorCode, message: string) { super(message); this.name = 'JobsError'; this.code = code; }
}

/** Thrown by step handlers. 'permanent' never retries; 'temporary' retries with backoff. The message must be safe to show. */
export class JobError extends Error {
  readonly kind: 'temporary' | 'permanent';
  constructor(kind: 'temporary' | 'permanent', message: string) { super(message); this.name = 'JobError'; this.kind = kind; }
}

export const MAX_JSON_BYTES = 20_000;
export const MAX_ERROR_CHARS = 240;

export function isJson(v: unknown, depth = 0): v is JsonValue {
  if (depth > 8) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v as Record<string, unknown>).every((x) => isJson(x, depth + 1));
  }
  return false;
}

export function stableStringify(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** SHA-256 (hex) of the canonical JSON, used to detect "same idempotency key, different request". */
export function hashInput(v: JsonValue): string {
  return createHash('sha256').update(stableStringify(v)).digest('hex');
}

// Secret-looking tokens and file paths are removed before any text is stored or shown.
const REDACTIONS: [RegExp, string][] = [
  [/\b(?:sk|pk|rk|whsec|ghp|xox[a-z])[_-][A-Za-z0-9_-]{4,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g, '[redacted]'],
  [/\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]'],
  [/(?<![\w:/])(?:\/[\w.@~-]+){2,}(?::\d+)*/g, '[path]'],
  [/\b[A-Za-z]:\\(?:[^\s\\]+\\?)+/g, '[path]'],
];
export function safeText(s: string): string {
  let out = s;
  for (const [re, to] of REDACTIONS) out = out.replace(re, to);
  return out.length > MAX_ERROR_CHARS ? `${out.slice(0, MAX_ERROR_CHARS - 1)}…` : out;
}
