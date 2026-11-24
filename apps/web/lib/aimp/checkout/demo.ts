// Demo wiring (fixtures only) for the checkout test page and routes (AMP-041): the REAL catalogue, sellers gate, checkout and
// order services on in-memory stores, with the fixture payments adapter. LIVE has no Stripe adapter yet (AMP-043-D), so
// `checkoutRuntime()` returns null unless the demo tools are enabled. Kept on globalThis so routes and the page share it.
import { approveBrand, createBrandDraft } from '../branding/service.ts';
import { createDemoCatalogue, DEMO_BUSINESS, DEMO_WORKSPACE, demoCtx, seedApprovedProduct } from '../catalogue/demo.ts';
import type { DemoCatalogue } from '../catalogue/demo.ts';
import { DEFAULT_INPUTS } from '../factory/request.ts';
import { toolsEnabled } from '../files/demo.ts';
import { createOrderBook, createMemoryOrderStore } from '../orders/index.ts';
import type { OrderStore } from '../orders/index.ts';
import type { OrderBook } from '../files/types.ts';
import { createProviderRegistry } from '../providers/index.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../sellers/index.ts';
import type { SellerAccountStore } from '../sellers/index.ts';
import { createCheckoutService } from './service.ts';
import type { CheckoutService, StoreDirectory } from './service.ts';
import { FIXTURE_WEBHOOK_SECRET } from './signature.ts';

async function seedBrand(d: DemoCatalogue, businessId: string, productTitle: string, niche: string): Promise<void> {
  const bctx = { workspaceId: DEMO_WORKSPACE };
  const deps = { store: d.brands, now: () => new Date() };
  const made = await createBrandDraft(deps, bctx, businessId, { niche, audience: DEFAULT_INPUTS.audience, productTitle, productType: 'printable planner', formats: ['PDF'] });
  if (!made.ok) throw new Error(made.errors.map((e) => e.message).join(' '));
  const done = await approveBrand(deps, bctx, businessId, demoCtx.actorUserId);
  if (!done.ok) throw new Error(done.errors.map((e) => e.message).join(' '));
}

export const DEMO_SETUP_BUSINESS = 'demo-business-setup';
export const DEMO_STORES = { ready: 'demo-store', setup: 'demo-store-setup' } as const;

export interface DemoListingRow { key: string; storeSlug: string; listingId: string; label: string }
export interface CheckoutRuntime {
  d: DemoCatalogue;
  sellers: SellerAccountStore;
  orders: OrderStore;
  orderBook: OrderBook;
  checkout: CheckoutService;
  registry: ReturnType<typeof createProviderRegistry>;
  listings: DemoListingRow[];
  webhookSecret: string;
  /** Last signed event the page produced, kept so it can be replayed. */
  lastEvent: { rawBody: string; signature: string; eventId: string } | null;
  /** Orders the (stand-in) delivery hook was told about. Real delivery is AMP-042. */
  deliveryQueue: string[];
  message: string;
}

type G = typeof globalThis & { __aimpCheckoutDemo?: Promise<CheckoutRuntime> };

export function checkoutRuntime(env: Readonly<Record<string, string | undefined>> = process.env): Promise<CheckoutRuntime> | null {
  if (!toolsEnabled(env)) return null;
  const g = globalThis as G;
  const p = (g.__aimpCheckoutDemo ??= build(env));
  p.catch(() => { if (g.__aimpCheckoutDemo === p) delete g.__aimpCheckoutDemo; });
  return p;
}

export async function build(env: Readonly<Record<string, string | undefined>>): Promise<CheckoutRuntime> {
  const d = createDemoCatalogue(() => new Date(), env);
  const registry = createProviderRegistry({ env });
  const sellers = createInMemorySellerStore();
  const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
  const setup = FIXTURE_SELLERS.find((s) => s.key === 'onboarding_incomplete')?.snapshot;
  if (!ready || !setup) throw new Error('Seller fixtures are missing.');
  sellers.register({ workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS, stripeAccountId: ready.id, snapshot: ready, lastEventCreated: 0 });
  sellers.register({ workspaceId: DEMO_WORKSPACE, businessId: DEMO_SETUP_BUSINESS, stripeAccountId: setup.id, snapshot: setup, lastEventCreated: 0 });

  const listings: DemoListingRow[] = [];
  const seed = async (businessId: string, storeSlug: string, key: string, label: string, approve: boolean, brand: boolean, brandNiche = DEFAULT_INPUTS.niche) => {
    const ctx = { ...demoCtx, businessId: undefined };
    const p = await seedApprovedProduct(d, ctx, businessId);
    if (brand) await seedBrand(d, businessId, p.title, brandNiche);
    const l = await d.catalogue.createDraft(ctx, { businessId, productId: p.productId });
    if (approve) await d.catalogue.approveListing(ctx, l.listingId);
    listings.push({ key, storeSlug, listingId: l.listingId, label });
  };
  await seed(DEMO_BUSINESS, DEMO_STORES.ready, 'ready-approved', 'Ready seller, approved listing', true, true);
  await seed(DEMO_BUSINESS, DEMO_STORES.ready, 'ready-draft', 'Ready seller, draft (not approved) listing', false, false);
  // A second business needs its own brand; store addresses are unique, so it gets a different niche.
  await seed(DEMO_SETUP_BUSINESS, DEMO_STORES.setup, 'setup-approved', 'Seller setup not finished, approved listing', true, true, 'budget tracker spreadsheets');

  const known = new Map<string, { workspaceId: string; businessId: string }>([
    [DEMO_STORES.ready, { workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS }],
    [DEMO_STORES.setup, { workspaceId: DEMO_WORKSPACE, businessId: DEMO_SETUP_BUSINESS }],
  ]);
  const stores: StoreDirectory = { resolve: async (slug) => known.get(slug) ?? null };
  const orders = createMemoryOrderStore();
  const checkout = createCheckoutService({
    stores, catalogue: d.catalogue, sellers, orders, webhookSecret: FIXTURE_WEBHOOK_SECRET,
    payments: () => ({ status: registry.payments.status, adapter: registry.payments.adapter }),
    returnUrls: (slug) => ({ successUrl: `/tools/aimp-checkout?return=success&store=${encodeURIComponent(slug)}`, cancelUrl: `/tools/aimp-checkout?return=cancel&store=${encodeURIComponent(slug)}` }),
  });
  const rt: CheckoutRuntime = {
    d, sellers, orders, orderBook: createOrderBook(orders, [DEMO_WORKSPACE]), checkout, registry, listings,
    webhookSecret: FIXTURE_WEBHOOK_SECRET, lastEvent: null, deliveryQueue: [], message: '',
  };
  // Stand-in subscriber showing the AMP-042 hook: it only records the order id. It delivers nothing.
  checkout.onOrderPaid((o) => { rt.deliveryQueue.push(o.id); });
  return rt;
}
