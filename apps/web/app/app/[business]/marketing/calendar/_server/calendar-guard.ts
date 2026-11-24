// The checks and the one operation behind `exportCalendarAction`, as plain functions so the node tests run exactly what the page runs
// (actions.ts imports Next-only modules). Order, same as the sibling pages: demo storage on, valid business id, known business, the
// runtime has a campaign store and an asset store. Then the campaign to export is LOOKED UP on the server for the checked workspace and
// business: the request names no campaign, so there is no id a caller could point at another business's campaign. The campaign-assets
// service (`exportCampaign`, AMP-051) then makes every real decision: it re-loads the approved campaign for the same scope, and only
// approved text that still passes its rules and has full web links leaves. Nothing here posts, schedules or publishes anything.
import { exportCampaign } from '../../../../../../lib/aimp/campaign-assets/export.ts';
import type { AssetIssue } from '../../../../../../lib/aimp/campaign-assets/types.ts';
import { getCampaign } from '../../../../../../lib/aimp/campaigns/service.ts';
import { isBusinessId } from '../../../../../start/journey.ts';
import { isKnownBusiness } from '../../../_server/overview.ts';
import type { MarketingContexts } from '../../_server/marketing.ts';
import { assetDeps, creativeStoresOf } from '../../creative/_server/creative.ts';
import { NOT_IN_DEMO, PUBLISHING_LABEL, piecesLabel } from '../view-model.ts';
import type { CalendarRuntime } from './calendar.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_STORE = `${NOT_IN_DEMO} Nothing was saved.`;
export const NO_APPROVED_PLAN = 'There is no approved marketing plan to save text from. Approve your plan on the Marketing page first.';
export const NO_DRAFTS = 'The text for this plan has not been written yet, so there is nothing to save. Write and approve it in Creative Studio first.';
export const OLD_PLAN = 'Your marketing plan has a newer approved version than the text you have, so nothing was saved. Write the text again in Creative Studio first.';
export const NOTHING_APPROVED = 'Nothing is approved yet, so there is nothing to save. Approve at least one draft in Creative Studio first.';
export const NEEDS_FIXES = 'An approved draft no longer passes the rules shown in Creative Studio, so nothing was saved. Edit it and approve it again first.';
export const NO_WEB_ADDRESS = 'Your store does not have a full web address yet, so the links would not work outside your store. Nothing was saved.';
export const NOT_DONE = 'That did not go through, so nothing was saved.';
export const WENT_WRONG = 'Something went wrong on our side, so no file was made. Reload the page and try again. Nothing was posted.';
export const exported = (n: number): string => `Your ZIP file with ${piecesLabel(n)} is ready to save. Nothing was posted.`;

/** Size caps for one export reply (the ZIP travels back to the browser as base64, about a third bigger). Checked on the server. */
export const MAX_EXPORT_ITEMS = 200;
export const MAX_EXPORT_FILES = 20;
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
export interface ExportLimits { items: number; files: number; bytes: number }
export const DEFAULT_EXPORT_LIMITS: ExportLimits = { items: MAX_EXPORT_ITEMS, files: MAX_EXPORT_FILES, bytes: MAX_EXPORT_BYTES };
export const tooLarge = (what: string): string => `This export is too large to download in one go (more than ${what}), so nothing was saved.`;

export interface CalendarGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => CalendarRuntime;
  ctx: Pick<MarketingContexts, 'workspaceId'>;
  now: () => Date;
  /** Size caps for the reply; the named defaults when left out. Tests pass small ones. */
  limits?: Partial<ExportLimits>;
}

export interface CalendarExportReply {
  ok: boolean;
  message: string;
  /** The ZIP file, base64, with the names of the files inside it. Null on every refusal. */
  file: { name: string; base64: string; files: string[] } | null;
  /** Always the plain "Not connected": an export never needs, and never uses, a publishing account. */
  publishing: typeof PUBLISHING_LABEL;
}

const no = (message: string): CalendarExportReply => ({ ok: false, message, file: null, publishing: PUBLISHING_LABEL });

function refusal(errors: AssetIssue[]): CalendarExportReply {
  switch (errors[0]?.code) {
    case 'campaign_not_approved': case 'scope': return no(NO_APPROVED_PLAN);
    case 'not_found': return no(NO_DRAFTS);
    case 'stale': return no(OLD_PLAN);
    case 'nothing_approved': return no(NOTHING_APPROVED);
    case 'needs_fixes': return no(NEEDS_FIXES);
    case 'links_not_absolute': return no(NO_WEB_ADDRESS);
    default: return no(NOT_DONE);
  }
}

/**
 * Guard, then export the checked business's own approved campaign. A refusal makes no file. Anything thrown on the way (a campaign or
 * draft read, the ZIP itself) becomes one plain reply; only the error's name is logged.
 */
export async function runCalendarExport(g: CalendarGuardInput, businessId: unknown, log: (message: string, detail: string) => void = console.error): Promise<CalendarExportReply> {
  try {
    return await runCalendarExportUnsafe(g, businessId);
  } catch (e) {
    log('[app calendar] export failed:', e instanceof Error ? e.name : 'unknown error');
    return no(WENT_WRONG);
  }
}

async function runCalendarExportUnsafe(g: CalendarGuardInput, businessId: unknown): Promise<CalendarExportReply> {
  if (!g.availability.available) return no(g.availability.reason);
  if (!isBusinessId(businessId)) return no(NO_BUSINESS);
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return no(NO_BUSINESS);
  const stores = creativeStoresOf(rt);
  if (!stores) return no(NO_STORE);
  const scope = { workspaceId: g.ctx.workspaceId, businessId };
  const campaign = await getCampaign({ store: stores.campaigns }, scope);
  if (!campaign || campaign.status !== 'approved') return no(NO_APPROVED_PLAN);
  const cap = { ...DEFAULT_EXPORT_LIMITS, ...g.limits };
  const deps = assetDeps(rt, stores, g.now);
  // AMP-161: the item and file counts are checked BEFORE the ZIP is built, from the stored approved assets of the same version, so a
  // too-large export is never built at all. Anything else (no set, an older version, nothing approved) is left for the service to refuse.
  const set = await deps.assets.get(scope.workspaceId, scope.businessId, campaign.id);
  if (set && set.campaignVersion === campaign.version) {
    const approved = set.assets.filter((a) => a.state === 'approved');
    const has = (k: string) => approved.some((a) => a.kind === k);
    const fileCount = (has('pin') ? 2 : 0) + (has('caption') ? 1 : 0) + (has('video_script') ? 1 : 0) + (has('seo') ? 1 : 0) + 1;
    if (approved.length > cap.items) return no(tooLarge(`${cap.items} approved pieces of text`));
    if (approved.length > 0 && fileCount > cap.files) return no(tooLarge(`${cap.files} files`));
  }
  const r = await exportCampaign(deps, scope, campaign.id);
  if (!r.ok) return refusal(r.errors);
  const n = r.counts.pins + r.counts.captions + r.counts.videoScripts + r.counts.seo;
  // The size cap can only be known once the ZIP exists; it is checked before the base64 reply is built, so an over-size export leaves no file.
  if (n > cap.items) return no(tooLarge(`${cap.items} approved pieces of text`));
  if (r.files.length > cap.files) return no(tooLarge(`${cap.files} files`));
  if (r.zip.byteLength > cap.bytes) return no(tooLarge(cap.bytes >= 1024 * 1024 ? `${Math.round(cap.bytes / (1024 * 1024))} MB` : `${cap.bytes} bytes`));
  return { ok: true, message: exported(n), file: { name: r.fileName, base64: Buffer.from(r.zip).toString('base64'), files: r.files }, publishing: PUBLISHING_LABEL };
}
