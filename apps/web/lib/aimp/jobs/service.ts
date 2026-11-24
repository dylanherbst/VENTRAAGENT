// Tenant-facing job API. Every call takes an OperationContext and only ever touches that workspace's jobs.
// pause, cancel and tenant pause/cancel change what runs NEXT. They do not stop a step that is already executing: its result is
// discarded when it tries to checkpoint, but its external effect may have happened (handlers must be idempotent on the step key).
import type { OperationContext } from '../contracts.ts';
import { DEFAULT_MAX_ATTEMPTS } from './registry.ts';
import type { JobRegistry } from './registry.ts';
import type { JobStore } from './store.ts';
import { hashInput, isJson, JobsError, MAX_JSON_BYTES, stableStringify } from './types.ts';
import type { ChargeEntry, JobKind, JobRecord, JsonValue } from './types.ts';

export interface JobService {
  /** Same workspace + business (or none) + kind + context idempotency key returns the existing job (created: false): no duplicate orders, posts or charges. */
  enqueue(ctx: OperationContext, req: { kind: JobKind; input?: JsonValue; runAt?: number }): Promise<{ job: JobRecord; created: boolean }>;
  /** get, pause, retry and cancel take an optional businessId: a job of another business answers as not found. */
  get(ctx: OperationContext, id: string, businessId?: string): Promise<JobRecord>;
  list(ctx: OperationContext): Promise<JobRecord[]>;
  pause(ctx: OperationContext, id: string, businessId?: string): Promise<JobRecord>;
  resume(ctx: OperationContext, id: string): Promise<JobRecord>;
  /** Failed job: the failed step gets a fresh attempt budget; completed steps are not re-run or re-charged. */
  retry(ctx: OperationContext, id: string, businessId?: string): Promise<JobRecord>;
  cancel(ctx: OperationContext, id: string, businessId?: string): Promise<JobRecord>;
  pauseTenant(ctx: OperationContext): Promise<void>;
  resumeTenant(ctx: OperationContext): Promise<void>;
  cancelTenant(ctx: OperationContext): Promise<number>;
  charges(ctx: OperationContext): Promise<ChargeEntry[]>;
}

export interface JobServiceOptions { store: JobStore; registry: JobRegistry; now?: () => number; newId?: () => string }

function checkCtx(ctx: OperationContext): void {
  const ok = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max;
  if (!ctx || !ok(ctx.workspaceId, 100)) throw new JobsError('invalid', 'A workspace is required.');
  if (ctx.businessId !== undefined && !ok(ctx.businessId, 100)) throw new JobsError('invalid', 'That business id is not valid.');
}

export function createJobService(opts: JobServiceOptions): JobService {
  const { store, registry } = opts;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  // With a businessId, a job of another business (or of no business) answers exactly like a missing job.
  const scoped = async (workspaceId: string, id: string, businessId?: string): Promise<JobRecord> => {
    const job = await store.get(workspaceId, id);
    if (businessId !== undefined && job.businessId !== businessId) throw new JobsError('not_found', 'Job not found.');
    return job;
  };
  return {
    async enqueue(ctx, req) {
      checkCtx(ctx);
      if (typeof ctx.idempotencyKey !== 'string' || ctx.idempotencyKey.length === 0 || ctx.idempotencyKey.length > 200) throw new JobsError('invalid', 'An idempotency key is required (up to 200 characters).');
      const def = registry.get(req.kind);
      if (!def) throw new JobsError('unknown_kind', 'That kind of job is not available.');
      const input = req.input ?? {};
      if (!isJson(input) || stableStringify(input).length > MAX_JSON_BYTES) throw new JobsError('invalid', 'The job input must be plain JSON under 20 KB.');
      if (req.runAt !== undefined && !Number.isFinite(req.runAt)) throw new JobsError('invalid', 'The run time is not valid.');
      const t = now();
      return store.enqueue({
        id: newId(), workspaceId: ctx.workspaceId, businessId: ctx.businessId ?? null, kind: req.kind, idempotencyKey: ctx.idempotencyKey,
        // The key is scoped by workspace + business (none is its own scope) + kind, so another business never sees or blocks it.
        // Within that scope the same key with a different input or run time is a conflict, not a duplicate.
        inputHash: hashInput({ input, businessId: ctx.businessId ?? null, runAt: req.runAt ?? null }), input, stepNames: def.steps.map((s) => ({ name: s.name, costMinor: s.costMinor ?? 0 })),
        maxAttempts: def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, nextRunAt: req.runAt ?? t, now: t,
      });
    },
    async get(ctx, id, businessId) { checkCtx(ctx); return scoped(ctx.workspaceId, id, businessId); },
    async list(ctx) { checkCtx(ctx); return store.list(ctx.workspaceId); },
    async pause(ctx, id, businessId) { checkCtx(ctx); await scoped(ctx.workspaceId, id, businessId); return store.pause(ctx.workspaceId, id, now()); },
    async resume(ctx, id) { checkCtx(ctx); return store.resume(ctx.workspaceId, id, now()); },
    async retry(ctx, id, businessId) { checkCtx(ctx); await scoped(ctx.workspaceId, id, businessId); return store.retry(ctx.workspaceId, id, now()); },
    async cancel(ctx, id, businessId) { checkCtx(ctx); await scoped(ctx.workspaceId, id, businessId); return store.cancel(ctx.workspaceId, id, now()); },
    async pauseTenant(ctx) { checkCtx(ctx); await store.setTenantPaused(ctx.workspaceId, true); },
    async resumeTenant(ctx) { checkCtx(ctx); await store.setTenantPaused(ctx.workspaceId, false); },
    async cancelTenant(ctx) { checkCtx(ctx); return store.cancelAll(ctx.workspaceId, now()); },
    async charges(ctx) { checkCtx(ctx); return store.charges(ctx.workspaceId); },
  };
}
