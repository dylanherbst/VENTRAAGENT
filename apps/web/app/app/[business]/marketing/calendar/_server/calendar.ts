// Server read for the Campaign calendar (screen 27, AMP-131). Plain functions that take the /start runtime as an argument, so they run
// in the node tests without Next. The plan comes from the campaign service (AMP-050) and the state of each entry's text from the
// campaign-assets service (AMP-051); nothing is re-implemented here. The workspace always comes from the server (`MarketingContexts`),
// never from the request, so another workspace's or business's campaign reads the same as none.
//
// WHAT THE /START DEMO REALLY HAS. The /start runtime (`JourneyRuntime`) has no campaign store and no asset store today, so
// `creativeStoresOf` answers null and the page says "not available in the demo yet". Nothing is seeded or faked. When the runtime gains
// `campaigns: CampaignStore` and `campaignAssets: AssetStore`, this page starts working with no change.
import { listAssets } from '../../../../../../lib/aimp/campaign-assets/service.ts';
import { getCampaign } from '../../../../../../lib/aimp/campaigns/service.ts';
import { isBusinessId } from '../../../../../start/journey.ts';
import { isKnownBusiness } from '../../../_server/overview.ts';
import type { MarketingContexts } from '../../_server/marketing.ts';
import { assetDeps, creativeStoresOf } from '../../creative/_server/creative.ts';
import type { CreativeRuntime } from '../../creative/_server/creative.ts';
import { buildCalendarModel } from '../view-model.ts';
import type { CalendarModel } from '../view-model.ts';

/** The parts of the /start runtime this page reads: the same as Creative Studio. */
export type CalendarRuntime = CreativeRuntime;

export type CalendarLookup =
  | { found: false }
  /** The business exists but this runtime keeps no campaigns or no text drafts. */
  | { found: true; state: 'unavailable' }
  | { found: true; state: 'ready'; model: CalendarModel };

/** Bad or unknown business => `found: false`. A missing store => `unavailable`. Only this workspace's campaign for this business is read. */
export async function loadCalendar(rt: CalendarRuntime, ctx: Pick<MarketingContexts, 'workspaceId'>, businessId: unknown, now: () => Date = () => new Date()): Promise<CalendarLookup> {
  if (!isBusinessId(businessId) || !isKnownBusiness(rt, businessId)) return { found: false };
  const stores = creativeStoresOf(rt);
  if (!stores) return { found: true, state: 'unavailable' };
  const scope = { workspaceId: ctx.workspaceId, businessId };
  const ready = (model: CalendarModel): CalendarLookup => ({ found: true, state: 'ready', model });
  const campaign = await getCampaign({ store: stores.campaigns }, scope);
  // A record whose own ids are not this workspace and business is shown as no plan at all.
  if (!campaign || campaign.workspaceId !== scope.workspaceId || campaign.businessId !== scope.businessId
    || campaign.plan.workspaceId !== scope.workspaceId || campaign.plan.businessId !== scope.businessId) return ready({ state: 'no_plan' });
  if (campaign.status !== 'approved') return ready(buildCalendarModel(campaign, null));
  const listed = await listAssets(assetDeps(rt, stores, now), scope, campaign.id);
  if (listed.ok) return ready(buildCalendarModel(campaign, { set: listed.set, current: listed.current }));
  const code = listed.errors[0]?.code;
  if (code === 'not_found') return ready(buildCalendarModel(campaign, null));
  if (code === 'campaign_not_approved' || code === 'scope') return ready({ state: 'no_plan' });
  throw new Error(`Campaign text drafts could not be read (${code ?? 'unknown'}).`);
}
