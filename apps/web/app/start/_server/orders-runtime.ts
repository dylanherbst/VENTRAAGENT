// Order store, checkout and fulfilment for the /start demo runtime (AMP-103). Server-only helpers; no screen code.
// It wires the REAL checkout, order, files and fulfilment services on in-memory stores, in the same workspace as the /start
// businesses, with FIXTURE payments and FIXTURE email only (no network, no Stripe, no mail sent). Everything is DEMO storage and is
// lost when the server restarts.
//
// This file uses `.ts` import paths and takes everything it needs as arguments, so the node tests can load it (runtime.ts itself
// cannot be loaded there). It never imports runtime.ts.
//
// SAMPLE DATA. A /start business has no seller account, so checkout is gated. `createSampleOrders` passes that gate honestly: it
// registers a FIXTURE seller account for the business, clearly labelled as sample data (id `acct_sample_demo_<business>`, the real
// "ready" fixture snapshot), and then buys through the real path: startCheckout -> fixture payment -> signed paid event ->
// handlePaymentEvent -> fulfilment delivers a link by fixture email. Buyers are `sample-buyer-N@example.test`. No row is written
// to any store directly, and no lib service contains seeded data.
import { createHash, randomBytes } from 'node:crypto';
import type { CatalogueService } from '../../../lib/aimp/catalogue/service.ts';
import { paySessionWithFixture } from '../../../lib/aimp/checkout/fixture-events.ts';
import { createCheckoutService } from '../../../lib/aimp/checkout/service.ts';
import type { CheckoutService, StoreDirectory } from '../../../lib/aimp/checkout/service.ts';
import { FIXTURE_WEBHOOK_SECRET } from '../../../lib/aimp/checkout/signature.ts';
import { createFilesService } from '../../../lib/aimp/files/service.ts';
import type { FilesService } from '../../../lib/aimp/files/service.ts';
import { createMemoryFileStorage } from '../../../lib/aimp/files/storage.ts';
import type { StoredFile } from '../../../lib/aimp/files/types.ts';
import { grantTokenSigner } from '../../../lib/aimp/fulfilment/link.ts';
import { createFulfilmentService } from '../../../lib/aimp/fulfilment/service.ts';
import type { FulfilmentService } from '../../../lib/aimp/fulfilment/service.ts';
import { createMemoryFulfilmentStore } from '../../../lib/aimp/fulfilment/store.ts';
import type { FulfilmentStore } from '../../../lib/aimp/fulfilment/types.ts';
import { createMemoryOrderStore, createOrderBook, orderItemId } from '../../../lib/aimp/orders/index.ts';
import type { OrderStore } from '../../../lib/aimp/orders/index.ts';
import type { ProductService } from '../../../lib/aimp/products/service.ts';
import type { ProductStore } from '../../../lib/aimp/products/types.ts';
import { createProviderRegistry } from '../../../lib/aimp/providers/index.ts';
import type { EmailAdapter } from '../../../lib/aimp/providers/types.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../../../lib/aimp/sellers/index.ts';
import type { SellerAccountStore } from '../../../lib/aimp/sellers/index.ts';

export const SAMPLE_SELLER_PREFIX = 'acct_sample_demo_';
export const SAMPLE_BUYER_DOMAIN = 'example.test';
export const MAX_SAMPLE_ORDERS = 2;
export const DOWNLOAD_PATH = '/api/aimp/fulfilment/download';
export const SAMPLE_STORE_PREFIX = 'sample-';

/** The parts of the /start runtime the sample orders read. `JourneyRuntime` satisfies this. */
export interface SampleSource {
  catalogue: Pick<CatalogueService, 'listApprovedForBusiness' | 'getCheckoutPrice'>;
  products: Pick<ProductService, 'getBuyerFile'>;
  slugs: Map<string, string>;
}

export interface StartOrders {
  workspaceId: string;
  actorId: string;
  orders: OrderStore;
  files: FilesService;
  productStore: Pick<ProductStore, 'getVersion' | 'listVersions'>;
  sellers: SellerAccountStore;
  checkout: CheckoutService;
  fulfilment: FulfilmentService;
  /** The store behind `fulfilment`, so the Home and overview pages can read the same delivery records the Orders page shows. */
  fulfilmentStore: FulfilmentStore;
  /** Fixture email: messages go to an in-memory outbox, never to a real address. */
  email: EmailAdapter;
  now: () => Date;
  /** Store address -> business (what the checkout service resolves a store address with). */
  stores: Map<string, { workspaceId: string; businessId: string }>;
  /** Sample order ids per business, so a second call does not add more. */
  sampled: Map<string, string[]>;
  inflight: Map<string, Promise<SampleResult>>;
  registry: ReturnType<typeof createProviderRegistry>;
  /**
   * Creation intents (AMP-162), NOT the flag: keys from `testIntentKey` that the sample and test-purchase paths add just before they
   * start checkout. The order store reads them once, when it creates the order, and writes `test: true` ON THE ORDER RECORD. The flag
   * itself lives on the order (survives a restart of whatever holds the intents, and works for a database store); nothing reads this set later.
   */
  testIntents: Set<string>;
}

/** Key of a creation intent: the same (workspace, listing, retry key) the order store dedupes on, so it can only mark that one order. */
export const testIntentKey = (workspaceId: string, listingId: string, idempotencyKey: string): string => `${workspaceId}\u0000${listingId}\u0000${idempotencyKey}`;

export interface StartOrdersOptions {
  workspaceId: string;
  actorId: string;
  /** The store the product service runs on: the files service reads the approved version from it. */
  productStore: Pick<ProductStore, 'getVersion' | 'listVersions'>;
  catalogue: Pick<CatalogueService, 'getApprovedListing' | 'getCheckoutPrice'>;
  now?: () => Date;
  /** The ONE seller account store of the runtime (so Payments and Orders read the same accounts). A private one is made when absent. */
  sellers?: SellerAccountStore;
}

/** Builds the order store, checkout and fulfilment services. Fixture payments and email regardless of the real environment. */
export function createStartOrders(opts: StartOrdersOptions): StartOrders {
  const now = opts.now ?? (() => new Date());
  // An EMPTY env gives the fixture adapters (the same as every fixture world); real keys in process.env are never read here.
  const registry = createProviderRegistry({ env: {} });
  const email = registry.email.adapter;
  if (!email) throw new Error('The fixture email adapter is off.');
  const testIntents = new Set<string>();
  // Only the two server paths below (sample orders, test purchase) add an intent; every other order is created with test: false.
  // An intent is single-use: reading it removes it (and the two paths below also delete it in a finally).
  const orders = createMemoryOrderStore({ testOnCreate: (n) => testIntents.delete(testIntentKey(n.workspaceId, n.listingId, n.idempotencyKey)) });
  const sellers = opts.sellers ?? createInMemorySellerStore();
  const stores = new Map<string, { workspaceId: string; businessId: string }>();
  const directory: StoreDirectory = { resolve: async (slug) => stores.get(slug) ?? null };
  // A fresh random secret per server process: download links from this demo only work in this process.
  const filesSecret = randomBytes(32).toString('hex');
  const files = createFilesService({
    storage: createMemoryFileStorage(), products: opts.productStore, orders: createOrderBook(orders, [opts.workspaceId]), secret: filesSecret, now,
  });
  const checkout = createCheckoutService({
    stores: directory, catalogue: opts.catalogue, sellers, orders, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    payments: () => ({ status: registry.payments.status, adapter: registry.payments.adapter }),
    returnUrls: () => ({ successUrl: '/app', cancelUrl: '/app' }),
  });
  const fulfilmentStore = createMemoryFulfilmentStore();
  const fulfilment = createFulfilmentService({
    orders, files, stores: directory, store: fulfilmentStore, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    email: () => email,
    downloadUrl: ({ token }) => `${DOWNLOAD_PATH}/${token}`,
    grantToken: grantTokenSigner(filesSecret),
    storeName: (slug) => (stores.has(slug) ? 'Sample store (demo)' : null),
  });
  fulfilment.attachToCheckout(checkout);
  return {
    workspaceId: opts.workspaceId, actorId: opts.actorId, orders, files, productStore: opts.productStore, sellers, checkout, fulfilment, fulfilmentStore, email, now, stores,
    sampled: new Map(), inflight: new Map(), registry, testIntents,
  };
}

export type SampleResult =
  | { ok: true; orderIds: string[]; created: number }
  | { ok: false; message: string };

const BUSINESS_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLUG = /^[A-Za-z0-9._:-]{1,120}$/;

/**
 * Creates up to MAX_SAMPLE_ORDERS labelled sample orders for one /start business through the REAL checkout and paid-event path.
 * Needs an approved listing for the business (otherwise answers `ok: false`, nothing is created). Safe to call again: a business
 * that already has its sample orders gets the same ids back. Never throws.
 */
export async function createSampleOrders(so: StartOrders, src: SampleSource, businessId: string, count = MAX_SAMPLE_ORDERS): Promise<SampleResult> {
  if (typeof businessId !== 'string' || !BUSINESS_ID.test(businessId)) return { ok: false, message: 'Unknown business.' };
  const running = so.inflight.get(businessId);
  if (running) return running;
  const want = Math.min(MAX_SAMPLE_ORDERS, Math.max(1, Math.trunc(Number(count)) || 1));
  const work = run(so, src, businessId, want)
    .catch((): SampleResult => ({ ok: false, message: 'The sample orders could not be created.' }))
    .finally(() => { so.inflight.delete(businessId); });
  so.inflight.set(businessId, work);
  return work;
}

async function run(so: StartOrders, src: SampleSource, businessId: string, want: number): Promise<SampleResult> {
  const have = so.sampled.get(businessId) ?? [];
  if (have.length >= want) return { ok: true, orderIds: have, created: 0 };

  const prep = await prepareBusiness(so, src, businessId);
  if (!prep.ok) return prep;
  const { listing, slug } = prep;
  const adapter = so.registry.payments.adapter;
  if (!adapter) return { ok: false, message: 'The fixture payments adapter is off.' };
  const ids = [...have];
  for (let n = have.length + 1; n <= want; n++) {
    const key = `sample-${businessId}-${n}`;
    const intent = testIntentKey(so.workspaceId, listing.listingId, key);
    so.testIntents.add(intent);
    let started;
    try {
      started = await so.checkout.startCheckout({ storeSlug: slug, listingId: listing.listingId, buyerEmail: `sample-buyer-${n}@${SAMPLE_BUYER_DOMAIN}`, idempotencyKey: key });
    } finally { so.testIntents.delete(intent); }
    if (!started.ok) return { ok: false, message: started.message };
    const event = await paySessionWithFixture(adapter, started.sessionId, FIXTURE_WEBHOOK_SECRET, so.now());
    const paid =await so.checkout.handlePaymentEvent(event);
    if (paid.outcome !== 'paid' && paid.outcome !== 'already_paid' && paid.outcome !== 'duplicate_event') return { ok: false, message: `The sample payment was not accepted (${paid.outcome}).` };
    ids.push(started.orderId);
    so.sampled.set(businessId, ids);
  }
  return { ok: true, orderIds: ids, created: ids.length - have.length };
}

type Prepared = { ok: true; listing: { listingId: string }; slug: string; title: string; priceMinor: number; fileName: string } | { ok: false; message: string };

/** Everything a purchase of this business's approved listing needs: the approved master stored, the fixture seller registered, the store address known. */
async function prepareBusiness(so: StartOrders, src: SampleSource, businessId: string): Promise<Prepared> {
  const ctx = { workspaceId: so.workspaceId, businessId, actorUserId: so.actorId, idempotencyKey: `sample:${businessId}` };
  const listing = (await src.catalogue.listApprovedForBusiness(ctx, businessId))[0];
  if (!listing) return { ok: false, message: 'This business has no approved listing yet, so there is nothing to sample-buy.' };
  const price = await src.catalogue.getCheckoutPrice(ctx, listing.listingId);

  // The buyer file must be deliverable: store the approved master for the version the listing is pinned to (what the owner approved).
  const versions = await so.productStore.listVersions(so.workspaceId, price.productId);
  const version = versions.find((v) => v.version === price.productVersion && v.status === 'approved');
  if (!version) return { ok: false, message: 'The product version for this listing is not approved, so nothing can be delivered.' };
  const file = await src.products.getBuyerFile({ workspaceId: so.workspaceId, actorId: so.actorId }, price.productId);
  const master: StoredFile = { fileName: file.fileName, contentType: file.contentType, bytes: file.bytes };
  await so.files.storeMaster({ workspaceId: so.workspaceId, businessId, actorId: so.actorId }, version.id, master);

  // The sample seller: a FIXTURE account, labelled by its id, that makes the real gate say "ready" for this one business.
  if (!so.sellers.get(so.workspaceId, businessId)) {
    const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
    if (!ready) return { ok: false, message: 'The sample seller fixture is missing.' };
    const id = `${SAMPLE_SELLER_PREFIX}${businessId}`;
    so.sellers.register({ workspaceId: so.workspaceId, businessId, stripeAccountId: id, snapshot: { ...ready, id }, lastEventCreated: 0 });
  }

  // The store address checkout resolves: the business's own site address when it has one, else a labelled sample address.
  const own = src.slugs.get(businessId);
  const slug = own && SLUG.test(own) && (!so.stores.has(own) || so.stores.get(own)?.businessId === businessId) ? own : `${SAMPLE_STORE_PREFIX}${businessId}`;
  so.stores.set(slug, { workspaceId: so.workspaceId, businessId });

  return { ok: true, listing, slug, title: price.title, priceMinor: price.priceMinor, fileName: file.fileName };
}

export interface TestPurchaseSummary {
  orderId: string;
  buyerEmail: string;
  productTitle: string;
  priceMinor: number;
  fileName: string;
  orderStatus: string;
  /** Signed download path from the delivery email, or null when none was found. */
  downloadPath: string | null;
  /** The signed token inside that path, for the download route that reads this same demo store. */
  downloadToken: string | null;
  /** Exactly what exists after the first payment. */
  deliveries: { grants: number; emails: number };
  /** What the same paid event does when the provider sends it again. */
  replay: { outcome: string; grants: number; emails: number; secondDelivery: boolean };
}
export type TestPurchaseResult = { ok: true; summary: TestPurchaseSummary } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The checkout retry key the test-purchase form uses for one business and one (trimmed, lower-case) email. Sample orders use other keys. */
export const testPurchaseKey = (businessId: string, email: string): string => `test-purchase:${businessId}:${createHash('sha256').update(email).digest('hex').slice(0, 24)}`;

/**
 * One test purchase of the business's approved listing through the REAL checkout, paid-event and fulfilment path with FIXTURE
 * payment and email (no Stripe, no mail leaves the server). Then the same signed paid event is sent again, the way a provider
 * retries, and the result reports whether a second delivery happened. Safe to call again with the same email: it returns the
 * same order. Never throws.
 */
export async function runTestPurchase(so: StartOrders, src: SampleSource, businessId: string, buyerEmail: unknown): Promise<TestPurchaseResult> {
  try {
    if (typeof businessId !== 'string' || !BUSINESS_ID.test(businessId)) return { ok: false, message: 'Unknown business.' };
    const email = typeof buyerEmail === 'string' ? buyerEmail.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 254) return { ok: false, message: 'Enter an email address like name@example.com. Nothing is sent to it in this test.' };
    const prep = await prepareBusiness(so, src, businessId);
    if (!prep.ok) return prep;
    const adapter = so.registry.payments.adapter;
    if (!adapter) return { ok: false, message: 'The fixture payments adapter is off.' };
    const intent = testIntentKey(so.workspaceId, prep.listing.listingId, testPurchaseKey(businessId, email));
    so.testIntents.add(intent);
    let started;
    try {
      started = await so.checkout.startCheckout({ storeSlug: prep.slug, listingId: prep.listing.listingId, buyerEmail: email, idempotencyKey: testPurchaseKey(businessId, email) });
    } finally { so.testIntents.delete(intent); }
    if (!started.ok) return { ok: false, message: started.message };
    const event = await paySessionWithFixture(adapter, started.sessionId, FIXTURE_WEBHOOK_SECRET, so.now());
    const first =await so.checkout.handlePaymentEvent(event);
    if (first.outcome !== 'paid' && first.outcome !== 'already_paid' && first.outcome !== 'duplicate_event') return { ok: false, message: `The test payment was not accepted (${first.outcome}).` };

    const ctx = { workspaceId: so.workspaceId, businessId, actorId: so.actorId };
    const count = async () => ({
      grants: (await so.files.listGrants(ctx, orderItemId(started.orderId))).length,
      emails: so.email.outbox().filter((m) => m.to === email && m.text.includes(DOWNLOAD_PATH)).length,
    });
    const before = await count();
    const again = await so.checkout.handlePaymentEvent(event);
    const after = await count();
    const order = await so.orders.get(so.workspaceId, started.orderId);
    const mail = [...so.email.outbox()].reverse().find((m) => m.to === email && m.text.includes(DOWNLOAD_PATH));
    const link = mail ? new RegExp(`${DOWNLOAD_PATH.replace(/\//g, '\\/')}\\/[A-Za-z0-9._~-]+`).exec(mail.text)?.[0] ?? null : null;
    return { ok: true, summary: {
      orderId: started.orderId, buyerEmail: email, productTitle: prep.title, priceMinor: prep.priceMinor, fileName: prep.fileName, orderStatus: order?.status ?? 'unknown',
      downloadPath: link, downloadToken: link ? link.slice(DOWNLOAD_PATH.length + 1) : null, deliveries: before,
      replay: { outcome: again.outcome, grants: after.grants, emails: after.emails, secondDelivery: after.grants > before.grants || after.emails > before.emails },
    } };
  } catch { return { ok: false, message: 'The test purchase could not be completed.' }; }
}
