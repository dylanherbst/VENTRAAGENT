'use server';
import { notFound, redirect } from 'next/navigation';
import { assetsRuntime } from '../../../lib/aimp/campaign-assets/demo.ts';
import type { AssetsDemo } from '../../../lib/aimp/campaign-assets/demo.ts';
import { approveAsset, editAsset, generateCampaignAssets, regenerateAsset, rejectAsset } from '../../../lib/aimp/campaign-assets/service.ts';
import { EDIT_CAPS } from '../../../lib/aimp/campaign-assets/types.ts';
import type { AssetKind, AssetResult } from '../../../lib/aimp/campaign-assets/types.ts';
import { demoCtx } from '../../../lib/aimp/catalogue/demo.ts';

const back = (msg: string): never => redirect(`/tools/aimp-campaign-assets?msg=${encodeURIComponent(msg)}`);
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
const actor = demoCtx.actorUserId;
const said = (r: AssetResult<object>, ok: string): never => back(r.ok ? ok : r.errors.map((e) => e.message).join(' '));

/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
async function guard(): Promise<AssetsDemo> {
  const p = assetsRuntime();
  if (!p) notFound();
  return p;
}

export async function generate(): Promise<void> {
  const rt = await guard();
  const r = await generateCampaignAssets(rt.deps, rt.scope, rt.campaignId, { actor });
  said(r, r.ok && r.created ? `Drafts made: ${r.set.assets.length} assets.${r.archivedVersion ? ` The earlier set for campaign version ${r.archivedVersion} was kept as an archive.` : ''}` : 'The assets already exist for this campaign version; nothing was overwritten.');
}

export async function approve(f: FormData): Promise<void> {
  const rt = await guard();
  const r = await approveAsset(rt.deps, rt.scope, rt.campaignId, field(f, 'assetId'), { actor, expectedRevision: Number(field(f, 'revision')) });
  said(r, 'Approved.');
}

export async function reject(f: FormData): Promise<void> {
  const rt = await guard();
  const r = await rejectAsset(rt.deps, rt.scope, rt.campaignId, field(f, 'assetId'), { actor, reason: field(f, 'reason'), expectedRevision: Number(field(f, 'revision')) });
  said(r, 'Rejected.');
}

/** The edit form carries only the main text fields of each kind. */
export async function edit(f: FormData): Promise<void> {
  const rt = await guard();
  const kind = field(f, 'kind') as AssetKind;
  // Refuse a runaway paste before splitting or copying it; the service enforces the same caps again on every edit.
  if (field(f, 'a').length + field(f, 'b').length > EDIT_CAPS.totalChars) back(`That edit is too large to save (the most allowed is ${EDIT_CAPS.totalChars} characters in total). Nothing was saved.`);
  const patch: Record<string, unknown> =
    kind === 'pin' ? { title: field(f, 'a'), description: field(f, 'b') }
      : kind === 'caption' ? { variants: field(f, 'a').split(/\r?\n---\r?\n/).map((s) => s.trim()).filter(Boolean) }
        : kind === 'video_script' ? { hook: field(f, 'a'), callToAction: field(f, 'b') }
          : { pageTitle: field(f, 'a'), metaDescription: field(f, 'b') };
  const r = await editAsset(rt.deps, rt.scope, rt.campaignId, field(f, 'assetId'), { actor, patch, expectedRevision: Number(field(f, 'revision')) });
  said(r, 'Saved. The asset is a draft again and needs a new approval.');
}

export async function regenerate(f: FormData): Promise<void> {
  const rt = await guard();
  const r = await regenerateAsset(rt.deps, rt.scope, rt.campaignId, field(f, 'assetId'), { actor, expectedRevision: Number(field(f, 'revision')), replaceApproved: field(f, 'replaceApproved') === '1' });
  said(r, 'A new draft was written.');
}
