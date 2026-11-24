// First-journey acceptance harness (AMP-067). Wires the REAL aimp modules (onboarding, opportunities, selection, branding,
// factory, products, catalogue, site versions, storefront, sellers, checkout, orders, files, fulfilment, jobs, campaigns) once, on
// in-memory stores and fixture providers, and shares ONE set of stores between two test businesses, exactly as production shares
// one database between tenants. Only public functions are called. Nothing is live: no Stripe, storage, email or network.
//
// GAP (reported, not hidden): no production job kind builds a business. `selectIdea` saves a queued `build_business` record
// that nothing consumes, and the built-in `generate-product` / `publish-site` kinds are demo stubs. So the build below is a
// HARNESS job kind (`journey-build-business`) whose steps call the real services. Each step guards on what it already did,
// because the runner is at-least-once (a step can run again after a crash).
import { blueprintRegistry } from '../blueprints/index.ts';
import { approveBrand, createBrandDraft, getApprovedBrand } from '../branding/service.ts';
import { createMemoryBrandStore } from '../branding/store.ts';
import type { BrandProfile } from '../branding/types.ts';
import { toStoreProduct } from '../catalogue/storefront.ts';
import { createCatalogueService, toPublicListing } from '../catalogue/service.ts';
import type { CatalogueService } from '../catalogue/service.ts';
import { createMemoryCoverAssets } from '../catalogue/store.ts';
import type { CatalogueListing, CoverAsset, OperationContext as CatalogueCtx } from '../catalogue/types.ts';
import { createMemoryCampaignStore } from '../campaigns/store.ts';
import type { CampaignContext, CampaignStore } from '../campaigns/types.ts';
import { paySessionWithFixture } from '../checkout/fixture-events.ts';
import type { SignedEvent } from '../checkout/fixture-events.ts';
import { createCheckoutService } from '../checkout/service.ts';
import type { CheckoutService, StoreDirectory } from '../checkout/service.ts';
import { FIXTURE_WEBHOOK_SECRET } from '../checkout/signature.ts';
import type { OperationContext as JobCtx } from '../contracts.ts';
import { generateProductSpec } from '../factory/generate.ts';
import { createFlakyEmail } from '../fulfilment/demo.ts';
import type { FlakyEmail } from '../fulfilment/demo.ts';
import { grantTokenSigner } from '../fulfilment/link.ts';
import { createFulfilmentService } from '../fulfilment/service.ts';
import type { FulfilmentService } from '../fulfilment/service.ts';
import { createMemoryFulfilmentStore } from '../fulfilment/store.ts';
import type { FulfilmentStore, StoreScope } from '../fulfilment/types.ts';
import { createFilesService } from '../files/service.ts';
import type { FilesService } from '../files/service.ts';
import { createMemoryFileStorage } from '../files/storage.ts';
import type { FileStorage, StoredFile } from '../files/types.ts';
import { registryFromSiteVersions } from '../hosts/registry.ts';
import type { StoreRegistry } from '../hosts/registry.ts';
import { createJobRegistry, createJobRunner, createJobService, createMemoryJobStore } from '../jobs/index.ts';
import type { JobKindDefinition, JobRecord } from '../jobs/index.ts';
import { answerKey, setAnswer, stepIds, toProfile } from '../onboarding/model.ts';
import type { Answers } from '../onboarding/model.ts';
import { findOpportunities } from '../opportunities/find.ts';
import type { FinderResult, OpportunityIdea } from '../opportunities/types.ts';
import { createMemoryOrderStore, createOrderBook } from '../orders/index.ts';
import type { OrderStore } from '../orders/index.ts';
import { createProductService } from '../products/service.ts';
import { createSitePublishedStoreProbe, createTenantStoreSlugFor } from '../products/published-store.ts';
import type { ProductService } from '../products/service.ts';
import { createMemoryProductStore } from '../products/store.ts';
import type { ProductStore } from '../products/types.ts';
import { createProviderRegistry } from '../providers/index.ts';
import type { OutboxMessage } from '../providers/types.ts';
import { selectIdea } from '../selection/select.ts';
import type { SelectResult, SelectionStore } from '../selection/select.ts';
import { createMemoryStore as createMemorySelectionStore } from '../selection/memory-store.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../sellers/index.ts';
import { createSiteVersionStore } from '../site-versions/store.ts';
import type { SiteVersionStore } from '../site-versions/store.ts';
import type { StoreConfig } from '../storefront/schema.ts';
import { JOURNEY_DOWNLOAD_PATH, JOURNEY_FILES_SECRET, JOURNEY_KEYS, JOURNEY_ROOT_DOMAIN, JOURNEY_SEEDS, JOURNEY_START } from './fixtures.ts';
import type { JourneyKey, JourneySeed } from './fixtures.ts';

export const BUILD_JOB = 'journey-build-business';
export const BUILD_STEPS = ['brand', 'product', 'listing', 'seller', 'publish'] as const;
export type BuildStep = (typeof BUILD_STEPS)[number];

/** What the harness knows about one test business as it moves through the journey. Real work is counted in `effects`. */
export interface JourneyBusiness {
  seed: JourneySeed;
  answers: Answers;
  ideas: OpportunityIdea[];
  idea: OpportunityIdea | null;
  businessId: string | null;
  slug: string | null;
  brand: BrandProfile | null;
  productId: string | null;
  versionId: string | null;
  productVersion: number | null;
  productTitle: string | null;
  master: StoredFile | null;
  listingId: string | null;
  siteVersion: number | null;
  siteCreated: boolean;
  sellerConnected: boolean;
  /** How many times each real effect actually ran. Every one must end at exactly 1. */
  effects: Record<BuildStep, number>;
  buildJobId: string | null;
}

export interface JourneyWorld {
  clock: { t: number };
  now: () => Date;
  biz: Record<JourneyKey, JourneyBusiness>;
  products: ProductStore;
  productService: ProductService;
  brands: ReturnType<typeof createMemoryBrandStore>;
  catalogue: CatalogueService;
  orders: OrderStore;
  storage: FileStorage;
  files: FilesService;
  sites: SiteVersionStore;
  storeRegistry: StoreRegistry;
  selections: SelectionStore;
  campaigns: CampaignStore;
  checkout: CheckoutService;
  fulfilment: FulfilmentService;
  fulfilmentStore: FulfilmentStore;
  email: FlakyEmail;
  registry: ReturnType<typeof createProviderRegistry>;
  webhookSecret: string;
  jobs: ReturnType<typeof createJobStack>;
  /** Intake: the owner's answers, one step at a time through the real validators. */
  intake(key: JourneyKey): { complete: boolean; profileOk: boolean };
  /** Five ranked ideas for the answers (fixture evidence, labelled demo). */
  rankIdeas(key: JourneyKey): FinderResult;
  /** Choose an idea: one durable business record plus one queued build record. */
  chooseIdea(key: JourneyKey, rank?: number): Promise<Extract<SelectResult, { ok: true }>>;
  /** One real build step; safe to run again. Returns what the step saved. */
  runStep(key: JourneyKey, step: BuildStep): Promise<Record<string, string | number | boolean>>;
  /** Enqueue the build job for a chosen business (idempotent per business). */
  enqueueBuild(key: JourneyKey): Promise<{ job: JobRecord; created: boolean }>;
  /** Enqueue and run to the end on a fresh runner. */
  build(key: JourneyKey): Promise<JobRecord>;
  scope(key: JourneyKey): StoreScope;
  catalogueCtx(key: JourneyKey): CatalogueCtx;
  startOrder(key: JourneyKey, opts?: { email?: string; idempotencyKey?: string }): Promise<{ orderId: string; sessionId: string }>;
  payEvent(sessionId: string): Promise<SignedEvent>;
  buy(key: JourneyKey, opts?: { email?: string; idempotencyKey?: string }): Promise<{ orderId: string; sessionId: string; event: SignedEvent }>;
  tokenIn(message: Pick<OutboxMessage, 'text'>): string | null;
  /** The brand, listings and store as the campaign planner must see them, read from the real services. */
  campaignContext(key: JourneyKey): Promise<CampaignContext>;
  listing(key: JourneyKey): Promise<CatalogueListing>;
}

function createJobStack(now: () => number, defs: JobKindDefinition[]) {
  const registry = createJobRegistry(defs);
  const store = createMemoryJobStore();
  const service = createJobService({ store, registry, now });
  const runner = (owner: string) => createJobRunner({ store, registry, owner, now, random: () => 0, leaseMs: 60_000, backoff: { baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0 } });
  return { registry, store, service, runner };
}

const emptyEffects = (): Record<BuildStep, number> => ({ brand: 0, product: 0, listing: 0, seller: 0, publish: 0 });

export async function createJourneyWorld(opts: { env?: Readonly<Record<string, string | undefined>>; seeds?: Readonly<Record<JourneyKey, JourneySeed>> } = {}): Promise<JourneyWorld> {
  const env = opts.env ?? {};
  const seeds = opts.seeds ?? JOURNEY_SEEDS;
  const clock = { t: JOURNEY_START };
  const now = () => new Date(clock.t);
  const registry = createProviderRegistry({ env });
  const readySeller = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
  if (!readySeller) throw new Error('Seller fixtures are missing.');

  const products = createMemoryProductStore();
  // AMP-104: archiving asks the real published-site data whether a live store still shows the product. The store lookup is
  // scoped to workspace AND business and confirmed against the real site store; `sites` and `biz` exist by the time it runs.
  const publishedStores = createSitePublishedStoreProbe({
    resolvePublished: (slug) => sites.resolvePublished(slug),
    storeSlugFor: createTenantStoreSlugFor({
      sites: { listSites: (actor) => sites.listSites(actor) },
      storeOf: (workspaceId, businessId) => {
        const b = JOURNEY_KEYS.map((k) => biz[k]).find((x) => x.seed.workspaceId === workspaceId && x.businessId === businessId && x.slug);
        return b?.slug ? { slug: b.slug, userId: b.seed.ownerId } : null;
      },
    }),
  });
  const productService = createProductService({ store: products, now, publishedStores, generateSpec: async () => { throw new Error('Regeneration is not part of this journey.'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products: productService, brands, assets, now });
  const sellers = createInMemorySellerStore();
  const orders = createMemoryOrderStore();
  const storage = createMemoryFileStorage();
  const workspaceIds = [...new Set(JOURNEY_KEYS.map((k) => seeds[k].workspaceId))];
  const files = createFilesService({ storage, products, secret: JOURNEY_FILES_SECRET, now, orders: createOrderBook(orders, workspaceIds) });
  const sites = createSiteVersionStore({ now });
  const actorOf = (b: JourneyBusiness) => ({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId });
  const storeRegistry = registryFromSiteVersions(sites, async () => {
    const out: string[] = [];
    for (const k of JOURNEY_KEYS) {
      const r = await sites.listSites({ workspaceId: seeds[k].workspaceId, userId: seeds[k].ownerId });
      if (r.ok) out.push(...r.value);
    }
    return out;
  });
  const selections = createMemorySelectionStore();
  const campaigns = createMemoryCampaignStore();

  const biz = {} as Record<JourneyKey, JourneyBusiness>;
  for (const k of JOURNEY_KEYS) {
    biz[k] = {
      seed: seeds[k], answers: {}, ideas: [], idea: null, businessId: null, slug: null, brand: null, productId: null, versionId: null,
      productVersion: null, productTitle: null, master: null, listingId: null, siteVersion: null, siteCreated: false, sellerConnected: false,
      effects: emptyEffects(), buildJobId: null,
    };
  }
  const need = <T>(v: T | null, what: string): T => { if (v === null) throw new Error(`The journey has not reached "${what}" for this business yet.`); return v; };
  const catalogueCtx = (k: JourneyKey): CatalogueCtx => ({ workspaceId: biz[k].seed.workspaceId, businessId: need(biz[k].businessId, 'choose an idea'), actorUserId: biz[k].seed.ownerId, idempotencyKey: `journey-${k}` });
  const scope = (k: JourneyKey): StoreScope => ({ workspaceId: biz[k].seed.workspaceId, businessId: need(biz[k].businessId, 'choose an idea'), actorId: biz[k].seed.ownerId });
  const bySlug = (slug: string) => JOURNEY_KEYS.map((k) => biz[k]).find((b) => b.slug === slug);

  // A store can be bought from only while its PUBLISHED version is live (the registry never returns a draft).
  const directory: StoreDirectory = {
    resolve: async (slug) => {
      const b = bySlug(slug);
      if (!b || !b.businessId) return null;
      return (await storeRegistry.resolve(slug)).status === 'live' ? { workspaceId: b.seed.workspaceId, businessId: b.businessId } : null;
    },
  };
  const checkout = createCheckoutService({
    stores: directory, catalogue, sellers, orders, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    payments: () => ({ status: registry.payments.status, adapter: registry.payments.adapter }),
    returnUrls: (slug) => ({ successUrl: `/s/${encodeURIComponent(slug)}?return=success`, cancelUrl: `/s/${encodeURIComponent(slug)}?return=cancel` }),
  });
  const baseEmail = registry.email.adapter;
  if (!baseEmail) throw new Error('The fixture email adapter is off.');
  const email = createFlakyEmail(baseEmail);
  const fulfilmentStore = createMemoryFulfilmentStore();
  const fulfilment = createFulfilmentService({
    orders, files, stores: directory, store: fulfilmentStore, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    email: () => email,
    downloadUrl: ({ token }) => `${JOURNEY_DOWNLOAD_PATH}/${token}`,
    grantToken: grantTokenSigner(JOURNEY_FILES_SECRET),
    storeName: (slug) => bySlug(slug)?.brand?.name ?? null,
  });
  fulfilment.attachToCheckout(checkout);

  // ---- the build steps (real services) ----
  const steps: Record<BuildStep, (k: JourneyKey) => Promise<Record<string, string | number | boolean>>> = {
    async brand(k) {
      const b = biz[k];
      if (b.brand) return { brandId: b.brand.id, slug: b.brand.slug, reused: true };
      const idea = need(b.idea, 'choose an idea');
      const deps = { store: brands, now };
      const ctx = { workspaceId: b.seed.workspaceId };
      const businessId = need(b.businessId, 'choose an idea');
      const made = await createBrandDraft(deps, ctx, businessId, { niche: idea.niche, audience: idea.whoToSellTo, formats: ['PDF'] });
      if (!made.ok) throw new Error(made.errors.map((e) => e.message).join(' '));
      const done = await approveBrand(deps, ctx, businessId, b.seed.ownerId);
      if (!done.ok) throw new Error(done.errors.map((e) => e.message).join(' '));
      b.effects.brand += 1;
      b.brand = done.brand;
      b.slug = done.brand.slug;
      return { brandId: done.brand.id, slug: done.brand.slug, reused: false };
    },
    async product(k) {
      const b = biz[k];
      if (b.productId) return { productId: b.productId, version: need(b.productVersion, 'product'), reused: true };
      const idea = need(b.idea, 'choose an idea');
      const businessId = need(b.businessId, 'choose an idea');
      const blueprint = blueprintRegistry.find(idea.blueprint.id);
      if (!blueprint) throw new Error(`Blueprint ${idea.blueprint.id} is missing.`);
      const spec = await generateProductSpec({
        blueprint, provider: registry.llm,
        inputs: { niche: idea.niche, audience: idea.whoToSellTo, pricePointMinor: 1400, weeklyHours: b.answers.weeklyHours ?? 5, budgetMinor: b.answers.budgetMinor ?? 5000 },
      });
      const pctx = { workspaceId: b.seed.workspaceId, actorId: b.seed.ownerId };
      const { product, version } = await productService.createProduct(pctx, { businessId, spec });
      const approved = await productService.approve(pctx, version.id);
      const buyer = await productService.getBuyerFile(pctx, product.id);
      const master: StoredFile = { fileName: buyer.fileName, contentType: buyer.contentType, bytes: buyer.bytes };
      await files.storeMaster({ ...pctx, businessId }, approved.id, master);
      for (const role of ['cover', 'preview', 'master'] as const) {
        const a: CoverAsset = { id: `${product.id}-${role}`, workspaceId: b.seed.workspaceId, businessId, productId: product.id, role };
        assets.add(a);
      }
      b.effects.product += 1;
      b.productId = product.id; b.versionId = approved.id; b.productVersion = approved.version; b.productTitle = spec.title; b.master = master;
      return { productId: product.id, version: approved.version, reused: false };
    },
    async listing(k) {
      const b = biz[k];
      if (b.listingId) return { listingId: b.listingId, priceMinor: (await world.listing(k)).priceMinor, reused: true };
      const ctx = catalogueCtx(k);
      const draft = await catalogue.createDraft(ctx, { businessId: ctx.businessId as string, productId: need(b.productId, 'product') });
      const approved = await catalogue.approveListing(ctx, draft.listingId);
      b.effects.listing += 1;
      b.listingId = approved.listingId;
      return { listingId: approved.listingId, priceMinor: approved.priceMinor, reused: false };
    },
    async seller(k) {
      const b = biz[k];
      if (b.sellerConnected) return { account: b.seed.sellerAccountId, reused: true };
      sellers.register({ workspaceId: b.seed.workspaceId, businessId: need(b.businessId, 'choose an idea'), stripeAccountId: b.seed.sellerAccountId, snapshot: { ...readySeller, id: b.seed.sellerAccountId }, lastEventCreated: 0 });
      b.effects.seller += 1;
      b.sellerConnected = true;
      return { account: b.seed.sellerAccountId, reused: false };
    },
    async publish(k) {
      const b = biz[k];
      if (b.siteVersion !== null) return { version: b.siteVersion, reused: true };
      const brand = need(b.brand, 'brand');
      const listing = await catalogue.getApprovedListing(catalogueCtx(k), need(b.listingId, 'listing'));
      if (!listing) throw new Error('The approved listing is missing.');
      const actor = actorOf(b);
      if (!b.siteCreated) {
        const made = await sites.createSite(actor, storeConfigFor(brand, listing, b.productTitle ?? listing.title, b.sellerConnected));
        if (!made.ok) throw new Error(`Store draft refused: ${made.errors.join('; ')}`);
        b.siteCreated = true;
      }
      const pub = await sites.publish(actor, need(b.slug, 'brand'), { note: 'First journey: test storefront' });
      if (!pub.ok) throw new Error(`Publish refused: ${pub.errors.join('; ')}`);
      b.effects.publish += 1;
      b.siteVersion = pub.value.version;
      return { version: pub.value.version, reused: false };
    },
  };

  const keyOfInput = (input: unknown): JourneyKey => {
    const v = typeof input === 'object' && input !== null ? (input as { key?: unknown }).key : null;
    if (v === 'a' || v === 'b') return v;
    throw new Error('The build job has no business key.');
  };
  const buildJob: JobKindDefinition = {
    kind: BUILD_JOB,
    steps: BUILD_STEPS.map((name) => ({ name, run: async ({ input }) => ({ output: await steps[name](keyOfInput(input)) }) })),
  };
  const jobs = createJobStack(() => clock.t, [buildJob]);
  const jobCtx = (k: JourneyKey): JobCtx => ({ workspaceId: biz[k].seed.workspaceId, businessId: need(biz[k].businessId, 'choose an idea'), actorUserId: biz[k].seed.ownerId, idempotencyKey: `build:${biz[k].businessId}` });

  let n = 0;
  const startOrder: JourneyWorld['startOrder'] = async (k, o = {}) => {
    const b = biz[k];
    const r = await checkout.startCheckout({ storeSlug: need(b.slug, 'brand'), listingId: need(b.listingId, 'listing'), buyerEmail: o.email ?? b.seed.buyerEmail, idempotencyKey: o.idempotencyKey ?? `journey-order-${++n}` });
    if (!r.ok) throw new Error(`Checkout refused: ${r.code}`);
    return { orderId: r.orderId, sessionId: r.sessionId };
  };
  const payEvent: JourneyWorld['payEvent'] = async (sessionId) => {
    const adapter = registry.payments.adapter;
    if (!adapter) throw new Error('The fixture payments adapter is off.');
    return paySessionWithFixture(adapter, sessionId, FIXTURE_WEBHOOK_SECRET, now());
  };
  const esc = JOURNEY_DOWNLOAD_PATH.replace(/[/]/g, '\\/');
  const tokenRe = new RegExp(`${esc}\\/([A-Za-z0-9._-]+)`);

  const world: JourneyWorld = {
    clock, now, biz, products, productService, brands, catalogue, orders, storage, files, sites, storeRegistry, selections, campaigns, checkout,
    fulfilment, fulfilmentStore, email, registry, webhookSecret: FIXTURE_WEBHOOK_SECRET, jobs,
    intake(k) {
      const b = biz[k];
      let answers: Answers = {};
      for (const step of stepIds) {
        const r = setAnswer(answers, step, b.seed.answers[answerKey[step]]);
        if (r.error) throw new Error(`Intake step "${step}" was refused: ${r.error}`);
        answers = r.answers;
      }
      b.answers = answers;
      const profile = toProfile(answers);
      return { complete: profile.ok, profileOk: profile.ok };
    },
    rankIdeas(k) {
      const b = biz[k];
      const profile = toProfile(b.answers);
      if (!profile.ok) throw new Error(`Intake is not finished: ${profile.missing.join(', ')}.`);
      const result = findOpportunities(profile.profile, { now });
      b.ideas = result.ideas;
      return result;
    },
    async chooseIdea(k, rank) {
      const b = biz[k];
      if (b.ideas.length === 0) throw new Error('Rank ideas first.');
      // The second business never takes the niche the first one already chose, so the two businesses are really different.
      const taken = new Set(JOURNEY_KEYS.filter((o) => o !== k).map((o) => biz[o].idea?.niche).filter((x): x is string => Boolean(x)));
      const idea = rank ? b.ideas[rank - 1] : b.ideas.find((i) => !taken.has(i.niche));
      if (!idea) throw new Error('There is no idea to choose.');
      const r = await selectIdea(b.seed.workspaceId, idea, undefined, { store: selections, now });
      if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(' '));
      b.idea = idea;
      b.businessId = r.selection.business.id;
      return r;
    },
    runStep: (k, step) => steps[step](k),
    async enqueueBuild(k) {
      const r = await jobs.service.enqueue(jobCtx(k), { kind: BUILD_JOB, input: { key: k } });
      biz[k].buildJobId = r.job.id;
      return r;
    },
    async build(k) {
      const { job } = await world.enqueueBuild(k);
      await jobs.runner(`runner-${k}`).drain();
      return jobs.service.get(jobCtx(k), job.id);
    },
    scope, catalogueCtx, startOrder, payEvent,
    async buy(k, o) {
      const started = await startOrder(k, o);
      const event = await payEvent(started.sessionId);
      await checkout.handlePaymentEvent(event);
      return { ...started, event };
    },
    tokenIn: (m) => tokenRe.exec(m.text)?.[1] ?? null,
    async campaignContext(k) {
      const b = biz[k];
      const brand = await getApprovedBrand({ store: brands }, { workspaceId: b.seed.workspaceId }, need(b.businessId, 'choose an idea'));
      const listings = await catalogue.listVersions(catalogueCtx(k), need(b.listingId, 'listing'));
      const resolved = await storeRegistry.resolve(need(b.slug, 'brand'));
      return { workspaceId: b.seed.workspaceId, businessId: b.businessId as string, brand, listings, store: { slug: b.slug as string, status: resolved.status === 'live' ? 'live' : resolved.status, env: { AIMP_STORE_ROOT_DOMAIN: JOURNEY_ROOT_DOMAIN } } };
    },
    async listing(k) {
      const l = await catalogue.getApprovedListing(catalogueCtx(k), need(biz[k].listingId, 'listing'));
      if (!l) throw new Error('The approved listing is missing.');
      return l;
    },
  };
  return world;
}

/** The storefront config built from the APPROVED brand and the APPROVED listing only (never from the draft). */
export function storeConfigFor(brand: BrandProfile, listing: CatalogueListing, productTitle: string, chargesEnabled: boolean): StoreConfig {
  const p = toStoreProduct(toPublicListing(listing), { coverStyle: brand.visual.coverStyle, includes: [`${productTitle} (PDF download)`], featured: true });
  return {
    version: 1, slug: brand.slug, status: 'draft', demo: false,
    brand: { name: brand.name, tagline: brand.tagline, theme: 'pearl', font: brand.font },
    hero: { eyebrow: brand.input.niche.slice(0, 60), heading: brand.name.slice(0, 90), subheading: brand.shortDescription.slice(0, 220), ctaLabel: 'See the download' },
    sections: ['featured', 'catalogue', 'faq'],
    products: [{ ...p, productId: listing.productId, cover: { style: p.cover.style, label: p.title.slice(0, 28) } }],
    bundles: [],
    faq: [{ question: 'How do I get my file?', answer: 'After payment we email you a private download link.' }],
    trust: [],
    policies: {
      refund: ['This is a digital download. If the file is faulty or not as described, contact us and we will replace it or refund you.'],
      privacy: ['We use your name and email only to deliver your file and give support.'],
      terms: ['Files are licensed for personal use. Prices are in Australian dollars.'],
    },
    contact: { email: `hello@${brand.slug}.example.test`, responseTime: 'within 2 business days', businessName: brand.name },
    merchant: { chargesEnabled },
    seo: { title: brand.name.slice(0, 70), description: brand.shortDescription.slice(0, 160) },
  };
}
