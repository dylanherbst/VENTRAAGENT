// The checks and the two operations behind `marketingAction`, as plain functions so the node tests run exactly what the page runs
// (actions.ts imports Next-only modules). Order, same as the sibling pages: demo storage on, valid business id, known business, the
// runtime has a campaign store, the request has a known shape, the change was confirmed. Then the campaign service (AMP-050) does the
// work: `regenerateCampaign` writes a draft from the business's real brand, listings and store; `approveCampaign` re-checks the saved
// plan against them and refuses a stale version. Workspace and owner come from `ctx` (the server), never from the request.
// Nothing here posts, schedules or publishes anything.
import { approveCampaign, regenerateCampaign } from '../../../../../lib/aimp/campaigns/service.ts';
import type { CampaignIssue, CampaignStore } from '../../../../../lib/aimp/campaigns/types.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import { NOT_IN_DEMO } from '../view-model.ts';
import { campaignContext, campaignStoreOf } from './marketing.ts';
import type { MarketingContexts, MarketingRuntime } from './marketing.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_CAMPAIGN_STORE = `${NOT_IN_DEMO} Nothing was changed.`;
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const NOT_CONFIRMED = 'That was not confirmed, so nothing was changed.';
export const STALE = 'This plan changed since you opened it, so nothing was approved. Reload the page and try again.';
export const NO_PLAN = 'There is no plan to approve yet. Create a draft first.';
export const ALREADY_APPROVED = 'This plan is already approved. Make a new draft if you want to change it.';
export const NOT_DRAFTED = 'We could not write a plan yet. Nothing was saved.';
export const NOT_APPROVED = 'This plan no longer matches your brand, listings or store, so it was not approved. Make a new draft.';
export const WENT_WRONG = 'Something went wrong on our side, so we do not know if that went through. Reload the page to see the current state. Nothing was posted.';
export const drafted =(version: number): string => `Draft version ${version} is ready to read. Nothing was posted.`;
export const approved = (version: number): string => `Version ${version} is approved. Nothing was posted.`;

export type MarketingOp = { kind: 'draft'; confirmed: boolean } | { kind: 'approve'; expectedVersion: number; confirmed: boolean };

export interface MarketingGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => MarketingRuntime;
  ctx: MarketingContexts;
  now: () => Date;
  newId?: () => string;
}

export type MarketingGuard = { ok: false; message: string } | { ok: true; op: MarketingOp; businessId: string; rt: MarketingRuntime; store: CampaignStore };
export interface MarketingReply { ok: boolean; message: string; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/** Shape check only. Anything else in the request (a workspace, a business, a store) is dropped. */
export function readOp(raw: unknown): MarketingOp | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'draft') return { kind: 'draft', confirmed: raw.confirmed === true };
  if (raw.kind === 'approve') return whole(raw.expectedVersion) ? { kind: 'approve', expectedVersion: raw.expectedVersion, confirmed: raw.confirmed === true } : null;
  return null;
}

export function guardMarketingOp(g: Pick<MarketingGuardInput, 'availability' | 'rt'>, businessId: unknown, rawOp: unknown): MarketingGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return { ok: false, message: NO_BUSINESS };
  const store = campaignStoreOf(rt);
  if (!store) return { ok: false, message: NO_CAMPAIGN_STORE };
  const op = readOp(rawOp);
  if (!op) return { ok: false, message: BAD_REQUEST };
  if (!op.confirmed) return { ok: false, message: NOT_CONFIRMED };
  return { ok: true, op, businessId, rt, store };
}

const messages = (errors: CampaignIssue[]): string[] => [...new Set(errors.map((e) => e.message))];

/**
 * Guard, then run the op on the campaign service. A refusal changes nothing. Anything thrown on the way (a brand, listing, store or
 * campaign read or write) becomes one plain reply that does not claim either outcome; only the error's name is logged.
 */
export async function runMarketingOp(
  g: MarketingGuardInput, businessId: unknown, rawOp: unknown, log: (message: string, detail: string) => void = console.error,
): Promise<MarketingReply> {
  try {
    return await runMarketingOpUnsafe(g, businessId, rawOp);
  } catch (e) {
    log('[app marketing] draft or approve failed:', e instanceof Error ? e.name : 'unknown error');
    return { ok: false, message: WENT_WRONG, errors: [] };
  }
}

async function runMarketingOpUnsafe(g: MarketingGuardInput, businessId: unknown, rawOp: unknown): Promise<MarketingReply> {
  const guard = guardMarketingOp(g, businessId, rawOp);
  if (!guard.ok) return { ok: false, message: guard.message, errors: [] };
  const context = await campaignContext(guard.rt, g.ctx, guard.businessId);
  if (guard.op.kind === 'draft') {
    // Built-in plan only (no AI call) in this release.
    const r = await regenerateCampaign({ store: guard.store, now: g.now, newId: g.newId, llm: null }, context);
    return r.ok ? { ok: true, message: drafted(r.campaign.version), errors: [] } : { ok: false, message: NOT_DRAFTED, errors: messages(r.errors) };
  }
  const r = await approveCampaign({ store: guard.store, now: g.now }, context, g.ctx.ownerId, { expectedVersion: guard.op.expectedVersion });
  if (r.ok) return { ok: true, message: approved(r.campaign.version), errors: [] };
  const code = r.errors[0]?.code;
  if (code === 'stale') return { ok: false, message: STALE, errors: [] };
  if (code === 'not_found') return { ok: false, message: NO_PLAN, errors: [] };
  if (code === 'not_draft') return { ok: false, message: ALREADY_APPROVED, errors: [] };
  return { ok: false, message: NOT_APPROVED, errors: messages(r.errors) };
}
