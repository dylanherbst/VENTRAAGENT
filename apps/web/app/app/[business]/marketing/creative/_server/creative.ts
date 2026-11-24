// Server read for Creative Studio (screen 26, AMP-130). Plain functions that take the /start runtime as an argument, so they run in
// the node tests without Next. The approved campaign comes from the campaign service (AMP-050) and the assets from the campaign-assets
// service (AMP-051); nothing is re-implemented here. The workspace always comes from the server (`MarketingContexts`), never from the
// request, so another workspace's campaign or assets read the same as none.
//
// WHAT THE /START DEMO REALLY HAS. The /start runtime (`JourneyRuntime`) has no campaign store and no asset store today, so
// `creativeStoresOf` answers null and the page says "not available in the demo yet". Nothing is seeded or faked. When the runtime gains
// `campaigns: CampaignStore` and `campaignAssets: AssetStore`, this page starts working with no change.
import { createTemplateGenerator } from '../../../../../../lib/aimp/campaign-assets/generate.ts';
import { listAssets } from '../../../../../../lib/aimp/campaign-assets/service.ts';
import type { AssetDeps, AssetGenerator, AssetStore } from '../../../../../../lib/aimp/campaign-assets/types.ts';
import { getCampaign } from '../../../../../../lib/aimp/campaigns/service.ts';
import type { CampaignStore } from '../../../../../../lib/aimp/campaigns/types.ts';
import { isBusinessId } from '../../../../../start/journey.ts';
import { isKnownBusiness } from '../../../_server/overview.ts';
import { campaignStoreOf } from '../../_server/marketing.ts';
import type { MarketingContexts, MarketingRuntime } from '../../_server/marketing.ts';
import { buildAssetsModel } from '../view-model.ts';
import type { CreativeModel } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this (without the three optional parts, for now). */
export type CreativeRuntime = Pick<MarketingRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds' | 'brands' | 'sites' | 'catalogue' | 'campaigns'> & {
  campaignAssets?: AssetStore;
  /** The copy generator. When the runtime has none, the built-in template generator is used (no AI call). */
  assetGenerator?: AssetGenerator;
};

export interface CreativeStores { campaigns: CampaignStore; assets: AssetStore }

/** The campaign and asset stores of this runtime, or null when either is missing (the /start demo today). */
export function creativeStoresOf(rt: Pick<CreativeRuntime, 'campaigns' | 'campaignAssets'>): CreativeStores | null {
  const campaigns = campaignStoreOf(rt);
  const a = rt.campaignAssets;
  const assets = a && typeof a.get === 'function' && typeof a.mutate === 'function' && typeof a.archived === 'function' ? a : null;
  return campaigns && assets ? { campaigns, assets } : null;
}

/** What the campaign-assets service needs, built from the runtime's own stores. */
export function assetDeps(rt: Pick<CreativeRuntime, 'assetGenerator'>, stores: CreativeStores, now: () => Date): AssetDeps {
  return { campaigns: stores.campaigns, assets: stores.assets, generator: rt.assetGenerator ?? createTemplateGenerator(), now, publishing: 'not_connected' };
}

export type CreativeLookup =
  | { found: false }
  /** The business exists but this runtime keeps no campaigns or no assets. */
  | { found: true; state: 'unavailable' }
  | { found: true; state: 'ready'; model: CreativeModel };

/** Bad or unknown business => `found: false`. A missing store => `unavailable`. Only this workspace's assets for this business are read. */
export async function loadCreative(rt: CreativeRuntime, ctx: Pick<MarketingContexts, 'workspaceId'>, businessId: unknown, now: () => Date = () => new Date()): Promise<CreativeLookup> {
  if (!isBusinessId(businessId) || !isKnownBusiness(rt, businessId)) return { found: false };
  const stores = creativeStoresOf(rt);
  if (!stores) return { found: true, state: 'unavailable' };
  const scope = { workspaceId: ctx.workspaceId, businessId };
  const campaign = await getCampaign({ store: stores.campaigns }, scope);
  const none = (): CreativeLookup => ({ found: true, state: 'ready', model: { state: 'no_campaign', plan: campaign ? 'draft' : 'none' } });
  if (!campaign || campaign.status !== 'approved') return none();
  const listed = await listAssets(assetDeps(rt, stores, now), scope, campaign.id);
  if (listed.ok) return { found: true, state: 'ready', model: buildAssetsModel(listed.set, campaign, listed.current) };
  const code = listed.errors[0]?.code;
  if (code === 'not_found') return { found: true, state: 'ready', model: { state: 'no_assets', campaignId: campaign.id, campaignVersion: campaign.version } };
  // The service refused the campaign record itself (for example its own ids do not match this workspace and business): show nothing of it.
  if (code === 'campaign_not_approved' || code === 'scope') return { found: true, state: 'ready', model: { state: 'no_campaign', plan: 'none' } };
  throw new Error(`Campaign assets could not be read (${code ?? 'unknown'}).`);
}
