// Demo wiring (fixtures only) for the campaign test page and tests (AMP-050): the REAL product, brand, catalogue and campaign
// code on in-memory stores, seeded with the existing demo catalogue helpers. Nothing here changes behaviour.
// The demo business has two approved listings and one draft listing (which the campaign must leave out).
import { getApprovedBrand } from '../branding/service.ts';
import { createDemoCatalogue, DEMO_BUSINESS, DEMO_WORKSPACE, demoCtx, seedApprovedBrand, seedApprovedProduct } from '../catalogue/demo.ts';
import type { DemoCatalogue } from '../catalogue/demo.ts';
import type { CatalogueListing } from '../catalogue/types.ts';
import { toolsEnabled } from '../files/demo.ts';
import { createProviderRegistry } from '../providers/index.ts';
import { createMemoryCampaignStore } from './store.ts';
import type { CampaignContext, CampaignStore, CampaignStoreRef } from './types.ts';

type Env = Readonly<Record<string, string | undefined>>;

export const DEMO_CAMPAIGN_SCOPE = { workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS } as const;

export interface CampaignDemo {
  d: DemoCatalogue;
  campaigns: CampaignStore;
  registry: ReturnType<typeof createProviderRegistry>;
  /** Listing ids seeded for the demo business: two approved, one left as a draft. */
  listingIds: { approved: string[]; draft: string };
  /** The brand, every listing version and the store, read fresh from the real services. */
  context(): Promise<CampaignContext>;
}

/** Only the two public store-address settings the storefront itself reads; nothing secret. */
export function storeEnv(env: Env): NonNullable<CampaignStoreRef['env']> {
  return { AIMP_STORE_ROOT_DOMAIN: env.AIMP_STORE_ROOT_DOMAIN, LAUNCHPAD_APP_ORIGIN: env.LAUNCHPAD_APP_ORIGIN };
}

export async function buildCampaignDemo(now: () => Date, env: Env): Promise<CampaignDemo> {
  const d = createDemoCatalogue(now, env);
  const ctx = { ...demoCtx, businessId: DEMO_BUSINESS };
  const approved: string[] = [];
  let draft = '';
  let first = true;
  for (const [blueprintId, approve] of [['printable-planner', true], ['printable-tracker', true], ['printable-checklist', false]] as const) {
    const p = await seedApprovedProduct(d, ctx, DEMO_BUSINESS, blueprintId);
    if (first) { await seedApprovedBrand(d, ctx, DEMO_BUSINESS, p.title); first = false; }
    const l = await d.catalogue.createDraft(ctx, { businessId: DEMO_BUSINESS, productId: p.productId });
    if (approve) { await d.catalogue.approveListing(ctx, l.listingId); approved.push(l.listingId); } else draft = l.listingId;
  }
  return {
    d, campaigns: createMemoryCampaignStore(), registry: createProviderRegistry({ env }), listingIds: { approved, draft },
    async context() {
      const brand = await getApprovedBrand({ store: d.brands }, { workspaceId: DEMO_WORKSPACE }, DEMO_BUSINESS);
      const listings: CatalogueListing[] = [];
      for (const id of [...approved, draft]) listings.push(...(await d.catalogue.listVersions(ctx, id)));
      // The demo catalogue is not attached to the published-store registry, so the store is taken as live at the brand's
      // store address. Production reads the status from the store registry (hosts/registry.ts `resolve`).
      const store: CampaignStoreRef = { slug: brand?.slug ?? '', status: 'live', env: storeEnv(env) };
      return { ...DEMO_CAMPAIGN_SCOPE, brand, listings, store };
    },
  };
}

type G = typeof globalThis & { __aimpCampaignDemo?: Promise<CampaignDemo> };

/** The shared demo for the test page, or null in production unless AIMP_TOOLS_ENABLED=1. Kept on globalThis so the page and its actions share it. */
export function campaignRuntime(env: Env = process.env): Promise<CampaignDemo> | null {
  if (!toolsEnabled(env)) return null;
  const g = globalThis as G;
  const p = (g.__aimpCampaignDemo ??= buildCampaignDemo(() => new Date(), env));
  p.catch(() => { if (g.__aimpCampaignDemo === p) delete g.__aimpCampaignDemo; });
  return p;
}
