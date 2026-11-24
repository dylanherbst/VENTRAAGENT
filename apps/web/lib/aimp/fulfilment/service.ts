// Fulfilment service (AMP-042): "a verified payment triggers one delivery".
//  - `fulfilPaidOrder` is the ONLY way a fulfilment and an entitlement come to exist. It re-reads the order from the order store
//    and refuses unless that order is `paid` by a recorded provider event. Nothing is taken from the caller but two ids.
//  - One fulfilment + one entitlement per order (store-level uniqueness on the order id). A replayed, duplicated or concurrent
//    paid event finds the existing record; only the caller that wins the delivery lease sends anything.
//  - Delivery = issue a purchase-bound grant in the files service, then one email through the provider adapter with an
//    idempotency key. The email carries the signed link, never a storage path. Tokens are never stored or logged here.
//  - A retry or a lease takeover REUSES the order's working grant: same grant, same link, same email key. So an email the
//    provider already accepted (a timeout after the send, a worker that died before recording it) is not sent a second time.
//    Only when that grant is revoked, expired or used up is a new one issued, and that new link is a new email.
//  - A failed attempt leaves the fulfilment `failed` and retryable. Attempts are capped (default 5) and each one is recorded;
//    after the cap, or on a failure that cannot fix itself, the fulfilment is parked as `needs_review` for the owner.
//  - Support reissue, refunds and disputes are tenant-checked, idempotent and written to the audit log with actor and reason.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifySignature } from '../checkout/signature.ts';
import type { CheckoutService, StoreDirectory } from '../checkout/service.ts';
import { FilesError } from '../files/types.ts';
import type { FilesService } from '../files/service.ts';
import type { Grant } from '../files/types.ts';
import { isDeliverable, orderItemId } from '../orders/book.ts';
import type { Order, OrderStore } from '../orders/types.ts';
import type { EmailAdapter } from '../providers/types.ts';
import { composeDeliveryEmail, oneLine } from './email.ts';
import type { GrantTokenSigner } from './link.ts';
import { createMemoryFulfilmentStore } from './store.ts';
import type {
  AttemptTrigger, BuyerOrderView, DeliveryErrorCode, Entitlement, Fulfilment, FulfilmentAuditEntry, FulfilmentAuditEvent, FulfilmentStore,
  FulfilResult, MoneyEvent, MoneyEventKind, OrderHistoryRow, RefundResult, ReissueRefusal, ReissueResult, StoreScope,
} from './types.ts';

export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;
export const MAX_REASON_CHARS = 300;
/** A repeat of the same reissue request (same person, same reason) inside this window is a double submit, not a new request. */
export const DEFAULT_REISSUE_DEDUPE_MS = 120_000;
export const MAX_REQUEST_KEY_CHARS = 80;

export interface FulfilmentDeps {
  orders: OrderStore;
  files: Pick<FilesService, 'issueGrant' | 'reissueGrant' | 'listGrants' | 'revokeGrant'>;
  /** The email provider adapter, read at call time (null when the provider is off or disconnected). */
  email: () => EmailAdapter | null;
  /** Resolves a public store address to its owner (buyer order lookup). */
  stores: StoreDirectory;
  /** Secret that refund / dispute event signatures are checked against. */
  webhookSecret: string;
  /** Builds the buyer's download URL around a grant token. Built server-side, never from client input. */
  downloadUrl: (input: { storeSlug: string; token: string }) => string;
  /**
   * The token of an existing grant (see link.ts `grantTokenSigner`). Required: without it a retry could not re-send the same
   * link and would have to mint a new one, which is what let one delivery send two emails.
   */
  grantToken: GrantTokenSigner;
  /** Window in which a repeated reissue request without its own key counts as a double submit. */
  reissueDedupeMs?: number;
  /** Shop name for the email. Falls back to the store address. */
  storeName?: (storeSlug: string) => string | null;
  store?: FulfilmentStore;
  /** Delivery attempts per fulfilment, 1 to 5. */
  maxAttempts?: number;
  /** How long one delivery attempt may hold the lease before another caller may take over. */
  leaseMs?: number;
  now?: () => Date;
  newId?: () => string;
}

export interface OrderRef { workspaceId: string; orderId: string }

export interface StoreOrderDetail {
  row: OrderHistoryRow;
  fulfilment: Fulfilment | null;
  entitlement: Entitlement | null;
  grants: Grant[];
  moneyEvents: MoneyEvent[];
}

export interface FulfilmentService {
  /** Create the fulfilment + entitlement for a verified paid order (if missing) and try to deliver. Safe to call any number of times. */
  fulfilPaidOrder(ref: OrderRef, opts?: { trigger?: AttemptTrigger }): Promise<FulfilResult>;
  /** Create the records only (first step of the durable job). Same refusal rules as fulfilPaidOrder. */
  recordPaidOrder(ref: OrderRef): Promise<FulfilResult>;
  /** Subscribe to the checkout service's paid hook. Returns the unsubscribe function. */
  attachToCheckout(checkout: Pick<CheckoutService, 'onOrderPaid'>): () => void;
  /** Owner / support: try a failed delivery again. Bounded by maxAttempts. */
  retryDelivery(scope: StoreScope, orderId: string): Promise<FulfilResult>;
  /**
   * Support: revoke the old link and email a fresh one, for a paid order of this store only. Always a new email with a new link,
   * except when the SAME request arrives twice: same `requestKey`, or (without one) the same person and reason within the dedupe
   * window. The repeat sends nothing and answers `ok` with `duplicate: true`, or `in_progress` while the first is still sending.
   */
  reissueAccess(scope: StoreScope, input: { orderId: string; reason: string; requestKey?: string }): Promise<ReissueResult>;
  /** Verify the signature over the RAW body, then apply a refund or dispute event. Never throws. */
  handleRefundEvent(input: { rawBody: string; signature: string | null }): Promise<RefundResult>;
  listStoreOrders(scope: StoreScope): Promise<OrderHistoryRow[]>;
  getStoreOrder(scope: StoreScope, orderId: string): Promise<StoreOrderDetail | null>;
  /** Buyer view by order reference + the email the order was placed with. Null for any mismatch (no hint which part was wrong). */
  lookupBuyerOrder(input: { storeSlug: string; reference: string; email: string }): Promise<BuyerOrderView | null>;
  /** Refund exceptions and disputes waiting for the owner. Nothing here is decided automatically. */
  listNeedsOwner(scope: StoreScope): Promise<MoneyEvent[]>;
  audit(scope: StoreScope): Promise<FulfilmentAuditEntry[]>;
}

const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const sha = (s: string) => createHash('sha256').update(s).digest();
const sameEmail = (a: string, b: string): boolean => timingSafeEqual(sha(a.trim().toLowerCase()), sha(b.trim().toLowerCase()));

/** Failures that will not fix themselves on a retry: the owner has to look. */
const PERMANENT: ReadonlySet<DeliveryErrorCode> = new Set(['order_not_found', 'wrong_tenant', 'version_not_approved', 'file_missing', 'file_changed']);
const FILE_CODES: ReadonlySet<string> = new Set(['order_not_paid', 'order_not_found', 'wrong_tenant', 'version_not_approved', 'file_missing', 'file_changed']);

class DeliverError extends Error {
  readonly code: DeliveryErrorCode;
  constructor(code: DeliveryErrorCode) { super(code); this.code = code; }
}
const codeOf = (e: unknown): DeliveryErrorCode =>
  e instanceof DeliverError ? e.code : e instanceof FilesError && FILE_CODES.has(e.code) ? (e.code as DeliveryErrorCode) : 'unexpected';

const REISSUE_TEXT: Record<ReissueRefusal, string> = {
  invalid: 'Give the order reference and a short reason.',
  order_not_found: 'That order was not found in this store.',
  order_not_paid: 'That order is not paid, so there is nothing to send.',
  order_refunded: 'That order was refunded, so access cannot be reissued.',
  not_deliverable: 'The file for that order cannot be delivered right now. Check the product, then try again.',
  email_failed: 'The email could not be sent. Try again.',
  email_unavailable: 'Email is not switched on, so a new link cannot be sent. The old link was left as it was.',
  in_progress: 'That request is already being sent. Check the order in a moment.',
};

export function createFulfilmentService(deps: FulfilmentDeps): FulfilmentService {
  if (typeof deps.webhookSecret !== 'string' || !deps.webhookSecret) throw new Error('A webhook secret is required.');
  if (typeof deps.grantToken !== 'function') throw new Error('A grant token signer is required.');
  const reissueDedupeMs = Math.max(0, deps.reissueDedupeMs ?? DEFAULT_REISSUE_DEDUPE_MS);
  const store = deps.store ?? createMemoryFulfilmentStore();
  const maxAttempts = Math.min(5, Math.max(1, Math.trunc(deps.maxAttempts ?? DEFAULT_MAX_DELIVERY_ATTEMPTS)));
  const leaseMs = deps.leaseMs ?? 60_000;
  const nowDate = () => (deps.now ?? (() => new Date()))();
  const iso = () => nowDate().toISOString();
  const newId = deps.newId ?? (() => `ful_${randomUUID()}`);
  const nameOf = (slug: string) => deps.storeName?.(slug) ?? slug;

  const note = (event: FulfilmentAuditEvent, o: { workspaceId: string; businessId?: string | null; orderId?: string | null; fulfilmentId?: string | null; actor: string; reason?: string | null; note?: string | null }) =>
    store.appendAudit({ at: iso(), event, workspaceId: o.workspaceId, businessId: o.businessId ?? null, orderId: o.orderId ?? null, fulfilmentId: o.fulfilmentId ?? null, actor: o.actor, reason: o.reason ?? null, note: o.note ?? null });

  const validScope = (s: StoreScope): boolean => !!s && isId(s.workspaceId) && isId(s.businessId) && isId(s.actorId);
  const actorOf = (t: AttemptTrigger, actor?: string) => actor ?? (t === 'paid_event' ? 'system:payment-event' : t === 'job' ? 'system:job' : 'system:retry');

  /** The order, only if it is in this workspace AND verified paid. */
  async function paidOrder(ref: OrderRef): Promise<{ order: Order } | { refusal: FulfilResult }> {
    if (!ref || !isId(ref.workspaceId) || !isId(ref.orderId)) return { refusal: { outcome: 'invalid', fulfilment: null } };
    const order = await deps.orders.get(ref.workspaceId, ref.orderId);
    if (!order) return { refusal: { outcome: 'order_not_found', fulfilment: null } };
    const existing = await store.get(order.workspaceId, order.id);
    if (order.status === 'refunded' && existing) return { refusal: { outcome: 'revoked', fulfilment: existing } };
    // Paid means: status paid AND the id of the verified provider event that paid it is on the order.
    if (!isDeliverable(order) || !order.paidEventId) return { refusal: { outcome: 'order_not_paid', fulfilment: existing } };
    return { order };
  }

  async function ensure(order: Order, actor: string): Promise<Fulfilment> {
    const at = iso();
    const id = newId();
    const { fulfilment, created } = await store.createForOrder(
      {
        id, orderId: order.id, orderItemId: orderItemId(order.id), workspaceId: order.workspaceId, businessId: order.businessId, storeSlug: order.storeSlug,
        productId: order.productId, productVersion: order.productVersion, paidEventId: order.paidEventId as string, maxAttempts, createdAt: at,
      },
      {
        id: `ent_${id}`, fulfilmentId: id, orderId: order.id, orderItemId: orderItemId(order.id), workspaceId: order.workspaceId, businessId: order.businessId,
        storeSlug: order.storeSlug, productId: order.productId, productVersion: order.productVersion, buyerEmail: order.buyerEmail, createdAt: at,
      },
    );
    if (created) await note('fulfilment_created', { workspaceId: order.workspaceId, businessId: order.businessId, orderId: order.id, fulfilmentId: fulfilment.id, actor, note: `product ${order.productId} v${order.productVersion}` });
    return fulfilment;
  }

  const stateOf = (f: Fulfilment | null): FulfilResult => {
    if (!f) return { outcome: 'order_not_found', fulfilment: null };
    const outcome = f.status === 'delivered' ? 'already_delivered' : f.status === 'delivering' || f.status === 'queued' ? 'in_progress'
      : f.status === 'revoked' ? 'revoked' : f.status === 'needs_review' ? 'retries_exhausted' : 'failed';
    return { outcome, fulfilment: f, ...(f.delivery.lastError && outcome !== 'already_delivered' ? { error: f.delivery.lastError } : {}) };
  };

  /** Issue the first grant, or replace whatever exists, so an order line never has two working links. */
  async function freshGrant(order: Order, actor: string): Promise<{ grant: Grant; token: string; revoked: string[] }> {
    const ctx = { workspaceId: order.workspaceId, businessId: order.businessId, actorId: actor };
    const item = orderItemId(order.id);
    const existing = await deps.files.listGrants(ctx, item);
    const r = existing.length > 0 ? await deps.files.reissueGrant(ctx, item) : await deps.files.issueGrant(ctx, item);
    return { ...r, revoked: existing.filter((g) => g.revokedAt === null).map((g) => g.id) };
  }

  /**
   * The grant a delivery attempt sends. When the order line has exactly one working grant (not revoked, not expired, downloads
   * left) it is used again with its own token, so this attempt repeats the earlier attempt's email exactly. Otherwise a fresh
   * grant is issued, which also revokes anything left over.
   */
  async function deliveryGrant(order: Order, actor: string): Promise<{ grant: Grant; token: string }> {
    const active = (await deps.files.listGrants({ workspaceId: order.workspaceId, businessId: order.businessId, actorId: actor }, orderItemId(order.id))).filter((g) => g.revokedAt === null);
    const g = active.length === 1 ? active[0] : undefined;
    if (g && Date.parse(g.expiresAt) > nowDate().getTime() && g.downloads < g.maxDownloads) return { grant: g, token: deps.grantToken(g) };
    return freshGrant(order, actor);
  }

  async function send(order: Order, grant: Grant, token: string, key: string, reissue: boolean): Promise<string> {
    const adapter = deps.email();
    if (!adapter) throw new DeliverError('email_unavailable');
    const mail = composeDeliveryEmail({ order, storeName: nameOf(order.storeSlug), downloadUrl: deps.downloadUrl({ storeSlug: order.storeSlug, token }), grant, reissue });
    try {
      return (await adapter.send({ ...mail, idempotencyKey: key })).id;
    } catch {
      throw new DeliverError('email_failed'); // the provider's own message is not kept: it may hold addresses or keys
    }
  }

  async function attempt(order: Order, trigger: AttemptTrigger, actor: string): Promise<FulfilResult> {
    const ws = order.workspaceId;
    const startedAt = nowDate();
    const claimed = await store.claimAttempt(ws, order.id, { at: startedAt.toISOString(), leaseUntil: new Date(startedAt.getTime() + leaseMs).toISOString(), trigger });
    // Not claimable: already delivered, another caller is delivering, parked for review, or revoked. Nothing is sent.
    if (!claimed) return stateOf(await store.get(ws, order.id));
    const n = claimed.attempts;
    const base = { workspaceId: ws, businessId: order.businessId, orderId: order.id, fulfilmentId: claimed.id, actor };
    await note('delivery_started', { ...base, note: `attempt ${n} of ${claimed.maxAttempts}` });
    let grantId: string | null = null;
    try {
      // Re-read the order inside the attempt: a refund that landed since the paid event must win.
      const fresh = await deps.orders.get(ws, order.id);
      if (!fresh || !isDeliverable(fresh)) throw new DeliverError('order_not_paid');
      const { grant, token } = await deliveryGrant(fresh, actor);
      grantId = grant.id;
      await store.setGrant(ws, order.id, { id: grant.id, expiresAt: grant.expiresAt });
      // Keyed by fulfilment + grant, and the grant is stable across attempts (see deliveryGrant): a retry or a lease takeover
      // repeats the same key with the same link, so the provider sends it at most once. A new key only follows a new grant.
      const key = `aimp:fulfilment:${claimed.id}:delivery:${grant.id}`;
      const messageId = await send(fresh, grant, token, key, false);
      const done = await store.settleAttempt(ws, order.id, n, { ok: true, at: iso(), grantId: grant.id, emailMessageId: messageId, emailIdempotencyKey: key });
      if (!done) return stateOf(await store.get(ws, order.id)); // lease lost (e.g. refunded meanwhile): the stored state stands
      await note('delivered', { ...base, note: `attempt ${n}; grant ${grant.id}; email ${messageId}` });
      return { outcome: 'delivered', fulfilment: done };
    } catch (e) {
      const error = codeOf(e);
      const refunded = error === 'order_not_paid' && (await deps.orders.get(ws, order.id))?.status === 'refunded';
      const needsReview = PERMANENT.has(error) || (error === 'order_not_paid' && !refunded);
      const after = await store.settleAttempt(ws, order.id, n, { ok: false, at: iso(), error, grantId, needsReview, revoked: refunded });
      if (!after) return stateOf(await store.get(ws, order.id));
      if (after.status === 'needs_review') await note('delivery_needs_review', { ...base, reason: error, note: `attempt ${n} of ${after.maxAttempts}` });
      else await note('delivery_failed', { ...base, reason: error, note: `attempt ${n} of ${after.maxAttempts}` });
      return { outcome: after.status === 'needs_review' ? 'needs_review' : after.status === 'revoked' ? 'revoked' : 'failed', fulfilment: after, error };
    }
  }

  async function fulfil(ref: OrderRef, trigger: AttemptTrigger, actor?: string): Promise<FulfilResult> {
    const p = await paidOrder(ref);
    if ('refusal' in p) return p.refusal;
    const who = actorOf(trigger, actor);
    await ensure(p.order, who);
    return attempt(p.order, trigger, who);
  }

  /** The order, only when it belongs to the caller's workspace AND store. */
  async function scopedOrder(scope: StoreScope, orderId: unknown): Promise<Order | null> {
    if (!validScope(scope) || !isId(orderId)) return null;
    const o = await deps.orders.get(scope.workspaceId, orderId);
    return o && o.businessId === scope.businessId ? o : null;
  }

  async function revokeAccess(order: Order, at: string): Promise<{ grants: number; changed: boolean }> {
    const ctx = { workspaceId: order.workspaceId, businessId: order.businessId, actorId: 'system:refund-event' };
    let grants = 0;
    for (const g of await deps.files.listGrants(ctx, orderItemId(order.id))) {
      if (g.revokedAt !== null) continue;
      await deps.files.revokeGrant(ctx, g.id);
      grants += 1;
    }
    const r = await store.revoke(order.workspaceId, order.id, at);
    return { grants, changed: r?.changed ?? false };
  }

  async function handleRefund(input: { rawBody: string; signature: string | null }): Promise<RefundResult> {
    const ok = verifySignature({ secret: deps.webhookSecret, rawBody: input.rawBody, header: input.signature, nowSeconds: Math.floor(nowDate().getTime() / 1000) });
    if (!ok) return { outcome: 'bad_signature' };
    let ev: unknown;
    try { ev = JSON.parse(input.rawBody); } catch { return { outcome: 'invalid' }; }
    const e = ev as { id?: unknown; type?: unknown; account?: unknown; data?: { object?: { amount?: unknown; amount_refunded?: unknown; currency?: unknown; refunded?: unknown; metadata?: { aimp_order_id?: unknown; aimp_workspace_id?: unknown } } } };
    if (typeof e?.type !== 'string') return { outcome: 'invalid' };
    const isRefund = e.type === 'charge.refunded';
    const isDispute = e.type.startsWith('charge.dispute.');
    if (!isRefund && !isDispute) return { outcome: 'unsupported_type' };
    const o = e.data?.object;
    const meta = o?.metadata;
    if (!isId(e.id) || !o || !meta || !isId(meta.aimp_order_id) || !isId(meta.aimp_workspace_id) || e.type.length > 80) return { outcome: 'invalid' };
    if (isRefund && (!Number.isInteger(o.amount_refunded) || (o.amount_refunded as number) < 0 || typeof o.currency !== 'string')) return { outcome: 'invalid' };

    // Never create or guess an order from an event, and do not record the id of an event we cannot place.
    const order = await deps.orders.get(meta.aimp_workspace_id, meta.aimp_order_id);
    if (!order) return { outcome: 'unknown_order' };
    const sys = { workspaceId: order.workspaceId, businessId: order.businessId, orderId: order.id, actor: 'system:refund-event' };
    // The event must come from the seller account the order was sold through. Metadata alone could be set by another seller.
    if (e.account !== order.sellerAccountId) {
      await note('refund_event_ignored', { ...sys, reason: 'seller_mismatch', note: `event ${e.id}` });
      return { outcome: 'unknown_order' };
    }
    if (await store.hasMoneyEvent(e.id)) return { outcome: 'duplicate_event', orderId: order.id };

    const at = iso();
    const amount = isRefund ? (o.amount_refunded as number) : Number.isInteger(o.amount) ? (o.amount as number) : null;
    const record = (kind: MoneyEventKind, outcome: string, needsOwner: boolean, text: string | null) =>
      store.recordMoneyEvent({ eventId: e.id as string, type: e.type as string, kind, workspaceId: order.workspaceId, businessId: order.businessId, orderId: order.id, amountMinor: amount, needsOwner, outcome, note: text, at });
    const forOwner = async (kind: MoneyEventKind, reason: string, text: string): Promise<RefundResult> => {
      if (!(await record(kind, 'needs_owner', true, text))) return { outcome: 'duplicate_event', orderId: order.id };
      await note('needs_owner', { ...sys, reason, note: `event ${e.id}` });
      return { outcome: 'needs_owner', orderId: order.id };
    };

    // Disputes are never decided here: the owner is told, access is left as it is.
    if (isDispute) return forOwner('dispute', 'dispute', 'A dispute was opened or updated for this order. The owner must respond with the payment provider.');
    const full = o.refunded === true && amount === order.amountMinor && (o.currency as string).toUpperCase() === order.currency;
    if (!full) return forOwner('partial_refund', 'partial_refund', 'A partial or mismatched refund was reported. Access was not changed; the owner decides.');
    if (order.status !== 'paid' && order.status !== 'refunded') return forOwner('refund_exception', 'refund_of_unpaid_order', 'A refund was reported for an order that is not recorded as paid.');

    // Idempotent steps first, the event row last: a crash part-way is finished by the provider's retry of the same event.
    const marked = order.status === 'paid' ? await deps.orders.markRefunded(order.workspaceId, order.id) : null;
    const revoked = await revokeAccess(order, at);
    const already = order.status === 'refunded' || marked?.changed === false;
    if (!(await record('refund', already ? 'already_refunded' : 'refunded', false, null))) return { outcome: 'duplicate_event', orderId: order.id };
    if (!already) await note('order_refunded', { ...sys, reason: 'full_refund', note: `event ${e.id}` });
    if (revoked.grants > 0 || revoked.changed) await note('access_revoked', { ...sys, reason: 'order_refunded', note: `${revoked.grants} link(s) revoked` });
    return { outcome: already ? 'already_refunded' : 'refunded', orderId: order.id };
  }

  const toRow = (o: Order, f: Fulfilment | undefined, owner: boolean): OrderHistoryRow => ({
    orderId: o.id, createdAt: o.createdAt, paidAt: o.paidAt, title: o.title, amountMinor: o.amountMinor, currency: o.currency, buyerEmail: o.buyerEmail,
    orderStatus: o.status, productId: o.productId, productVersion: o.productVersion, fulfilmentStatus: f?.status ?? 'none', attempts: f?.attempts ?? 0,
    deliveredAt: f?.delivery.deliveredAt ?? null, lastError: f?.delivery.lastError ?? null, needsOwner: owner || f?.status === 'needs_review',
  });

  return {
    fulfilPaidOrder: (ref, opts) => fulfil(ref, opts?.trigger ?? 'paid_event'),

    async recordPaidOrder(ref) {
      const p = await paidOrder(ref);
      if ('refusal' in p) return p.refusal;
      const f = await ensure(p.order, 'system:job');
      return f.status === 'delivered' ? { outcome: 'already_delivered', fulfilment: f } : { outcome: 'in_progress', fulfilment: f };
    },

    attachToCheckout(checkout) {
      // The hook hands over an order snapshot; only its ids are used and the order is read again from the store.
      return checkout.onOrderPaid(async (o) => { await fulfil({ workspaceId: o.workspaceId, orderId: o.id }, 'paid_event'); });
    },

    async retryDelivery(scope, orderId) {
      const order = await scopedOrder(scope, orderId);
      if (!order) return { outcome: validScope(scope) && isId(orderId) ? 'order_not_found' : 'invalid', fulfilment: null };
      const base = { workspaceId: order.workspaceId, businessId: order.businessId, orderId: order.id, actor: scope.actorId };
      const before = await store.get(order.workspaceId, order.id);
      if (before?.status === 'needs_review') {
        await note('retry_refused', { ...base, fulfilmentId: before.id, reason: 'retries_exhausted', note: `${before.attempts} of ${before.maxAttempts} attempts used` });
        return stateOf(before);
      }
      await note('retry_requested', { ...base, fulfilmentId: before?.id ?? null });
      return fulfil({ workspaceId: order.workspaceId, orderId: order.id }, 'retry', scope.actorId);
    },

    async reissueAccess(scope, input) {
      const refuse = (code: ReissueRefusal): ReissueResult => ({ ok: false, code, message: REISSUE_TEXT[code] });
      const reason = typeof input?.reason === 'string' ? oneLine(input.reason, MAX_REASON_CHARS + 1) : '';
      if (!validScope(scope) || !isId(input?.orderId) || reason.length < 3 || reason.length > MAX_REASON_CHARS) return refuse('invalid');
      const supplied = input.requestKey;
      if (supplied !== undefined && (!isId(supplied) || supplied.length > MAX_REQUEST_KEY_CHARS)) return refuse('invalid');
      // The caller's own key when it sends one; otherwise "this person, this reason" (hashed: the reason text is not a key).
      const requestKey = supplied !== undefined ? `req:${supplied}` : `auto:${sha(`${scope.actorId}\n${reason}`).toString('hex').slice(0, 32)}`;
      const order = await scopedOrder(scope, input.orderId);
      const log = { workspaceId: scope.workspaceId, businessId: scope.businessId, orderId: input.orderId, actor: scope.actorId };
      const refused = async (code: ReissueRefusal, detail?: string) => { await note('reissue_refused', { ...log, reason: code, note: detail ?? null }); return refuse(code); };
      // Another store's or another workspace's order looks exactly like one that does not exist.
      if (!order) return refused('order_not_found');
      if (order.status === 'refunded') return refused('order_refunded');
      if (!isDeliverable(order) || !order.paidEventId) return refused('order_not_paid');
      const f = await ensure(order, scope.actorId);
      if (f.status === 'revoked') return refused('order_refunded');
      // Check email first: without it the old link is left working rather than revoked for nothing.
      if (!deps.email()) return refused('email_unavailable');
      // Double-submit guard, taken in one store step BEFORE anything is issued or sent: the same request twice sends once.
      const at = nowDate();
      const slot = await store.claimReissue(order.workspaceId, order.id, {
        key: requestKey, at: at.toISOString(), staleBefore: new Date(at.getTime() - reissueDedupeMs).toISOString(), sticky: supplied !== undefined,
      });
      if (!slot) return refused('order_refunded');
      if (!slot.claimed) {
        if (slot.grantId === null) return refused('in_progress');
        const current = await store.get(order.workspaceId, order.id);
        if (!current) return refused('order_not_found');
        await note('reissue_duplicate', { ...log, fulfilmentId: f.id, reason, note: `grant ${slot.grantId} was already sent for this request; nothing new was sent` });
        return { ok: true, fulfilment: current, grantId: slot.grantId, revokedGrantIds: [], duplicate: true };
      }
      const release = () => store.releaseReissue(order.workspaceId, order.id, requestKey);
      let made;
      try { made = await freshGrant(order, scope.actorId); } catch (e) { await release(); return refused('not_deliverable', codeOf(e)); }
      await store.setGrant(order.workspaceId, order.id, { id: made.grant.id, expiresAt: made.grant.expiresAt });
      const key = `aimp:fulfilment:${f.id}:reissue:${made.grant.id}`;
      let messageId: string;
      try { messageId = await send(order, made.grant, made.token, key, true); } catch (e) { await release(); return refused(codeOf(e) === 'email_unavailable' ? 'email_unavailable' : 'email_failed', `grant ${made.grant.id} issued but not emailed`); }
      const after = await store.recordReissue(order.workspaceId, order.id, { at: iso(), grantId: made.grant.id, emailMessageId: messageId, emailIdempotencyKey: key, requestKey });
      if (!after) return refused('order_refunded');
      await note('access_reissued', { ...log, fulfilmentId: f.id, reason, note: `grant ${made.grant.id}; ${made.revoked.length} earlier link(s) revoked; email ${messageId}` });
      return { ok: true, fulfilment: after, grantId: made.grant.id, revokedGrantIds: made.revoked };
    },

    async handleRefundEvent(input) {
      try { return await handleRefund(input); } catch { return { outcome: 'invalid' }; }
    },

    async listStoreOrders(scope) {
      if (!validScope(scope)) return [];
      const [orders, fulfilments, events] = await Promise.all([deps.orders.list(scope.workspaceId), store.list(scope.workspaceId), store.listMoneyEvents(scope.workspaceId)]);
      const byOrder = new Map(fulfilments.map((f) => [f.orderId, f]));
      const flagged = new Set(events.filter((e) => e.needsOwner).map((e) => e.orderId));
      return orders.filter((o) => o.businessId === scope.businessId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .map((o) => toRow(o, byOrder.get(o.id), flagged.has(o.id)));
    },

    async getStoreOrder(scope, orderId) {
      const order = await scopedOrder(scope, orderId);
      if (!order) return null;
      const [fulfilment, entitlement, events, grants] = await Promise.all([
        store.get(order.workspaceId, order.id), store.getEntitlement(order.workspaceId, order.id), store.listMoneyEvents(order.workspaceId),
        deps.files.listGrants({ workspaceId: order.workspaceId, businessId: order.businessId, actorId: scope.actorId }, orderItemId(order.id)),
      ]);
      const moneyEvents = events.filter((e) => e.orderId === order.id);
      return { row: toRow(order, fulfilment ?? undefined, moneyEvents.some((e) => e.needsOwner)), fulfilment, entitlement, grants, moneyEvents };
    },

    async lookupBuyerOrder(input) {
      const { storeSlug, reference, email } = (typeof input === 'object' && input !== null ? input : {}) as Partial<{ storeSlug: string; reference: string; email: string }>;
      if (!isId(storeSlug) || !isId(reference) || typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim())) return null;
      const owner = await deps.stores.resolve(storeSlug);
      if (!owner) return null;
      const o = await deps.orders.get(owner.workspaceId, reference);
      // Same answer for a wrong reference, a wrong email, or an order of a different store.
      if (!o || o.businessId !== owner.businessId || o.storeSlug !== storeSlug || !sameEmail(o.buyerEmail, email)) return null;
      const f = await store.get(o.workspaceId, o.id);
      const delivery: BuyerOrderView['delivery'] = o.status === 'refunded' || f?.status === 'revoked' ? 'access_withdrawn'
        : f?.status === 'delivered' ? 'sent' : o.status === 'paid' ? 'on_its_way' : 'not_sent';
      return { reference: o.id, title: o.title, amountMinor: o.amountMinor, currency: o.currency, placedAt: o.createdAt, orderStatus: o.status, delivery, deliveredAt: f?.delivery.deliveredAt ?? null, productVersion: o.productVersion };
    },

    async listNeedsOwner(scope) {
      if (!validScope(scope)) return [];
      return (await store.listMoneyEvents(scope.workspaceId)).filter((e) => e.businessId === scope.businessId && e.needsOwner);
    },

    async audit(scope) {
      if (!validScope(scope)) return [];
      return (await store.listAudit(scope.workspaceId)).filter((e) => e.businessId === scope.businessId);
    },
  };
}
