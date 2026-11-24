// Server read for the Marketing overview (screen 25, AMP-129). Plain functions that take the /start runtime as an argument, so they
// run in the node tests without Next. The campaign itself comes from the campaign service (lib/aimp/campaigns, AMP-050); the brand,
// listings and store it is planned from are read fresh from the runtime's own services. The workspace always comes from the server
// (`MarketingContexts`), never from the request, so another workspace's campaign reads the same as none.
//
// WHAT THE /START DEMO REALLY HAS. The /start runtime (`JourneyRuntime`, app/start/_server/runtime.ts) has no campaign store today,
// so `campaignStoreOf` answers null and the page says "not available in the demo yet". Nothing is seeded or faked here. When the
// runtime gains a `campaigns: CampaignStore` property, this page starts working with no change.
import { getApprovedBrand } from '../../../../../lib/aimp/branding/service.ts';
import type { CatalogueService } from '../../../../../lib/aimp/catalogue/service.ts';
import type { OperationContext } from '../../../../../lib/aimp/catalogue/types.ts';
import { getCampaign } from '../../../../../lib/aimp/campaigns/service.ts';
import type { CampaignContext, CampaignListing, CampaignStore, CampaignStoreRef } from '../../../../../lib/aimp/campaigns/types.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { buildMarketingModel } from '../view-model.ts';
import type { MarketingModel } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this (without `campaigns`, for now). */
export type MarketingRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds' | 'brands' | 'sites'> & {
  catalogue: Pick<CatalogueService, 'listApprovedForBusiness' | 'listVersions'>;
  campaigns?: CampaignStore;
};

/** Server-side identity and contexts (from app/start/_server/runtime.ts). Never built from the request. */
export interface MarketingContexts {
  workspaceId: string;
  ownerId: string;
  catalogueCtx: (businessId: string) => OperationContext;
  /** The two public store-address settings the storefront reads; nothing secret. */
  storeEnv?: CampaignStoreRef['env'];
}

/** The campaign store of this runtime, or null when it has none (the /start demo today). */
export function campaignStoreOf(rt: Pick<MarketingRuntime, 'campaigns'>): CampaignStore | null {
  const s = rt.campaigns;
  return s && typeof s.get === 'function' && typeof s.mutate === 'function' ? s : null;
}

/** The brand, every listing version and the store of ONE business as they are now: what a plan is built from and re-checked against. */
export async function campaignContext(rt: MarketingRuntime, ctx: MarketingContexts, businessId: string): Promise<CampaignContext> {
  const brand = await getApprovedBrand({ store: rt.brands }, { workspaceId: ctx.workspaceId }, businessId);
  const cctx = ctx.catalogueCtx(businessId);
  const listings: CampaignListing[] = [];
  for (const l of await rt.catalogue.listApprovedForBusiness(cctx, businessId)) listings.push(...(await rt.catalogue.listVersions(cctx, l.listingId)));
  const slug = rt.slugs.get(businessId) ?? '';
  const pub = slug ? await rt.sites.resolvePublished(slug) : { status: 'none' as const };
  const store: CampaignStoreRef = { slug, status: pub.status, ...(ctx.storeEnv ? { env: ctx.storeEnv } : {}) };
  return { workspaceId: ctx.workspaceId, businessId, brand, listings, store };
}

export type MarketingLookup =
  | { found: false }
  /** The business exists but this runtime has no campaign store. */
  | { found: true; state: 'unavailable' }
  | { found: true; state: 'ready'; model: MarketingModel };

/** Bad or unknown business => `found: false`. No campaign store => `unavailable`. Only this workspace's campaign for this business is read. */
export async function loadMarketing(rt: MarketingRuntime, ctx: MarketingContexts, businessId: unknown): Promise<MarketingLookup> {
  if (!isBusinessId(businessId) || !isKnownBusiness(rt, businessId)) return { found: false };
  const store = campaignStoreOf(rt);
  if (!store) return { found: true, state: 'unavailable' };
  const campaign = await getCampaign({ store }, { workspaceId: ctx.workspaceId, businessId });
  return { found: true, state: 'ready', model: buildMarketingModel(campaign) };
}
