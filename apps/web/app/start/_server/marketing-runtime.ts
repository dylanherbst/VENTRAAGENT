// Campaign store and campaign-asset store for the /start demo runtime (AMP-135). Server-only helper; no screen code.
// It gives the Marketing overview, Creative Studio and Campaign calendar pages what they read (`campaigns`, `campaignAssets`): the REAL
// in-memory stores from lib/aimp/campaigns and lib/aimp/campaign-assets. Nothing is seeded: with no plan yet the pages show their normal
// empty state, and "draft a plan" runs the real campaign service on the built-in plan (no AI call, no network, env never read).
// DEMO storage: lost when the server restarts. Workspace and business scoping is done by the services themselves on every call.
//
// Uses `.ts` import paths so the node tests can load it (runtime.ts itself cannot be loaded there). It never imports runtime.ts.
import { createMemoryAssetStore } from '../../../lib/aimp/campaign-assets/store.ts';
import type { AssetStore } from '../../../lib/aimp/campaign-assets/types.ts';
import { createMemoryCampaignStore } from '../../../lib/aimp/campaigns/store.ts';
import type { CampaignStore } from '../../../lib/aimp/campaigns/types.ts';

export interface StartMarketing {
  campaigns: CampaignStore;
  campaignAssets: AssetStore;
}

export function createStartMarketing(): StartMarketing {
  return { campaigns: createMemoryCampaignStore(), campaignAssets: createMemoryAssetStore() };
}
