// Server wiring for the guided-setup journey (/start/brand, /start/products, /start/catalogue, /start/store).
// It is the same wiring the test pages use (tools/product-review/demo.ts, lib/aimp/catalogue/demo.ts,
// tools/site-publish): the REAL product, brand, catalogue and site-version services on in-memory stores, kept on
// globalThis so they survive hot reloads. The one difference is that the steps share ONE runtime and build from the
// customer's own chosen idea, so a product approved in one step is the product listed in the next.
// DEMO storage: nothing is written to a database, and everything here is lost when the server restarts.
import { createAudienceService, createMemoryAudienceStore } from '../../../lib/aimp/audience/index';
import type { AudienceService } from '../../../lib/aimp/audience/index';
import { blueprintRegistry } from '../../../lib/aimp/blueprints/index';
import { createMemoryBrandStore } from '../../../lib/aimp/branding/store';
import type { BrandStore } from '../../../lib/aimp/branding/store';
import { createCatalogueService } from '../../../lib/aimp/catalogue/service';
import type { CatalogueService } from '../../../lib/aimp/catalogue/service';
import { createMemoryCoverAssets } from '../../../lib/aimp/catalogue/store';
import type { OperationContext } from '../../../lib/aimp/catalogue/types';
import { generateProductSpec, ProductFactoryError } from '../../../lib/aimp/factory/generate';
import type { ProductSpec } from '../../../lib/aimp/factory/spec';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import { createProductService } from '../../../lib/aimp/products/service';
import { createSitePublishedStoreProbe, createTenantStoreSlugFor } from '../../../lib/aimp/products/published-store';
import { createMemoryProductStore } from '../../../lib/aimp/products/store';
import type { ProductService } from '../../../lib/aimp/products/service';
import type { ProductRecord } from '../../../lib/aimp/products/types';
import { createProviderRegistry } from '../../../lib/aimp/providers/index';
import { createFixtureEmail } from '../../../lib/aimp/providers/fixtures';
import { createSiteVersionStore } from '../../../lib/aimp/site-versions/store';
import type { Actor, SiteVersionStore } from '../../../lib/aimp/site-versions/store';
import { createInMemorySellerStore } from '../../../lib/aimp/sellers/index';
import type { SellerAccountStore } from '../../../lib/aimp/sellers/index';
import { createStartOrders } from './orders-runtime';
import type { StartOrders } from './orders-runtime';
import { createStartAutomation, publishStoreAsJob as publishStoreJob } from './automation-runtime';
import type { PublishStoreOutcome, StartAutomation } from './automation-runtime';
import { createStartMarketing } from './marketing-runtime';
import type { StartMarketing } from './marketing-runtime';
import { isBusinessId } from '../journey';
import type { Availability } from '../journey-types';

// SECURITY: there is no signed-in session behind these pages yet, so every call uses one fixed DEMO workspace and the
// business id the browser sends. Before any non-demo use the workspace and business MUST come from the verified
// session, never from the browser. Until then the stateful steps are off in production unless AIMP_TOOLS_ENABLED=1,
// exactly like the catalogue test page.
export const WORKSPACE = 'demo-workspace';
export const OWNER = 'demo-owner';
export const productCtx = { workspaceId: WORKSPACE, actorId: OWNER };
export const brandCtx = { workspaceId: WORKSPACE };
export const siteActor: Actor = { workspaceId: WORKSPACE, userId: OWNER };
export const catalogueCtx = (businessId: string): OperationContext => ({ workspaceId: WORKSPACE, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` });

export const MAX_PRODUCTS_PER_BUSINESS = 3;
/** A ceiling on what one server process will hold, so the demo store cannot be filled without limit. */
export const MAX_BUSINESSES = 200;

export type PlanInputs = Record<string, string | number>;
export interface BusinessSeed { blueprintId: string; inputs: PlanInputs }

export interface JourneyRuntime {
  llm: ReturnType<typeof createProviderRegistry>['llm'];
  products: ProductService;
  brands: BrandStore;
  assets: ReturnType<typeof createMemoryCoverAssets>;
  catalogue: CatalogueService;
  sites: SiteVersionStore;
  /** What each business builds from (blueprint + the inputs saved with the chosen idea). */
  seeds: Map<string, BusinessSeed>;
  productIds: Map<string, string[]>;
  slugs: Map<string, string>;
  businesses: Set<string>;
  /** Order store, checkout and fulfilment (fixtures) in the same workspace; read by the Orders pages (AMP-103). */
  orderDemo: StartOrders;
  /** The one seller account store (same object as `orderDemo.sellers`), read by Payments (AMP-107). */
  sellers: SellerAccountStore;
  /** Campaign store (AMP-050), read by Marketing, Creative Studio and Calendar (AMP-135). */
  campaigns: StartMarketing['campaigns'];
  /** Campaign-asset store (AMP-051), read by Creative Studio and Calendar (AMP-135). */
  campaignAssets: StartMarketing['campaignAssets'];
  /** The automation service and job engine of this runtime, read by Operator runs and Approvals (AMP-140). Runs come from publishStoreAsJob. */
  automation: StartAutomation;
  /** Opt-in capture service (AMP-053), fixtures only; read by the public store opt-in (app/s/[store]/_server/audience.ts). */
  audience: AudienceService;
}

type G = typeof globalThis & { __aimpStartJourney?: JourneyRuntime };

export async function makeSpec(rt: Pick<JourneyRuntime, 'llm'>, seed: BusinessSeed): Promise<ProductSpec> {
  const blueprint = blueprintRegistry.find(seed.blueprintId);
  if (!blueprint) throw new ProductFactoryError('That blueprint does not exist.');
  return generateProductSpec({ blueprint, inputs: seed.inputs, provider: rt.llm });
}

export function runtime(): JourneyRuntime {
  const g = globalThis as G;
  if (g.__aimpStartJourney) return g.__aimpStartJourney;
  const llm = createProviderRegistry({ env: process.env }).llm;
  const seeds = new Map<string, BusinessSeed>();
  const productStore = createMemoryProductStore();
  const products = createProductService({
    store: productStore,
    // AMP-151: archiving asks the real published-site data whether a live store still shows the product (same wiring as the journey
    // world, AMP-104). LAZY: `rt` (and its site store and slug map) is built after this service, so both are read only when the probe is
    // called. Scoped to workspace AND business: the slug comes from this business's own entry in rt.slugs, and the real site store must
    // list it among the demo owner's sites. A missing store is "no store"; a failing lookup throws and archive reports it as unknown.
    publishedStores: createSitePublishedStoreProbe({
      resolvePublished: (slug) => rt.sites.resolvePublished(slug),
      storeSlugFor: createTenantStoreSlugFor({
        sites: { listSites: (actor) => rt.sites.listSites(actor) },
        storeOf: (workspaceId, businessId) => {
          const slug = workspaceId === WORKSPACE ? rt.slugs.get(businessId) : undefined;
          return slug ? { slug, userId: OWNER } : null;
        },
      }),
    }),
    generateSpec: (p: ProductRecord) => {
      const seed = seeds.get(p.businessId);
      if (!seed) throw new ProductFactoryError('The details for this business are no longer on the server. Go back to your idea and choose it again.');
      return makeSpec({ llm }, { ...seed, blueprintId: p.blueprintId });
    },
  });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  // The ONE seller account store of this runtime (workspace WORKSPACE). Empty until something registers an account: only the
  // labelled sample orders register a fixture seller (orders-runtime.ts). Payments and Orders both read it.
  const sellers = createInMemorySellerStore();
  const catalogue = createCatalogueService({ products, brands, assets });
  const automation = createStartAutomation();
  const rt: JourneyRuntime = {
    llm, products, brands, assets, seeds, catalogue,
    sites: createSiteVersionStore(),
    productIds: new Map(), slugs: new Map(), businesses: new Set(),
    // Orders and fulfilment: same workspace and owner as the business, fixture payments and email (see orders-runtime.ts).
    sellers,
    orderDemo: createStartOrders({ workspaceId: WORKSPACE, actorId: OWNER, productStore, catalogue, sellers }),
    // Opt-in list (AMP-053): the real audience service on a memory store. Fixture email only (empty env, like the orders above).
    audience: createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() }),
    // Campaigns and campaign assets: in-memory stores, scoped by workspace and business inside the services (see marketing-runtime.ts).
    ...createStartMarketing(),
    // Automation (AMP-140): the real service on in-memory stores, scoped by workspace and business inside the service.
    automation,
  };
  // A publish-site job for a business with a store runs the real publish check over this runtime's own stores (AMP-146).
  rt.automation.connectPublish({
    workspaceId: WORKSPACE, sites: rt.sites, slugs: rt.slugs, catalogue, sellers,
    // Read at call time from the same fixture payments registry checkout uses.
    payments: () => ({ status: rt.orderDemo.registry.payments.status, adapter: rt.orderDemo.registry.payments.adapter }),
  });
  g.__aimpStartJourney = rt;
  return rt;
}

/**
 * AMP-149. Publish a business's store as a real, Operator-visible `publish-site` run (the AMP-146 checked publish) and drive it to its
 * result. Same store address the guided setup uses (`rt.slugs`). `idempotencyKey`: the same key never publishes twice.
 */
export function publishStoreAsJob(
  rt: Pick<JourneyRuntime, 'automation' | 'slugs'>,
  req: { workspaceId: string; businessId: string; idempotencyKey: string; actorUserId: string },
): Promise<PublishStoreOutcome> {
  // Skips "Ask me first": call only from an action the signed-in owner pressed, passing that owner (pending AMP-146-D).
  // The store address is looked up by workspace AND business: this runtime holds one workspace, so any other finds no store.
  return publishStoreJob(rt.automation, (workspaceId, businessId) => (workspaceId === WORKSPACE ? rt.slugs.get(businessId) : undefined), req);
}

export function availability(): Availability {
  return toolsEnabled()
    ? { available: true, reason: '' }
    : { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };
}

export function checkBusiness(businessId: unknown): businessId is string {
  return isBusinessId(businessId);
}

/** Remember a business the first time it writes anything; refuse new ones once the demo store is full. */
export function admit(rt: JourneyRuntime, businessId: string): boolean {
  if (rt.businesses.has(businessId)) return true;
  if (rt.businesses.size >= MAX_BUSINESSES) return false;
  rt.businesses.add(businessId);
  return true;
}
