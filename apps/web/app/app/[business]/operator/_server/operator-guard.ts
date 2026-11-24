// The checks and the hand-over behind `operatorAction`, as plain functions so the node tests run them (actions.ts imports Next-only
// modules). `guardOperatorOp` decides WHETHER anything runs; `runOperatorOp` then confirms the run is a failed run of THIS business
// and calls the automation service's `retryJob`. Nothing is decided or stored here: the service and the job engine own the rules,
// including "only a failed job can be retried", which is what stops a repeated click from retrying twice.
// Order: demo storage on, valid business id, known business, an automation store exists, the request has a known shape, the run is
// in this business's own activity and is failed. Workspace and actor come from `deps` (the server); the business from the checked
// route id; never from the op.
import { AutomationError } from '../../../../../lib/aimp/automation/types.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import { FEED_LIMIT, NOT_IN_DEMO_TEXT, runsOf } from '../view-model.ts';
import { operatorContext } from './operator.ts';
import type { OperatorDeps, OperatorRuntime } from './operator.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const NO_RUN = 'We could not find that run for this business, so nothing was retried.';
export const NOT_FAILED = 'This run is not failed, so it was not retried. If you just chose Retry, it is already on its way and was not retried twice.';
export const FAILED = 'Something went wrong on our side, so we do not know if that went through. Reload the page to see the current state.';
export const RETRIED = 'Retry requested. The run is back in the demo job queue and has not run again yet. Steps already finished are not repeated.';

export interface OperatorOp { kind: 'retry'; runId: string }

export interface OperatorGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => OperatorRuntime;
  deps: OperatorDeps;
}

export type OperatorGuard = { ok: false; message: string } | { ok: true; op: OperatorOp; businessId: string };
export interface OperatorReply { ok: boolean; message: string }

const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const isRunId = (v: unknown): v is string => typeof v === 'string' && RUN_ID.test(v) && !UNSAFE_KEYS.includes(v);

/** Shape check. Returns the refusal message, or the op. Only own properties are read, and only the named ones. */
export function readOp(raw: unknown): OperatorOp | string {
  if (!isObj(raw) || own(raw, 'kind') !== 'retry') return BAD_REQUEST;
  const runId = own(raw, 'runId');
  return isRunId(runId) ? { kind: 'retry', runId } : NO_RUN;
}

export function guardOperatorOp(g: OperatorGuardInput, businessId: unknown, rawOp: unknown): OperatorGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId) || UNSAFE_KEYS.includes(businessId)) return { ok: false, message: NO_BUSINESS };
  if (!isKnownBusiness(g.rt(), businessId)) return { ok: false, message: NO_BUSINESS };
  if (!g.deps.automation) return { ok: false, message: NOT_IN_DEMO_TEXT };
  const op = readOp(rawOp);
  if (typeof op === 'string') return { ok: false, message: op };
  return { ok: true, op, businessId };
}

/** Guard, then the one service call. Every refusal and every service error comes back as a plain message; nothing is thrown. */
export async function runOperatorOp(g: OperatorGuardInput, businessId: unknown, rawOp: unknown): Promise<OperatorReply> {
  const checked = guardOperatorOp(g, businessId, rawOp);
  if (!checked.ok) return checked;
  const { op } = checked;
  try {
    if (!g.deps.automation) return { ok: false, message: NOT_IN_DEMO_TEXT };
    const automation = g.deps.automation();
    const ctx = operatorContext(g.deps, checked.businessId);
    // The run must be one of this business's own job rows, and failed, before the service is asked. The service checks both again
    // itself (another business's job answers not_found; a job that is not failed answers conflict), so this is a second lock.
    const run = runsOf((await automation.activity(ctx, { limit: FEED_LIMIT })).entries).find((e) => e.jobId === op.runId);
    if (!run) return { ok: false, message: NO_RUN };
    if (run.status !== 'failed') return { ok: false, message: NOT_FAILED };
    const r = await automation.retryJob(ctx, op.runId);
    return r.jobId === op.runId ? { ok: true, message: RETRIED } : { ok: false, message: FAILED };
  } catch (e) {
    if (e instanceof AutomationError) {
      if (e.code === 'not_found') return { ok: false, message: NO_RUN };
      if (e.code === 'conflict') return { ok: false, message: NOT_FAILED };
      return { ok: false, message: `${e.message} Nothing was retried.` };
    }
    console.error('[app operator] the request failed:', e instanceof Error ? e.name : 'unknown error');
    return { ok: false, message: FAILED };
  }
}
