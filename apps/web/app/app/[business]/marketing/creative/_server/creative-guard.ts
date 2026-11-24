// The checks and the five operations behind `creativeAction`, as plain functions so the node tests run exactly what the page runs
// (actions.ts imports Next-only modules). Order, same as the sibling pages: demo storage on, valid business id, known business, the
// runtime has a campaign store and an asset store, the request has a known shape. Then the campaign-assets service (AMP-051) does the
// work and makes every real decision: it re-loads the APPROVED campaign for this workspace and business, refuses a campaign id that is
// not that campaign's, refuses an asset that is not in that campaign's set, and refuses a revision that is no longer current.
// Workspace and owner come from `ctx` (the server), never from the request. Nothing here posts, schedules or publishes anything.
import { approveAsset, editAsset, editableFields, generateCampaignAssets, regenerateAsset, rejectAsset } from '../../../../../../lib/aimp/campaign-assets/service.ts';
import { assetKinds } from '../../../../../../lib/aimp/campaign-assets/types.ts';
import type { AssetIssue } from '../../../../../../lib/aimp/campaign-assets/types.ts';
import { isBusinessId } from '../../../../../start/journey.ts';
import { isKnownBusiness } from '../../../_server/overview.ts';
import { WENT_WRONG } from '../../_server/marketing-guard.ts';
import type { MarketingContexts } from '../../_server/marketing.ts';
import { NOT_IN_DEMO, draftsLabel } from '../view-model.ts';
import { assetDeps, creativeStoresOf } from './creative.ts';
import type { CreativeRuntime, CreativeStores } from './creative.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_STORE = `${NOT_IN_DEMO} Nothing was changed.`;
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const CHANGED = 'This changed since you opened it, so nothing was saved. Reload the page and look again before deciding.';
export const OLD_PLAN = 'Your marketing plan has a newer approved version, so these drafts can no longer be changed. Make the drafts again for the new plan.';
export const NO_CAMPAIGN = 'There is no approved marketing plan that this belongs to, so nothing was changed. Approve your plan on the Marketing page first.';
export const NO_ASSETS = 'No drafts have been made for this plan yet. Nothing was changed.';
export const NO_ASSET = 'That draft is not part of this plan, so nothing was changed.';
export const NEEDS_REASON = 'Say why you are rejecting this, in up to 500 characters. Nothing was changed.';
export const NEEDS_FIXES = 'This draft breaks a rule shown under it, so it was not approved. Edit it or write it again first.';
export const IS_APPROVED = 'This draft is approved, so it was not replaced. Confirm that you want to replace it, or edit it instead.';
export const NOT_WRITTEN = 'We could not write the text just now, so nothing was changed. Try again.';
export const NOT_DONE = 'That did not go through, so nothing was changed.';
export const generated = (n: number): string => `${draftsLabel(n)} ready to read. Nothing was posted.`;
export const ALREADY_GENERATED = 'The drafts for this plan already exist, so nothing was replaced. Nothing was posted.';
export const APPROVED = 'Approved. Nothing was posted.';
export const REJECTED = 'Rejected, with your reason saved. Nothing was posted.';
export const EDITED = 'Your changes are saved as a draft that needs your approval again. Nothing was posted.';
export const REGENERATED = 'A new draft was written. It needs your approval. Nothing was posted.';

type Target = { campaignId: string; assetId: string; revision: number };
export type CreativeOp =
  | { kind: 'generate'; campaignId: string }
  | ({ kind: 'approve' } & Target)
  | ({ kind: 'reject'; reason: string } & Target)
  | ({ kind: 'edit'; patch: Record<string, string | number | string[]> } & Target)
  | ({ kind: 'regenerate'; replaceApproved: boolean } & Target);

export interface CreativeGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => CreativeRuntime;
  ctx: Pick<MarketingContexts, 'workspaceId' | 'ownerId'>;
  now: () => Date;
}
export type CreativeGuard = { ok: false; message: string } | { ok: true; op: CreativeOp; businessId: string; rt: CreativeRuntime; stores: CreativeStores };
export interface CreativeReply { ok: boolean; message: string; errors: string[] }

const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** `<content item id>:<kind>`, as the service makes them (`assetIdFor`). Anything else, prototype keys included, is not an asset id. */
const ASSET_ID = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}:(${assetKinds.join('|')})$`);
const REASON_MAX = 2000;
/** Every field name the service lets a person edit on some kind of asset. The service then checks the name against the asset's own kind. */
const EDITABLE: ReadonlySet<string> = new Set(Object.values(editableFields).flatMap((f) => Object.keys(f)));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

function readPatch(raw: unknown): Record<string, string | number | string[]> | null {
  if (!isObj(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.length > EDITABLE.size) return null;
  const out: [string, string | number | string[]][] = [];
  for (const [k, v] of entries) {
    if (!EDITABLE.has(k)) return null;
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out.push([k, v]);
    else if (Array.isArray(v) && v.every((s) => typeof s === 'string')) out.push([k, v.slice() as string[]]);
    else return null;
  }
  return Object.fromEntries(out);
}

/** Shape check only. Anything else in the request (a workspace, a business, a state) is dropped. */
export function readOp(raw: unknown): CreativeOp | null {
  if (!isObj(raw)) return null;
  const { kind, campaignId, assetId, revision } = raw;
  if (typeof campaignId !== 'string' || !CAMPAIGN_ID.test(campaignId)) return null;
  if (kind === 'generate') return { kind, campaignId };
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId) || !whole(revision)) return null;
  const target = { campaignId, assetId, revision };
  if (kind === 'approve') return { kind, ...target };
  if (kind === 'reject') return typeof raw.reason === 'string' && raw.reason.length <= REASON_MAX ? { kind, ...target, reason: raw.reason } : null;
  if (kind === 'regenerate') return { kind, ...target, replaceApproved: raw.replaceApproved === true };
  if (kind === 'edit') {
    const patch = readPatch(raw.patch);
    return patch ? { kind, ...target, patch } : null;
  }
  return null;
}

export function guardCreativeOp(g: Pick<CreativeGuardInput, 'availability' | 'rt'>, businessId: unknown, rawOp: unknown): CreativeGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return { ok: false, message: NO_BUSINESS };
  const stores = creativeStoresOf(rt);
  if (!stores) return { ok: false, message: NO_STORE };
  const op = readOp(rawOp);
  if (!op) return { ok: false, message: BAD_REQUEST };
  return { ok: true, op, businessId, rt, stores };
}

/** The service's refusal in the page's own plain words. Where the service's sentence is already plain it is passed on as it is. */
function refusal(errors: AssetIssue[]): CreativeReply {
  const e = errors[0];
  const say = (message: string): CreativeReply => ({ ok: false, message, errors: [] });
  switch (e?.code) {
    case 'stale': return say(e.field === 'revision' ? CHANGED : OLD_PLAN);
    case 'campaign_not_approved': case 'scope': return say(NO_CAMPAIGN);
    case 'not_found': return say(e.field === 'assetId' ? NO_ASSET : NO_ASSETS);
    case 'needs_fixes': return say(NEEDS_FIXES);
    case 'approved_asset': return say(IS_APPROVED);
    case 'generator_failed': return say(NOT_WRITTEN);
    case 'invalid': return e.field === 'reason' ? say(NEEDS_REASON) : { ok: false, message: NOT_DONE, errors: [e.message] };
    case 'wrong_state': case 'too_large': case 'attempt_limit': case 'in_progress': return { ok: false, message: NOT_DONE, errors: [e.message] };
    default: return say(NOT_DONE);
  }
}

/**
 * Guard, then run the op on the campaign-assets service. A refusal changes nothing. Anything thrown on the way (a campaign or asset
 * store read or write) becomes the same plain reply as the Marketing page, which does not claim either outcome; only the error's name is logged.
 */
export async function runCreativeOp(
  g: CreativeGuardInput, businessId: unknown, rawOp: unknown, log: (message: string, detail: string) => void = console.error,
): Promise<CreativeReply> {
  try {
    return await runCreativeOpUnsafe(g, businessId, rawOp);
  } catch (e) {
    log('[app creative] draft change failed:', e instanceof Error ? e.name : 'unknown error');
    return { ok: false, message: WENT_WRONG, errors: [] };
  }
}

async function runCreativeOpUnsafe(g: CreativeGuardInput, businessId: unknown, rawOp: unknown): Promise<CreativeReply> {
  const guard = guardCreativeOp(g, businessId, rawOp);
  if (!guard.ok) return { ok: false, message: guard.message, errors: [] };
  const { op } = guard;
  const deps = assetDeps(guard.rt, guard.stores, g.now);
  const scope = { workspaceId: g.ctx.workspaceId, businessId: guard.businessId };
  const actor = g.ctx.ownerId;
  const done = (message: string): CreativeReply => ({ ok: true, message, errors: [] });
  if (op.kind === 'generate') {
    const r = await generateCampaignAssets(deps, scope, op.campaignId, { actor });
    return r.ok ? done(r.created ? generated(r.set.assets.length) : ALREADY_GENERATED) : refusal(r.errors);
  }
  const expectedRevision = op.revision;
  if (op.kind === 'approve') {
    const r = await approveAsset(deps, scope, op.campaignId, op.assetId, { actor, expectedRevision });
    return r.ok ? done(APPROVED) : refusal(r.errors);
  }
  if (op.kind === 'reject') {
    const r = await rejectAsset(deps, scope, op.campaignId, op.assetId, { actor, reason: op.reason, expectedRevision });
    return r.ok ? done(REJECTED) : refusal(r.errors);
  }
  if (op.kind === 'edit') {
    const r = await editAsset(deps, scope, op.campaignId, op.assetId, { actor, patch: op.patch, expectedRevision });
    return r.ok ? done(EDITED) : refusal(r.errors);
  }
  const r = await regenerateAsset(deps, scope, op.campaignId, op.assetId, { actor, expectedRevision, replaceApproved: op.replaceApproved });
  return r.ok ? done(REGENERATED) : refusal(r.errors);
}
