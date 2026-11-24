// Fixture wiring for fulfilment (AMP-042): TWO stores in two separate workspaces, both built from ONE shared blueprint, on the
// REAL product, catalogue, sellers, checkout, orders, files and fulfilment services with in-memory stores and fixture providers.
// Used by the tests (their own clock, empty env) and by /tools/aimp-fulfilment (kept on globalThis). Nothing here is live:
// there is no Stripe, storage or email connection, and the tools runtime is off in production unless AIMP_TOOLS_ENABLED=1.
import { blueprintRegistry } from '../blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../branding/service.ts';
import { createMemoryBrandStore } from '../branding/store.ts';
import { createCatalogueService } from '../catalogue/service.ts';
import type { CatalogueService } from '../catalogue/service.ts';
import { createMemoryCoverAssets } from '../catalogue/store.ts';
import type { CoverAsset } from '../catalogue/types.ts';
import { createCheckoutService } from '../checkout/service.ts';
import type { CheckoutService, StoreDirectory } from '../checkout/service.ts';
import { paySessionWithFixture } from '../checkout/fixture-events.ts';
import type { SignedEvent } from '../checkout/fixture-events.ts';
import { FIXTURE_WEBHOOK_SECRET } from '../checkout/signature.ts';
import { createPaymentWebhookHandler } from '../checkout/handlers.ts';
import { generateProductSpec } from '../factory/generate.ts';
import { toolsEnabled } from '../files/demo.ts';
import { createFilesService } from '../files/service.ts';
import type { FilesService } from '../files/service.ts';
import { createMemoryFileStorage } from '../files/storage.ts';
import type { FileStorage, StoredFile } from '../files/types.ts';
import { createMemoryOrderStore, createOrderBook } from '../orders/index.ts';
import type { OrderStore } from '../orders/index.ts';
import { createMemoryProductStore } from '../products/store.ts';
import { createProductService } from '../products/service.ts';
import type { ProductStore } from '../products/types.ts';
import { createProviderRegistry } from '../providers/index.ts';
import type { EmailAdapter, OutboxMessage } from '../providers/types.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore } from '../sellers/index.ts';
import { createRefundWebhookHandler } from './handlers.ts';
import { grantTokenSigner } from './link.ts';
import { signMoneyEvent } from './refund-events.ts';
import type { SignedMoneyEvent } from './refund-events.ts';
import { createFulfilmentService } from './service.ts';
import type { FulfilmentService } from './service.ts';
import { createMemoryFulfilmentStore } from './store.ts';
import type { FulfilmentStore, StoreScope } from './types.ts';

/** The one blueprint both stores are built from. */
export const SHARED_BLUEPRINT = 'printable-planner';
export const FIXTURE_FILES_SECRET = 'fixture-only-files-signing-secret-000000';
export const DOWNLOAD_PATH = '/api/aimp/fulfilment/download';

export interface WorldStore {
  key: 'a' | 'b';
  slug: string;
  name: string;
  workspaceId: string;
  businessId: string;
  sellerAccountId: string;
  niche: string;
  scope: StoreScope;
  listingId: string;
  productId: string;
  productVersion: number;
  /** The approved master, exactly as stored (to prove the right file is delivered). */
  master: StoredFile;
}

/** Fixture email with a switch: `failNext(n)` makes the next n sends throw, like a provider outage. */
export interface FlakyEmail extends EmailAdapter { failNext(n: number): void; pendingFailures(): number; attempts(): number }
export function createFlakyEmail(inner: EmailAdapter): FlakyEmail {
  let fail = 0;
  let calls = 0;
  return {
    async send(input) {
      calls += 1;
      if (fail > 0) { fail -= 1; throw new Error('Fixture email outage.'); }
      return inner.send(input);
    },
    outbox: () => inner.outbox(),
    failNext(n) { fail = Math.max(0, Math.trunc(n)); },
    pendingFailures: () => fail,
    attempts: () => calls,
  };
}

export interface FulfilmentWorld {
  stores: { a: WorldStore; b: WorldStore };
  directory: StoreDirectory;
  orders: OrderStore;
  products: ProductStore;
  storage: FileStorage;
  catalogue: CatalogueService;
  files: FilesService;
  checkout: CheckoutService;
  fulfilment: FulfilmentService;
  fulfilmentStore: FulfilmentStore;
  email: FlakyEmail;
  registry: ReturnType<typeof createProviderRegistry>;
  webhookSecret: string;
  now: () => Date;
  /** Start a checkout in a store and return the pending order. */
  startOrder(key: 'a' | 'b', opts?: { email?: string; idempotencyKey?: string }): Promise<{ orderId: string; sessionId: string }>;
  /** The fixture provider "takes the payment" and returns the signed event it would send (not yet delivered to us). */
  payEvent(sessionId: string): Promise<SignedEvent>;
  /** startOrder + payEvent + deliver the event through the checkout service. */
  buy(key: 'a' | 'b', opts?: { email?: string; idempotencyKey?: string }): Promise<{ orderId: string; sessionId: string; event: SignedEvent }>;
  /** The download token inside an outbox email, or null. */
  tokenIn(message: Pick<OutboxMessage, 'text'>): string | null;
}

export interface WorldOptions {
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  maxAttempts?: number;
  leaseMs?: number;
  /** Set false to build the world without subscribing fulfilment to the paid hook (the jobs-runner test drives delivery itself). */
  attach?: boolean;
  /** Wrap the email adapter lookup (e.g. to return null: provider off). */
  emailLookup?: (flaky: FlakyEmail) => EmailAdapter | null;
}

const STORE_SEEDS = [
  { key: 'a' as const, slug: 'slow-morning', name: 'Slow Morning Studio', workspaceId: 'ws-store-a', businessId: 'biz-store-a', sellerAccountId: 'acct_demo_ready_a', niche: 'Wedding planning', audience: 'Couples on a budget' },
  { key: 'b' as const, slug: 'iron-and-oak', name: 'Iron & Oak Training', workspaceId: 'ws-store-b', businessId: 'biz-store-b', sellerAccountId: 'acct_demo_ready_b', niche: 'Home strength training', audience: 'Busy parents training at home' },
];

export async function createFulfilmentWorld(opts: WorldOptions = {}): Promise<FulfilmentWorld> {
  const env = opts.env ?? {};
  const now = opts.now ?? (() => new Date());
  const registry = createProviderRegistry({ env });
  const blueprint = blueprintRegistry.find(SHARED_BLUEPRINT);
  if (!blueprint) throw new Error('The shared blueprint is missing.');
  const readySeller = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
  if (!readySeller) throw new Error('Seller fixtures are missing.');

  const products = createMemoryProductStore();
  const specFor = (niche: string, audience: string) => generateProductSpec({ blueprint, provider: registry.llm, inputs: { niche, audience, pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } });
  const productService = createProductService({ store: products, now, generateSpec: async () => { throw new Error('Regeneration is not part of this fixture.'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products: productService, brands, assets, now });
  const sellers = createInMemorySellerStore();
  const orders = createMemoryOrderStore();
  const storage = createMemoryFileStorage();
  const files = createFilesService({
    storage, products, secret: FIXTURE_FILES_SECRET, now,
    orders: createOrderBook(orders, STORE_SEEDS.map((s) => s.workspaceId)),
  });

  const built: WorldStore[] = [];
  for (const s of STORE_SEEDS) {
    const actor = `owner-${s.key}`;
    const pctx = { workspaceId: s.workspaceId, actorId: actor };
    const octx = { workspaceId: s.workspaceId, actorUserId: actor, idempotencyKey: 'seed' };
    const spec = await specFor(s.niche, s.audience);
    const { product, version } = await productService.createProduct(pctx, { businessId: s.businessId, spec });
    const approved = await productService.approve(pctx, version.id);
    const buyer = await productService.getBuyerFile(pctx, product.id);
    const master: StoredFile = { fileName: buyer.fileName, contentType: buyer.contentType, bytes: buyer.bytes };
    await files.storeMaster({ ...pctx, businessId: s.businessId }, approved.id, master);
    for (const role of ['cover', 'preview', 'master'] as const) {
      const a: CoverAsset = { id: `${product.id}-${role}`, workspaceId: s.workspaceId, businessId: s.businessId, productId: product.id, role };
      assets.add(a);
    }
    const brandDeps = { store: brands, now };
    const made = await createBrandDraft(brandDeps, { workspaceId: s.workspaceId }, s.businessId, { niche: s.niche, audience: s.audience, productTitle: spec.title, productType: 'printable planner', formats: ['PDF'] });
    if (!made.ok) throw new Error(made.errors.map((e) => e.message).join(' '));
    const ok = await approveBrand(brandDeps, { workspaceId: s.workspaceId }, s.businessId, actor);
    if (!ok.ok) throw new Error(ok.errors.map((e) => e.message).join(' '));
    const draft = await catalogue.createDraft(octx, { businessId: s.businessId, productId: product.id });
    await catalogue.approveListing(octx, draft.listingId);
    sellers.register({ workspaceId: s.workspaceId, businessId: s.businessId, stripeAccountId: s.sellerAccountId, snapshot: { ...readySeller, id: s.sellerAccountId }, lastEventCreated: 0 });
    built.push({
      key: s.key, slug: s.slug, name: s.name, workspaceId: s.workspaceId, businessId: s.businessId, sellerAccountId: s.sellerAccountId, niche: s.niche,
      scope: { workspaceId: s.workspaceId, businessId: s.businessId, actorId: actor }, listingId: draft.listingId, productId: product.id, productVersion: approved.version, master,
    });
  }
  const [a, b] = built as [WorldStore, WorldStore];
  const bySlug = new Map(built.map((s) => [s.slug, s]));
  const directory: StoreDirectory = { resolve: async (slug) => { const s = bySlug.get(slug); return s ? { workspaceId: s.workspaceId, businessId: s.businessId } : null; } };

  const checkout = createCheckoutService({
    stores: directory, catalogue, sellers, orders, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    payments: () => ({ status: registry.payments.status, adapter: registry.payments.adapter }),
    returnUrls: (slug) => ({ successUrl: `/tools/aimp-fulfilment?return=success&store=${encodeURIComponent(slug)}`, cancelUrl: `/tools/aimp-fulfilment?return=cancel&store=${encodeURIComponent(slug)}` }),
  });

  const baseEmail = registry.email.adapter;
  if (!baseEmail) throw new Error('The fixture email adapter is off.');
  const email = createFlakyEmail(baseEmail);
  const fulfilmentStore = createMemoryFulfilmentStore();
  const fulfilment = createFulfilmentService({
    orders, files, stores: directory, store: fulfilmentStore, webhookSecret: FIXTURE_WEBHOOK_SECRET, now,
    email: () => (opts.emailLookup ? opts.emailLookup(email) : email),
    downloadUrl: ({ token }) => `${DOWNLOAD_PATH}/${token}`,
    grantToken: grantTokenSigner(FIXTURE_FILES_SECRET),
    storeName: (slug) => bySlug.get(slug)?.name ?? null,
    maxAttempts: opts.maxAttempts, leaseMs: opts.leaseMs,
  });
  if (opts.attach !== false) fulfilment.attachToCheckout(checkout);

  const pick = (key: 'a' | 'b') => (key === 'a' ? a : b);
  let n = 0;
  const startOrder: FulfilmentWorld['startOrder'] = async (key, o = {}) => {
    const s = pick(key);
    const r = await checkout.startCheckout({ storeSlug: s.slug, listingId: s.listingId, buyerEmail: o.email ?? `buyer-${key}@example.test`, idempotencyKey: o.idempotencyKey ?? `world-${++n}` });
    if (!r.ok) throw new Error(`Checkout refused: ${r.code}`);
    return { orderId: r.orderId, sessionId: r.sessionId };
  };
  const payEvent: FulfilmentWorld['payEvent'] = async (sessionId) => {
    const adapter = registry.payments.adapter;
    if (!adapter) throw new Error('The fixture payments adapter is off.');
    return paySessionWithFixture(adapter, sessionId, FIXTURE_WEBHOOK_SECRET, now());
  };
  const esc = DOWNLOAD_PATH.replace(/[/]/g, '\\/');
  const tokenRe = new RegExp(`${esc}\\/([A-Za-z0-9._-]+)`);

  return {
    stores: { a, b }, directory, orders, products, storage, catalogue, files, checkout, fulfilment, fulfilmentStore, email, registry,
    webhookSecret: FIXTURE_WEBHOOK_SECRET, now, startOrder, payEvent,
    async buy(key, o) {
      const started = await startOrder(key, o);
      const event = await payEvent(started.sessionId);
      await checkout.handlePaymentEvent(event);
      return { ...started, event };
    },
    tokenIn: (m) => tokenRe.exec(m.text)?.[1] ?? null,
  };
}

// ---- /tools/aimp-fulfilment runtime (DEMO only) ----
export const MAX_DEMO_ORDERS = 40;
export interface FulfilmentDemo {
  world: FulfilmentWorld;
  lastPaidEvent: SignedEvent | null;
  lastRefundEvent: { rawBody: string; signature: string; eventId: string } | null;
  counter: number;
}
type G = typeof globalThis & { __aimpFulfilmentDemo?: Promise<FulfilmentDemo> };

/** Null in production unless AIMP_TOOLS_ENABLED=1: there is no live storage, email or payments wiring behind this yet. */
export function fulfilmentRuntime(env: Readonly<Record<string, string | undefined>> = process.env): Promise<FulfilmentDemo> | null {
  if (!toolsEnabled(env)) return null;
  const g = globalThis as G;
  const p = (g.__aimpFulfilmentDemo ??= createFulfilmentWorld({ env }).then((world) => ({ world, lastPaidEvent: null, lastRefundEvent: null, counter: 0 })));
  p.catch(() => { if (g.__aimpFulfilmentDemo === p) delete g.__aimpFulfilmentDemo; });
  return p;
}

// ---- The steps the test page walks. Plain functions (no redirects) so the same code is covered by a unit test. ----
const postPaid = async (d: FulfilmentDemo, ev: SignedEvent): Promise<string> => {
  const res = await createPaymentWebhookHandler(() => d.world.checkout)(new Request('http://localhost/api/aimp/webhooks/payments', { method: 'POST', body: ev.rawBody, headers: { 'stripe-signature': ev.signature } }));
  const j = (await res.json()) as { outcome?: string };
  return `Payment webhook answered ${res.status}${j.outcome ? ` (${j.outcome})` : ''}.`;
};
const postRefund = async (d: FulfilmentDemo, ev: SignedMoneyEvent): Promise<string> => {
  const res = await createRefundWebhookHandler(() => d.world.fulfilment)(new Request('http://localhost/api/aimp/fulfilment/webhooks/refunds', { method: 'POST', body: ev.rawBody, headers: { 'stripe-signature': ev.signature } }));
  const j = (await res.json()) as { outcome?: string };
  return `Refund webhook answered ${res.status}${j.outcome ? ` (${j.outcome})` : ''}.`;
};
const statusLine = async (d: FulfilmentDemo, key: 'a' | 'b', orderId: string): Promise<string> => {
  const f = await d.world.fulfilmentStore.get(d.world.stores[key].workspaceId, orderId);
  return f ? `Fulfilment is ${f.status} after ${f.attempts} attempt(s); ${d.world.email.outbox().length} email(s) in the outbox.` : 'No fulfilment exists for that order.';
};
export const isStoreKey = (v: unknown): v is 'a' | 'b' => v === 'a' || v === 'b';

/** Checkout + fixture payment + signed paid event through the real webhook handler. `failDelivery` simulates an email outage. */
export async function demoBuy(d: FulfilmentDemo, key: 'a' | 'b', opts: { failDelivery?: boolean } = {}): Promise<{ orderId: string; message: string }> {
  if ((await d.world.orders.list(d.world.stores[key].workspaceId)).length >= MAX_DEMO_ORDERS) throw new Error(`The demo is limited to ${MAX_DEMO_ORDERS} orders per store. Restart the server to reset it.`);
  if (opts.failDelivery) d.world.email.failNext(1);
  const started = await d.world.startOrder(key, { idempotencyKey: `page-${++d.counter}` });
  const ev = await d.world.payEvent(started.sessionId);
  d.lastPaidEvent = ev;
  const hook = await postPaid(d, ev);
  return { orderId: started.orderId, message: `${hook} ${await statusLine(d, key, started.orderId)}` };
}
export async function demoReplayPaid(d: FulfilmentDemo): Promise<string> {
  if (!d.lastPaidEvent) return 'No payment event to replay yet.';
  const before = d.world.email.outbox().length;
  const hook = await postPaid(d, d.lastPaidEvent);
  return `Replayed ${d.lastPaidEvent.eventId}. ${hook} Emails sent by the replay: ${d.world.email.outbox().length - before}.`;
}
export async function demoRetry(d: FulfilmentDemo, key: 'a' | 'b', orderId: string, opts: { failDelivery?: boolean } = {}): Promise<string> {
  if (opts.failDelivery) d.world.email.failNext(1);
  const r = await d.world.fulfilment.retryDelivery(d.world.stores[key].scope, orderId);
  return `Retry: ${r.outcome}${r.error ? ` (${r.error})` : ''}. ${r.fulfilment ? `Attempts used: ${r.fulfilment.attempts} of ${r.fulfilment.maxAttempts}.` : ''}`;
}
/** `as` is the store whose owner is asking; when it is not the order's store the reissue must be refused. */
export async function demoReissue(d: FulfilmentDemo, as: 'a' | 'b', orderId: string, reason: string): Promise<string> {
  const r = await d.world.fulfilment.reissueAccess(d.world.stores[as].scope, { orderId, reason });
  if (r.ok && r.duplicate) return 'That reissue was already sent a moment ago, so nothing new was emailed.';
  return r.ok ? `Reissued: a fresh link was emailed and ${r.revokedGrantIds.length} earlier link(s) stopped working.` : `Reissue refused (${r.code}): ${r.message}`;
}
export async function demoMoneyEvent(d: FulfilmentDemo, key: 'a' | 'b', orderId: string, kind: 'refund' | 'partial' | 'dispute'): Promise<string> {
  const order = await d.world.orders.get(d.world.stores[key].workspaceId, orderId);
  if (!order) return 'That order was not found.';
  const ev = signMoneyEvent(d.world.webhookSecret, {
    eventId: `evt_fixture_${kind}_${++d.counter}`, type: kind === 'dispute' ? 'charge.dispute.created' : 'charge.refunded', order,
    ...(kind === 'partial' ? { amountRefundedMinor: Math.max(1, Math.floor(order.amountMinor / 2)) } : {}),
  }, d.world.now());
  d.lastRefundEvent = ev;
  return `${await postRefund(d, ev)} ${await statusLine(d, key, orderId)}`;
}
export async function demoReplayRefund(d: FulfilmentDemo): Promise<string> {
  if (!d.lastRefundEvent) return 'No refund event to replay yet.';
  return `Replayed ${d.lastRefundEvent.eventId}. ${await postRefund(d, d.lastRefundEvent)}`;
}
