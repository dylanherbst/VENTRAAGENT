// Campaign asset drafts and the review queue (AMP-051, F02 F07 S05).
//  - Only an APPROVED campaign (AMP-050) is turned into assets. getApprovedCampaign does not recheck ownership, so this service
//    takes the workspace and business explicitly and checks the record's own ids against them on every call.
//  - Every asset starts as a draft. draft -> approved | rejected (with a reason). Editing or regenerating puts it back to draft:
//    new text needs a new yes. Every change is kept in the asset's history, with the text it replaced.
//  - Regenerating never overwrites an approved asset unless the caller says so explicitly.
//  - An asset with a limit or claim problem cannot be approved. Nothing is truncated or fixed silently.
//  - Nothing is published or sent from here.
import type { CampaignContentItem, CampaignRecord, ContentFormat } from '../campaigns/types.ts';
import { themeFor } from './generate.ts';
import { checkContent } from './validate.ts';
import { EDIT_CAPS, MAX_REGENERATIONS } from './types.ts';
import type {
  ArchivedAssetSet, AssetContent, AssetDeps, AssetIssue, AssetKind, AssetRecord, AssetResult, AssetScope, AssetSet, ContentByKind, HistoryAction,
} from './types.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail = (code: AssetIssue['code'], message: string, field?: string): { ok: false; errors: AssetIssue[] } => ({ ok: false, errors: [{ code, message, ...(field ? { field } : {}) }] });

/** Which assets each content-plan item gets. A Pin item also gets the SEO copy for the page it links to. */
export const kindsForFormat: Readonly<Record<ContentFormat, readonly AssetKind[]>> = {
  pin_image: ['pin', 'seo'],
  caption: ['caption'],
  video_script: ['video_script'],
};
export const assetIdFor = (itemId: string, kind: AssetKind): string => `${itemId}:${kind}`;

function scopeIssue(s: AssetScope, campaignId: unknown): AssetIssue | null {
  if (typeof s?.workspaceId !== 'string' || !ID.test(s.workspaceId)) return { code: 'scope', field: 'workspaceId', message: 'A workspace is needed for campaign assets.' };
  if (typeof s.businessId !== 'string' || !ID.test(s.businessId)) return { code: 'scope', field: 'businessId', message: 'A business is needed for campaign assets.' };
  if (typeof campaignId !== 'string' || !ID.test(campaignId)) return { code: 'scope', field: 'campaignId', message: 'Say which campaign these assets belong to.' };
  return null;
}
function iso(now: () => Date): string {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('now must return a valid Date');
  return d.toISOString();
}
const actorOk = (a: unknown): a is string => typeof a === 'string' && a.trim().length > 0;

type Loaded = { ok: true; campaign: CampaignRecord } | { ok: false; errors: AssetIssue[] };

/** The approved campaign for this scope and id. Another business's campaign, a draft, or an old id all look the same: not found. */
export async function loadApprovedCampaign(deps: Pick<AssetDeps, 'campaigns'>, scope: AssetScope, campaignId: string): Promise<Loaded> {
  const bad = scopeIssue(scope, campaignId);
  if (bad) return { ok: false, errors: [bad] };
  const found = await deps.campaigns.get(scope.workspaceId, scope.businessId);
  const c = found?.status === 'approved' ? found : undefined;
  if (!c || c.id !== campaignId || c.workspaceId !== scope.workspaceId || c.businessId !== scope.businessId
    || c.plan.workspaceId !== scope.workspaceId || c.plan.businessId !== scope.businessId) {
    return fail('campaign_not_approved', 'There is no approved campaign with that id for this business. Approve the campaign first.', 'campaignId');
  }
  return { ok: true, campaign: c };
}

const itemOf = (plan: { items: CampaignContentItem[] }, id: string): CampaignContentItem | undefined => plan.items.find((i) => i.id === id);

function recordFor<K extends AssetKind>(kind: K, item: CampaignContentItem, content: ContentByKind[K], generator: string, at: string, actor: string, attempt: number, revision: number, base?: AssetRecord): AssetRecord {
  const check = checkContent(kind, content, { priceMinor: item.priceMinor, currency: item.currency });
  const action: HistoryAction = attempt === 0 ? 'generated' : 'regenerated';
  return {
    id: assetIdFor(item.id, kind), itemId: item.id, kind, state: 'draft', content, revision, attempt, generator,
    limitIssues: check.limitIssues, claimFlags: check.claimFlags, rejectionReason: null, decidedAt: null, decidedBy: null,
    history: [...(base?.history ?? []), { at, actor, action, revision, ...(base ? { before: base.content } : {}) }],
    createdAt: base?.createdAt ?? at, updatedAt: at,
  } as AssetRecord;
}

/**
 * Make the asset drafts for the approved campaign: one set per plan item. Asking again for the same campaign version returns the
 * existing set untouched (review work is never overwritten). A new campaign version starts a new set.
 */
export async function generateCampaignAssets(deps: AssetDeps, scope: AssetScope, campaignId: string, opts: { actor?: string } = {}): Promise<AssetResult<{ set: AssetSet; created: boolean; archivedVersion?: number }>> {
  const loaded = await loadApprovedCampaign(deps, scope, campaignId);
  if (!loaded.ok) return loaded;
  const { campaign } = loaded;
  const existing = await deps.assets.get(scope.workspaceId, scope.businessId, campaignId);
  if (existing && existing.campaignVersion === campaign.version) return { ok: true, set: existing, created: false };
  const at = iso(deps.now);
  const actor = actorOk(opts.actor) ? opts.actor.trim() : 'system';
  const assets: AssetRecord[] = [];
  try {
    for (const item of campaign.plan.items) {
      const theme = themeFor(campaign.plan, item);
      for (const kind of kindsForFormat[item.format]) {
        const content = await deps.generator.generate({ kind, item, plan: campaign.plan, theme, attempt: 0 });
        assets.push(recordFor(kind, item, content, deps.generator.id, at, actor, 0, 1));
      }
    }
  } catch (e) {
    return fail('generator_failed', `The copy generator failed, so nothing was saved: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
  const set: AssetSet = { workspaceId: scope.workspaceId, businessId: scope.businessId, campaignId, campaignVersion: campaign.version, assets };
  return deps.assets.mutate<AssetResult<{ set: AssetSet; created: boolean; archivedVersion?: number }>>(scope.workspaceId, scope.businessId, campaignId, (cur) => {
    if (cur && cur.campaignVersion === campaign.version) return { set: cur, result: { ok: true, set: cur, created: false } };
    // A different version replaces the set, but the old one (approvals, history) is kept as a read-only archive record.
    if (cur) return { set, archive: { ...cur, archivedAt: at, supersededByVersion: campaign.version }, result: { ok: true, set, created: true, archivedVersion: cur.campaignVersion } };
    return { set, result: { ok: true, set, created: true } };
  });
}

/** Earlier asset sets for the campaign, kept when a new campaign version started a new set. Read-only; never exported. Optionally one version. */
export async function listArchivedAssets(deps: Pick<AssetDeps, 'assets'>, scope: AssetScope, campaignId: string, campaignVersion?: number): Promise<AssetResult<{ sets: ArchivedAssetSet[] }>> {
  const bad = scopeIssue(scope, campaignId);
  if (bad) return { ok: false, errors: [bad] };
  const all = await deps.assets.archived(scope.workspaceId, scope.businessId, campaignId);
  return { ok: true, sets: campaignVersion === undefined ? all : all.filter((s) => s.campaignVersion === campaignVersion) };
}

/** The saved assets for the campaign, with whether they still match the campaign's current version. */
export async function listAssets(deps: AssetDeps, scope: AssetScope, campaignId: string): Promise<AssetResult<{ set: AssetSet; current: boolean }>> {
  const loaded = await loadApprovedCampaign(deps, scope, campaignId);
  if (!loaded.ok) return loaded;
  const set = await deps.assets.get(scope.workspaceId, scope.businessId, campaignId);
  if (!set) return fail('not_found', 'No assets have been generated for this campaign yet.');
  return { ok: true, set, current: set.campaignVersion === loaded.campaign.version };
}

type Step = { next: AssetRecord } | { error: AssetIssue };

/** Load the campaign, then change one asset atomically. The set must belong to the campaign's current version. */
async function changeAsset(deps: AssetDeps, scope: AssetScope, campaignId: string, assetId: string, step: (asset: AssetRecord, item: CampaignContentItem) => Step): Promise<AssetResult<{ asset: AssetRecord }>> {
  const loaded = await loadApprovedCampaign(deps, scope, campaignId);
  if (!loaded.ok) return loaded;
  const { campaign } = loaded;
  return deps.assets.mutate<AssetResult<{ asset: AssetRecord }>>(scope.workspaceId, scope.businessId, campaignId, (cur) => {
    const keep = (r: { ok: false; errors: AssetIssue[] }) => ({ set: cur, result: r });
    if (!cur) return keep(fail('not_found', 'No assets have been generated for this campaign yet.'));
    if (cur.campaignVersion !== campaign.version) return keep(fail('stale', `These assets were made from campaign version ${cur.campaignVersion}; the campaign is now version ${campaign.version}. Generate the assets again.`));
    const idx = cur.assets.findIndex((a) => a.id === assetId);
    const asset = cur.assets[idx];
    const item = asset ? itemOf(campaign.plan, asset.itemId) : undefined;
    if (!asset || !item) return keep(fail('not_found', 'That asset does not exist in this campaign.', 'assetId'));
    const r = step(asset, item);
    if ('error' in r) return keep({ ok: false, errors: [r.error] });
    const assets = cur.assets.slice();
    assets[idx] = r.next;
    return { set: { ...cur, assets }, result: { ok: true as const, asset: r.next } };
  });
}

const wrongRevisionIssue: AssetIssue = { code: 'stale', message: 'This asset changed since you opened it. Reload and look again before deciding.', field: 'revision' };
const wrongRevision = (): Step => ({ error: wrongRevisionIssue });
const attemptLimitIssue: AssetIssue = { code: 'attempt_limit', message: `This asset has already been regenerated ${MAX_REGENERATIONS} times, which is the most allowed. Edit the text by hand instead, or reject it.`, field: 'assetId' };
/** Regenerations running now, per store object, so a double click cannot run the generator twice for one asset. */
const inFlight = new WeakMap<object, Set<string>>();
const validRevision = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export async function approveAsset(deps: AssetDeps, scope: AssetScope, campaignId: string, assetId: string, opts: { actor: string; expectedRevision: number }): Promise<AssetResult<{ asset: AssetRecord }>> {
  if (!actorOk(opts?.actor)) return fail('invalid', 'Say who is approving this asset.', 'actor');
  if (!validRevision(opts.expectedRevision)) return fail('invalid', 'Say which version of the asset you are approving. Reload and try again.', 'revision');
  const at = iso(deps.now);
  return changeAsset(deps, scope, campaignId, assetId, (a) => {
    if (a.revision !== opts.expectedRevision) return wrongRevision();
    if (a.state !== 'draft') return { error: { code: 'wrong_state', message: `Only a draft can be approved; this asset is ${a.state}. Edit or regenerate it to review it again.` } };
    if (a.limitIssues.length || a.claimFlags.length) return { error: { code: 'needs_fixes', message: `This asset breaks ${a.limitIssues.length + a.claimFlags.length} rule(s) and cannot be approved. Edit or regenerate it first.` } };
    return { next: { ...a, state: 'approved', rejectionReason: null, decidedAt: at, decidedBy: opts.actor.trim(), updatedAt: at, history: [...a.history, { at, actor: opts.actor.trim(), action: 'approved', revision: a.revision }] } };
  });
}

export async function rejectAsset(deps: AssetDeps, scope: AssetScope, campaignId: string, assetId: string, opts: { actor: string; reason: string; expectedRevision: number }): Promise<AssetResult<{ asset: AssetRecord }>> {
  if (!actorOk(opts?.actor)) return fail('invalid', 'Say who is rejecting this asset.', 'actor');
  const reason = typeof opts.reason === 'string' ? opts.reason.trim() : '';
  if (reason.length === 0 || reason.length > 500) return fail('invalid', 'Give a reason for rejecting this asset (up to 500 characters).', 'reason');
  if (!validRevision(opts.expectedRevision)) return fail('invalid', 'Say which version of the asset you are rejecting. Reload and try again.', 'revision');
  const at = iso(deps.now);
  return changeAsset(deps, scope, campaignId, assetId, (a) => {
    if (a.revision !== opts.expectedRevision) return wrongRevision();
    if (a.state === 'rejected') return { error: { code: 'wrong_state', message: 'This asset is already rejected.' } };
    return { next: { ...a, state: 'rejected', rejectionReason: reason, decidedAt: at, decidedBy: opts.actor.trim(), updatedAt: at, history: [...a.history, { at, actor: opts.actor.trim(), action: 'rejected', reason, revision: a.revision }] } };
  });
}

/** The fields a person may change, per kind. Links, dates and the image size come from the plan and cannot be edited here. */
export const editableFields: Readonly<Record<AssetKind, Readonly<Record<string, 'text' | 'list' | 'number'>>>> = {
  pin: { title: 'text', description: 'text', altText: 'text', board: 'text', imageBrief: 'text', keywords: 'list' },
  caption: { variants: 'list' },
  video_script: { hook: 'text', beats: 'list', callToAction: 'text', onScreenText: 'list', targetLengthSeconds: 'number' },
  seo: { pageTitle: 'text', metaDescription: 'text', keywords: 'list' },
};

type Patched = { ok: true; content: AssetContent } | { ok: false; code: 'invalid' | 'too_large'; message: string };

function applyPatch(kind: AssetKind, content: AssetContent, patch: unknown): Patched {
  const invalid = (message: string): Patched => ({ ok: false, code: 'invalid', message });
  const tooLarge = (message: string): Patched => ({ ok: false, code: 'too_large', message });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return invalid('Say what to change.');
  const allowed = editableFields[kind];
  const next: Record<string, unknown> = { ...(content as unknown as Record<string, unknown>) };
  let n = 0;
  let total = 0;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const type = Object.hasOwn(allowed, k) ? allowed[k] : undefined;
    if (!type) return invalid(`"${k}" cannot be edited on this kind of asset.`);
    const good = type === 'text' ? typeof v === 'string' : type === 'number' ? typeof v === 'number' && Number.isFinite(v) : Array.isArray(v) && v.every((s) => typeof s === 'string');
    if (!good) return invalid(`"${k}" has the wrong type of value.`);
    // Hard size caps, checked before anything is copied or stored. These sit far above the display limits that raise too_long.
    const parts = typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : [];
    if (parts.length > EDIT_CAPS.listItems) return tooLarge(`"${k}" has too many items (the most allowed is ${EDIT_CAPS.listItems}). Nothing was saved.`);
    for (const s of parts) {
      if (s.length > EDIT_CAPS.fieldChars) return tooLarge(`"${k}" is too long to save (the most allowed is ${EDIT_CAPS.fieldChars} characters in one piece of text). Nothing was saved.`);
      total += s.length;
    }
    if (total > EDIT_CAPS.totalChars) return tooLarge(`This edit is too large to save (the most allowed is ${EDIT_CAPS.totalChars} characters in total). Nothing was saved.`);
    next[k] = Array.isArray(v) ? v.slice() : v;
    n++;
  }
  return n === 0 ? invalid('Say what to change.') : { ok: true, content: next as unknown as AssetContent };
}

/** Change the text of one asset. The change is checked against the limits and claim rules, and the asset goes back to draft. `expectedRevision` is required. */
export async function editAsset(deps: AssetDeps, scope: AssetScope, campaignId: string, assetId: string, opts: { actor: string; patch: Record<string, unknown>; expectedRevision: number }): Promise<AssetResult<{ asset: AssetRecord }>> {
  if (!actorOk(opts?.actor)) return fail('invalid', 'Say who is editing this asset.', 'actor');
  if (!validRevision(opts.expectedRevision)) return fail('invalid', 'Say which version of the asset you are editing. Reload and try again.', 'revision');
  const at = iso(deps.now);
  return changeAsset(deps, scope, campaignId, assetId, (a, item) => {
    if (a.revision !== opts.expectedRevision) return wrongRevision();
    const p = applyPatch(a.kind, a.content, opts.patch);
    if (!p.ok) return { error: { code: p.code, message: p.message, field: 'patch' } };
    const check = checkContent(a.kind, p.content, { priceMinor: item.priceMinor, currency: item.currency });
    const revision = a.revision + 1;
    return { next: { ...a, content: p.content, revision, state: 'draft', rejectionReason: null, decidedAt: null, decidedBy: null, updatedAt: at, ...check, history: [...a.history, { at, actor: opts.actor.trim(), action: 'edited', before: a.content, revision }] } as AssetRecord };
  });
}

/**
 * Ask the generator for a new version of one asset. An approved asset is NOT replaced unless `replaceApproved` is true; then it
 * goes back to draft and the approved text stays in the history.
 */
export async function regenerateAsset(deps: AssetDeps, scope: AssetScope, campaignId: string, assetId: string, opts: { actor: string; expectedRevision: number; replaceApproved?: boolean }): Promise<AssetResult<{ asset: AssetRecord }>> {
  if (!actorOk(opts?.actor)) return fail('invalid', 'Say who is regenerating this asset.', 'actor');
  if (!validRevision(opts.expectedRevision)) return fail('invalid', 'Say which version of the asset you are regenerating. Reload and try again.', 'revision');
  // In-flight guard, taken before any await so two clicks in the same tick cannot both pass. One regeneration per asset at a time;
  // a second call is refused without calling the generator. Released in `finally`, so a generator failure never leaves it held.
  const flightKey = [scope?.workspaceId, scope?.businessId, campaignId, assetId].map(String).join('\u0000');
  const flights = inFlight.get(deps.assets) ?? new Set<string>();
  inFlight.set(deps.assets, flights);
  if (flights.has(flightKey)) return fail('in_progress', 'This asset is already being regenerated. Wait for it to finish, then look at the result.', 'assetId');
  flights.add(flightKey);
  try {
    const listed = await listAssets(deps, scope, campaignId);
    if (!listed.ok) return listed;
    const loaded = await loadApprovedCampaign(deps, scope, campaignId);
    if (!loaded.ok) return loaded;
    if (!listed.current) return fail('stale', 'These assets were made from an older version of the campaign. Generate the assets again.');
    const seen = listed.set.assets.find((a) => a.id === assetId);
    const item = seen ? itemOf(loaded.campaign.plan, seen.itemId) : undefined;
    if (!seen || !item) return fail('not_found', 'That asset does not exist in this campaign.', 'assetId');
    if (seen.revision !== opts.expectedRevision) return { ok: false, errors: [wrongRevisionIssue] };
    const refuse = (a: AssetRecord): Step | null => (a.state === 'approved' && opts.replaceApproved !== true
      ? { error: { code: 'approved_asset', message: 'This asset is approved, so it was not replaced. Reject or edit it first, or regenerate with replaceApproved set to confirm.' } }
      : a.attempt >= MAX_REGENERATIONS ? { error: attemptLimitIssue } : null);
    const early = refuse(seen);
    if (early && 'error' in early) return { ok: false, errors: [early.error] };
    let content: AssetContent;
    try {
      content = await deps.generator.generate({ kind: seen.kind, item, plan: loaded.campaign.plan, theme: themeFor(loaded.campaign.plan, item), attempt: seen.attempt + 1 });
    } catch (e) {
      return fail('generator_failed', `The copy generator failed, so the asset was not changed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    const at = iso(deps.now);
    return await changeAsset(deps, scope, campaignId, assetId, (a) => {
      if (a.revision !== opts.expectedRevision) return wrongRevision();
      const again = refuse(a);
      if (again) return again;
      return { next: recordFor(a.kind, item, content as never, deps.generator.id, at, opts.actor.trim(), a.attempt + 1, a.revision + 1, a) };
    });
  } finally {
    flights.delete(flightKey);
  }
}
