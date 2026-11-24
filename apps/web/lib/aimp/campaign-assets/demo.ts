// Demo wiring (fixtures only) for the campaign-assets test page and tests (AMP-051): the REAL campaign and asset code on in-memory
// stores, with the demo business's campaign planned and approved. Nothing here changes behaviour.
import { buildCampaignDemo, DEMO_CAMPAIGN_SCOPE } from '../campaigns/demo.ts';
import type { CampaignDemo } from '../campaigns/demo.ts';
import { approveCampaign, regenerateCampaign } from '../campaigns/service.ts';
import { demoCtx } from '../catalogue/demo.ts';
import { toolsEnabled } from '../files/demo.ts';
import { createTemplateGenerator } from './generate.ts';
import { createMemoryAssetStore } from './store.ts';
import type { AssetDeps, AssetScope } from './types.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** A reserved .test domain, used only when no store domain is configured, so the DEMO export has full links. Never a real store. */
export const DEMO_STORE_DOMAIN = 'stores.example.test';
export const DEMO_ASSET_SCOPE: AssetScope = DEMO_CAMPAIGN_SCOPE;

export interface AssetsDemo {
  campaignDemo: CampaignDemo;
  deps: AssetDeps;
  scope: AssetScope;
  campaignId: string;
  storeDomain: 'configured' | 'demo_placeholder';
}

/** `placeholderDomain: false` keeps the plan's links relative when no store domain is configured (used to test the export refusal). */
export async function buildAssetsDemo(now: () => Date, env: Env, opts: { placeholderDomain?: boolean } = {}): Promise<AssetsDemo> {
  const configured = Boolean(env.AIMP_STORE_ROOT_DOMAIN || env.LAUNCHPAD_APP_ORIGIN);
  const campaignDemo = await buildCampaignDemo(now, configured || opts.placeholderDomain === false ? env : { ...env, AIMP_STORE_ROOT_DOMAIN: DEMO_STORE_DOMAIN });
  const ctx = await campaignDemo.context();
  const r = await regenerateCampaign({ store: campaignDemo.campaigns, now }, { ...ctx });
  if (!r.ok) throw new Error(`Demo campaign could not be planned: ${r.errors.map((e) => e.message).join(' ')}`);
  const a = await approveCampaign({ store: campaignDemo.campaigns, now }, ctx, demoCtx.actorUserId, { expectedVersion: r.campaign.version });
  if (!a.ok) throw new Error(`Demo campaign could not be approved: ${a.errors.map((e) => e.message).join(' ')}`);
  return {
    campaignDemo,
    deps: { campaigns: campaignDemo.campaigns, assets: createMemoryAssetStore(), generator: createTemplateGenerator(), now },
    scope: DEMO_ASSET_SCOPE,
    campaignId: a.campaign.id,
    storeDomain: configured ? 'configured' : 'demo_placeholder',
  };
}

type G = typeof globalThis & { __aimpAssetsDemo?: Promise<AssetsDemo> };

/** The shared demo for the test page, or null in production unless AIMP_TOOLS_ENABLED=1. Kept on globalThis so the page, actions and download share it. */
export function assetsRuntime(env: Env = process.env): Promise<AssetsDemo> | null {
  if (!toolsEnabled(env)) return null;
  const g = globalThis as G;
  const p = (g.__aimpAssetsDemo ??= buildAssetsDemo(() => new Date(), env));
  p.catch(() => { if (g.__aimpAssetsDemo === p) delete g.__aimpAssetsDemo; });
  return p;
}
