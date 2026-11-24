// Checkout service (AMP-041).
//  - Store, listing, product, price and seller are ALL resolved here, server-side. The input type has no price or seller field,
//    and any extra property a client sends is never read.
//  - Refused when the store is unknown, the listing is not an approved listing of THAT store's business, or the sellers gate
//    (payments provider on + seller `ready`) is closed.
//  - A `pending` order is written BEFORE the provider session is created; the buyer is only given the redirect URL afterwards.
//  - A retry with the same idempotency key returns the same order and session (no second order, no second session).
//  - Only `handlePaymentEvent` (verified signature + known pending session + matching amount) marks an order paid, once.
import { CatalogueError } from '../catalogue/types.ts';
import type { CatalogueService } from '../catalogue/service.ts';
import type { PaymentsAdapter, ProviderStatus } from '../providers/types.ts';
import { checkoutGate } from '../sellers/gate.ts';
import type { SellerAccountStore } from '../sellers/store.ts';
import type { Order, OrderPaidHook, OrderStore } from '../orders/types.ts';
import { verifySignature } from './signature.ts';

/** Resolves a public store address to its owner. Production: the published site_versions row; demo: a fixed table. */
export interface StoreDirectory { resolve(slug: string): Promise<{ workspaceId: string; businessId: string } | null> }

export interface CheckoutRequest {
  storeSlug: string;
  listingId: string;
  buyerEmail: string;
  /** Retry key from the buyer's browser. Reusing it returns the same order. */
  idempotencyKey: string;
}

export type CheckoutRefusal = 'invalid' | 'store_not_found' | 'listing_not_available' | 'provider_off' | 'seller_not_found' | 'seller_not_ready' | 'payments_unavailable' | 'session_failed';
export type CheckoutResult =
  | { ok: true; orderId: string; sessionId: string; checkoutUrl: string; amountMinor: number; currency: 'AUD'; replayed: boolean }
  | { ok: false; code: CheckoutRefusal; message: string };

export type PaymentEventOutcome =
  | 'paid' | 'duplicate_event' | 'already_paid' | 'not_pending' | 'amount_mismatch' | 'unknown_session' | 'bad_signature' | 'invalid' | 'unsupported_type';
export interface PaymentEventResult { outcome: PaymentEventOutcome; orderId?: string }

export interface CheckoutDeps {
  stores: StoreDirectory;
  catalogue: Pick<CatalogueService, 'getApprovedListing' | 'getCheckoutPrice'>;
  sellers: SellerAccountStore;
  /** The payments provider status, read at call time (it can change with flags). */
  payments: () => { status: Pick<ProviderStatus, 'status' | 'label'>; adapter: PaymentsAdapter | null };
  orders: OrderStore;
  /** Secret that webhook signatures are checked against. */
  webhookSecret: string;
  /** Where the buyer returns to. Built from this, never from client input. */
  returnUrls: (storeSlug: string) => { successUrl: string; cancelUrl: string };
  now?: () => Date;
  newId?: () => string;
}

export interface CheckoutService {
  startCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Verify the signature over the RAW body, then apply the event. Never throws. */
  handlePaymentEvent(input: { rawBody: string; signature: string | null }): Promise<PaymentEventResult>;
  /** Subscribe to the paid transition (AMP-042 delivery). Fires once per order, after it is stored as paid. */
  onOrderPaid(hook: OrderPaidHook): () => void;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const TEXT = /^[A-Za-z0-9._:-]{1,120}$/;
const REFUSAL_TEXT: Record<CheckoutRefusal, string> = {
  invalid: 'Check the store, product, email and try again.',
  store_not_found: 'That store was not found.',
  listing_not_available: 'This product is not for sale right now.',
  provider_off: 'Checkout is closed because payments are not switched on.',
  seller_not_found: 'Checkout is not open for this store yet.',
  seller_not_ready: 'Checkout is not open for this store yet.',
  payments_unavailable: 'Payments are not available right now.',
  session_failed: 'We could not start the payment. Nothing was charged. Please try again.',
};
const refuse = (code: CheckoutRefusal): CheckoutResult => ({ ok: false, code, message: REFUSAL_TEXT[code] });

export function createCheckoutService(deps: CheckoutDeps): CheckoutService {
  const hooks = new Set<OrderPaidHook>();
  const inflight = new Map<string, Promise<CheckoutResult>>();
  const nowDate = () => (deps.now ?? (() => new Date()))();
  let n = 0;
  const newId = deps.newId ?? (() => `ord_${globalThis.crypto.randomUUID()}_${++n}`);
  const ctxFor = (workspaceId: string, businessId: string) => ({ workspaceId, businessId, actorUserId: 'buyer-checkout', idempotencyKey: 'checkout' });

  async function startCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    // Read ONLY the four named fields; nothing else on the request is looked at.
    const r = (typeof req === 'object' && req !== null ? req : {}) as Partial<CheckoutRequest>;
    const { storeSlug, listingId, buyerEmail, idempotencyKey } = r;
    if (typeof storeSlug !== 'string' || !TEXT.test(storeSlug) || typeof listingId !== 'string' || !TEXT.test(listingId)
      || typeof buyerEmail !== 'string' || buyerEmail.length > 254 || !EMAIL.test(buyerEmail.trim())
      || typeof idempotencyKey !== 'string' || !TEXT.test(idempotencyKey)) return refuse('invalid');

    const store = await deps.stores.resolve(storeSlug);
    if (!store) return refuse('store_not_found');
    const ctx = ctxFor(store.workspaceId, store.businessId);

    // The listing must be an APPROVED listing of this store's own business, and its stored price must be readable.
    const listing = await deps.catalogue.getApprovedListing(ctx, listingId);
    if (!listing || listing.workspaceId !== store.workspaceId || listing.businessId !== store.businessId) return refuse('listing_not_available');
    let price;
    try { price = await deps.catalogue.getCheckoutPrice(ctx, listingId); } catch (e) {
      if (e instanceof CatalogueError) return refuse('listing_not_available');
      throw e;
    }
    if (!Number.isInteger(price.priceMinor) || price.priceMinor <= 0) return refuse('listing_not_available');

    const pay = deps.payments();
    const gate = checkoutGate({ workspaceId: store.workspaceId, businessId: store.businessId, accounts: deps.sellers, payments: pay.status });
    if (!gate.enabled) return refuse(gate.code === 'ok' ? 'payments_unavailable' : gate.code);
    const seller = deps.sellers.get(store.workspaceId, store.businessId);
    if (!pay.adapter || !seller) return refuse('payments_unavailable');

    const email = buyerEmail.trim();
    const { order, created } = await deps.orders.createPending({
      id: newId(), workspaceId: store.workspaceId, businessId: store.businessId, storeSlug, listingId: price.listingId,
      listingVersion: price.listingVersion, productId: price.productId, productVersion: price.productVersion, title: price.title,
      amountMinor: price.priceMinor, currency: price.currency, sellerAccountId: seller.stripeAccountId, buyerEmail: email,
      idempotencyKey, createdAt: nowDate().toISOString(),
    });
    // A retry of an order that already has its session returns it unchanged.
    if (!created && order.checkoutSessionId && order.checkoutUrl) {
      return { ok: true, orderId: order.id, sessionId: order.checkoutSessionId, checkoutUrl: order.checkoutUrl, amountMinor: order.amountMinor, currency: order.currency, replayed: true };
    }
    if (order.status !== 'pending') return refuse('session_failed');
    // One session creation per order at a time: a concurrent retry waits for the first call instead of making a second session.
    // (No await between this check and the set below, so only one caller becomes the creator.)
    const running = inflight.get(order.id);
    if (running) { const r = await running; return r.ok ? { ...r, replayed: true } : r; }
    const adapter = pay.adapter;
    const work = (async (): Promise<CheckoutResult> => {
      try {
        const urls = deps.returnUrls(storeSlug);
        const session = await adapter.createCheckoutSession({
          amountCents: order.amountMinor, currency: order.currency, productName: order.title, successUrl: urls.successUrl, cancelUrl: urls.cancelUrl,
        });
        const saved = await deps.orders.attachSession(order.id, { id: session.id, url: session.url });
        return { ok: true, orderId: saved.id, sessionId: session.id, checkoutUrl: session.url, amountMinor: saved.amountMinor, currency: saved.currency, replayed: !created };
      } catch {
        await deps.orders.markFailed(order.id, 'session_failed');
        return refuse('session_failed');
      }
    })();
    inflight.set(order.id, work);
    try { return await work; } finally { inflight.delete(order.id); }
  }

  async function handlePaymentEvent(input: { rawBody: string; signature: string | null }): Promise<PaymentEventResult> {
    try {
      const ok = verifySignature({ secret: deps.webhookSecret, rawBody: input.rawBody, header: input.signature, nowSeconds: Math.floor(nowDate().getTime() / 1000) });
      if (!ok) return { outcome: 'bad_signature' };
      let ev: unknown;
      try { ev = JSON.parse(input.rawBody); } catch { return { outcome: 'invalid' }; }
      const e = ev as { id?: unknown; type?: unknown; data?: { object?: { id?: unknown; amount_total?: unknown; currency?: unknown; payment_status?: unknown } } };
      if (typeof e?.type !== 'string') return { outcome: 'invalid' };
      if (e.type !== 'checkout.session.completed') return { outcome: 'unsupported_type' };
      const o = e.data?.object;
      if (typeof e.id !== 'string' || !e.id || !o || typeof o.id !== 'string' || !o.id || !Number.isInteger(o.amount_total) || typeof o.currency !== 'string') return { outcome: 'invalid' };
      // A completed session that is not actually paid never marks an order paid.
      if (o.payment_status !== 'paid') return { outcome: 'invalid' };
      const r = await deps.orders.applyPaid({ eventId: e.id, sessionId: o.id, amountMinor: o.amount_total as number, currency: o.currency, at: nowDate().toISOString() });
      if (r.outcome === 'unknown_session') return { outcome: 'unknown_session' };
      if (r.outcome === 'paid') await fire(r.order);
      return { outcome: r.outcome, orderId: r.order.id };
    } catch {
      return { outcome: 'invalid' };
    }
  }

  async function fire(order: Order): Promise<void> {
    // A failing subscriber must not undo or block the paid transition; delivery retries on its own.
    for (const h of [...hooks]) { try { await h(order); } catch { /* subscriber failure is its own concern */ } }
  }

  return {
    startCheckout,
    handlePaymentEvent,
    onOrderPaid(hook) { hooks.add(hook); return () => { hooks.delete(hook); }; },
  };
}
