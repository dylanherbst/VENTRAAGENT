// Server reads for the Brand kit page (screen 11, AMP-082; C01, C06). Plain functions that take the /start runtime as an argument,
// so they run in the node tests without Next. No brand rule lives here: every check is the brand service's own
// (lib/aimp/branding/service.ts), and saving and approving go through the existing `brandAction` in app/start/actions.ts.
//
// PREVIEW. `previewBrandChange` answers "what would my store take if I approved this?" without writing anything. It copies this
// one business's versions into a throwaway in-memory brand store and runs the REAL `editBrand` and `approveBrand` there, so the
// preview passes exactly the validation, contrast and approval rules a real save would. The runtime's store is only read.
import { approveBrand, editBrand, getApprovedBrandOutputs, getDraftBrand, listBrandVersions } from '../../../../../lib/aimp/branding/service.ts';
import type { BrandCtx } from '../../../../../lib/aimp/branding/service.ts';
import type { StorefrontBrand } from '../../../../../lib/aimp/branding/adapters.ts';
import { checkNameClash } from '../../../../../lib/aimp/branding/name-clash.ts';
import type { NameClash } from '../../../../../lib/aimp/branding/name-clash.ts';
import { createMemoryBrandStore } from '../../../../../lib/aimp/branding/store.ts';
import type { BrandStore } from '../../../../../lib/aimp/branding/store.ts';
import type { BrandEdits, BrandIssue, BrandProfile, ContrastCheck } from '../../../../../lib/aimp/branding/types.ts';
import { contrastChecks } from '../../../../../lib/aimp/branding/validate.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { describeBrandKit, impactRows } from '../view-model.ts';
import type { BrandKit, ImpactRow } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type BrandRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & { brands: BrandStore };

export type BrandKitLookup = { found: false } | { found: true; kit: BrandKit };

/** Unknown business => `found: false`. A known business with no saved brand comes back with `kit.state === 'no_brand'`. */
export async function loadBrandKit(rt: BrandRuntime, ctx: BrandCtx, businessId: string): Promise<BrandKitLookup> {
  const versions = await listBrandVersions({ store: rt.brands }, ctx, businessId);
  if (!versions.length && !isKnownBusiness(rt, businessId)) return { found: false };
  return { found: true, kit: describeBrandKit(versions) };
}

export type BrandPreview =
  | { ok: false; errors: BrandIssue[] }
  | {
    ok: true;
    /** The brand as it would be once approved. It exists only in the throwaway store. */
    brand: BrandProfile;
    storefront: StorefrontBrand;
    /** What the store uses today (null when nothing is approved yet). */
    live: StorefrontBrand | null;
    rows: ImpactRow[];
    changed: boolean;
    checks: ContrastCheck[];
    clash: NameClash;
    /** Another business already holds this store address, so approving would be refused. A yes/no read; nothing is written. */
    slugTaken: boolean;
  };

export const PREVIEW_ACTOR = 'preview-only';

export async function previewBrandChange(rt: BrandRuntime, ctx: BrandCtx, businessId: string, edits: BrandEdits, now: () => Date = () => new Date()): Promise<BrandPreview> {
  const versions = await listBrandVersions({ store: rt.brands }, ctx, businessId);
  if (!versions.length) return { ok: false, errors: [{ field: 'brand', message: 'There is no brand to preview yet.' }] };
  const liveOut = await getApprovedBrandOutputs({ store: rt.brands }, ctx, businessId);

  const scratch = createMemoryBrandStore();
  await scratch.mutate(ctx.workspaceId, businessId, () => ({ versions, result: null }));
  const deps = { store: scratch, now };
  const edited = await editBrand(deps, ctx, businessId, edits);
  if (!edited.ok) return { ok: false, errors: edited.errors };
  if (await getDraftBrand(deps, ctx, businessId)) {
    const approved = await approveBrand(deps, ctx, businessId, PREVIEW_ACTOR);
    if (!approved.ok) return { ok: false, errors: approved.errors };
  }
  const out = await getApprovedBrandOutputs(deps, ctx, businessId);
  if (!out) return { ok: false, errors: [{ field: 'brand', message: 'There is no brand to preview yet.' }] };

  const live = liveOut?.storefront ?? null;
  const rows = impactRows(live, out.storefront);
  return {
    ok: true, brand: out.brand, storefront: out.storefront, live, rows, changed: rows.some((r) => r.changed),
    checks: contrastChecks(out.brand.palette), clash: checkNameClash(out.brand.name),
    slugTaken: await rt.brands.isSlugTaken(out.brand.slug, { workspaceId: ctx.workspaceId, businessId }),
  };
}
