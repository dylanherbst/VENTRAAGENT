// The checks and the hand-over behind `approvalsAction`, as plain functions so the node tests run them (actions.ts imports Next-only
// modules). `guardApprovalsOp` decides WHETHER anything runs; `runApprovalsOp` then calls the automation service (decide, setMode,
// setCap) and turns its answer into plain words. Nothing is decided or stored here: the service owns the rules, including "the same
// decision twice never runs the action twice".
// Order: demo storage on, valid business id, known business, an automation store exists, the request has a known shape, a decision
// was confirmed. Workspace and actor come from `deps` (the server); the business from the checked route id; never from the op.
import { AutomationError, MAX_CAP, automationAreas, automationModes } from '../../../../../lib/aimp/automation/types.ts';
import type { AutomationArea, AutomationMode } from '../../../../../lib/aimp/automation/types.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import { NOT_IN_DEMO_TEXT } from '../view-model.ts';
import { automationContext } from './approvals.ts';
import type { ApprovalsDeps, ApprovalsRuntime } from './approvals.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const NOT_CONFIRMED = 'That was not confirmed, so nothing was changed.';
export const NO_APPROVAL = 'We could not find that request for this business, so nothing was changed.';
export const BAD_MODE = 'That setting is not one of the choices, so nothing was changed.';
export const BAD_CAP = `The allowance must be a whole number from 0 to ${MAX_CAP}. Nothing was changed.`;
export const FAILED = 'Something went wrong on our side, so we do not know if that went through. Reload the page to see the current state.';
export const APPROVED = 'Approved. Its job was handed to the demo job queue.';
export const REJECTED = 'Rejected. It will not run.';

export type ApprovalsOp =
  | { kind: 'decide'; approvalId: string; decision: 'approve' | 'reject'; confirmed: boolean }
  | { kind: 'mode'; area: AutomationArea; mode: AutomationMode }
  | { kind: 'cap'; limit: number };

export interface ApprovalsGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => ApprovalsRuntime;
  deps: ApprovalsDeps;
  /** Called with the business id after a decision (approve or reject) went through, never after a refusal or a failure. Must not throw. */
  onDecided?: (businessId: string) => void;
}

export type ApprovalsGuard = { ok: false; message: string } | { ok: true; op: ApprovalsOp; businessId: string };
export interface ApprovalsReply { ok: boolean; message: string }

const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const isApprovalId = (v: unknown): v is string => typeof v === 'string' && APPROVAL_ID.test(v) && !UNSAFE_KEYS.includes(v);
const DIGITS = /^\d{1,7}$/;

/** A whole number from 0 to MAX_CAP, as a number or as plain digits typed into the box. Anything else is null. */
export function readCap(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && DIGITS.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_CAP ? n : null;
}

/** Shape check. Returns the refusal message, or the op. Only own properties are read, and only the named ones. */
export function readOp(raw: unknown): ApprovalsOp | string {
  if (!isObj(raw)) return BAD_REQUEST;
  switch (own(raw, 'kind')) {
    case 'decide': {
      const decision = own(raw, 'decision');
      if (decision !== 'approve' && decision !== 'reject') return BAD_REQUEST;
      const approvalId = own(raw, 'approvalId');
      if (!isApprovalId(approvalId)) return NO_APPROVAL;
      return { kind: 'decide', approvalId, decision, confirmed: own(raw, 'confirmed') === true };
    }
    case 'mode': {
      const area = own(raw, 'area');
      const mode = own(raw, 'mode');
      const a = automationAreas.find((x) => x === area);
      const m = automationModes.find((x) => x === mode);
      return a && m ? { kind: 'mode', area: a, mode: m } : BAD_MODE;
    }
    case 'cap': {
      const limit = readCap(own(raw, 'limit'));
      return limit === null ? BAD_CAP : { kind: 'cap', limit };
    }
    default: return BAD_REQUEST;
  }
}

export function guardApprovalsOp(g: ApprovalsGuardInput, businessId: unknown, rawOp: unknown): ApprovalsGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId) || UNSAFE_KEYS.includes(businessId)) return { ok: false, message: NO_BUSINESS };
  if (!isKnownBusiness(g.rt(), businessId)) return { ok: false, message: NO_BUSINESS };
  if (!g.deps.automation) return { ok: false, message: NOT_IN_DEMO_TEXT };
  const op = readOp(rawOp);
  if (typeof op === 'string') return { ok: false, message: op };
  if (op.kind === 'decide' && !op.confirmed) return { ok: false, message: NOT_CONFIRMED };
  return { ok: true, op, businessId };
}

/** Guard, then the one service call. Every refusal and every service error comes back as a plain message; nothing is thrown. */
export async function runApprovalsOp(g: ApprovalsGuardInput, businessId: unknown, rawOp: unknown): Promise<ApprovalsReply> {
  const checked = guardApprovalsOp(g, businessId, rawOp);
  if (!checked.ok) return checked;
  const { op } = checked;
  try {
    if (!g.deps.automation) return { ok: false, message: NOT_IN_DEMO_TEXT };
    const automation = g.deps.automation();
    const ctx = automationContext(g.deps, checked.businessId);
    switch (op.kind) {
      case 'decide': {
        const r = await automation.decide(ctx, op.approvalId, op.decision);
        // The waiting count on the Overview and Dashboard changed, so their saved copy is dropped. A failure here never hides the decision.
        try { g.onDecided?.(checked.businessId); } catch { /* the saved copy then simply refreshes on its own */ }
        if (r.ran) return { ok: true, message: APPROVED };
        if (!r.alreadyDecided) return { ok: true, message: REJECTED };
        return { ok: true, message: r.approval.status === 'expired' ? 'This request had already expired. It was not run.' : `This was already ${r.approval.status}. Nothing was run again.` };
      }
      case 'mode': {
        const s = await automation.setMode(ctx, op.area, op.mode);
        return s.modes[op.area] === op.mode ? { ok: true, message: 'Setting saved.' } : { ok: false, message: FAILED };
      }
      case 'cap': {
        const s = await automation.setCap(ctx, op.limit);
        return s.usage.limit === op.limit ? { ok: true, message: `The allowance is now ${op.limit} AI generations per period.` } : { ok: false, message: FAILED };
      }
    }
  } catch (e) {
    if (e instanceof AutomationError) {
      if (e.code === 'not_found') return { ok: false, message: NO_APPROVAL };
      return { ok: false, message: `${e.message} Nothing was run.` };
    }
    console.error('[app approvals] the request failed:', e instanceof Error ? e.name : 'unknown error');
    return { ok: false, message: FAILED };
  }
}
