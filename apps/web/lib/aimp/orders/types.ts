// Order records (AMP-041). An order is written as `pending` BEFORE the buyer is sent to pay; only a verified provider event
// moves it to `paid`. Everything on it (store, product, price, seller) was resolved server-side; nothing came from the browser.
// Money is whole cents. `OrderStatus` is the same union the files service (AMP-024) reads, so AMP-042 delivery plugs straight in.
import type { OrderStatus } from '../files/types.ts';

export type { OrderStatus };

export interface Order {
  id: string;
  workspaceId: string;
  businessId: string;
  /** The store address the buyer came from (resolved to workspace + business server-side). */
  storeSlug: string;
  listingId: string;
  listingVersion: number;
  productId: string;
  /** The product version the listing was approved for; this is what the buyer is entitled to download. */
  productVersion: number;
  title: string;
  /** The stored approved catalogue price at the moment of checkout. Never client-supplied. */
  amountMinor: number;
  currency: 'AUD';
  /** The seller's connected account the sale belongs to (from the sellers module). */
  sellerAccountId: string;
  buyerEmail: string;
  status: OrderStatus;
  /** Caller-supplied retry key; same (workspace, listing, key) returns the same order. */
  idempotencyKey: string;
  checkoutSessionId: string | null;
  checkoutUrl: string | null;
  /** The provider event id that marked the order paid. Null until paid. */
  paidEventId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  /**
   * STORED TEST FLAG (AMP-162), written once when the order is created and never changed: true = made by a sample or test purchase
   * (no real payment), false = a real order. Absent (undefined) only on a record from a store that has no such field; readers must then
   * treat the order as UNKNOWN (see `storedTestFlag`), never as real and never as test by default.
   */
  test?: boolean;
}

/** The stored test flag as a strict answer: true / false when the store wrote one, null when the record has no (valid) flag. */
export const storedTestFlag = (o: Pick<Order, 'test'> | null | undefined): boolean | null => (typeof o?.test === 'boolean' ? o.test : null);

export type NewOrder = Omit<Order, 'status' | 'checkoutSessionId' | 'checkoutUrl' | 'paidEventId' | 'failureReason' | 'paidAt'>;

export interface PaidEventInput {
  /** Provider event id (evt_...). The first idempotency key. */
  eventId: string;
  /** Checkout session id (cs_...). The second idempotency key: one session can be paid once. */
  sessionId: string;
  amountMinor: number;
  currency: string;
  at: string;
}

export type PaidOutcome =
  | { outcome: 'paid'; order: Order }
  | { outcome: 'duplicate_event' | 'already_paid' | 'not_pending' | 'amount_mismatch'; order: Order }
  | { outcome: 'unknown_session' };

/** Storage seam: this memory store now, an `orders` table later. Each method is atomic. */
export interface OrderStore {
  readonly kind: 'memory' | 'database';
  /** Insert a pending order, or return the existing one for the same (workspace, listing, idempotency key). */
  createPending(order: NewOrder): Promise<{ order: Order; created: boolean }>;
  attachSession(orderId: string, session: { id: string; url: string }): Promise<Order>;
  markFailed(orderId: string, reason: string): Promise<Order>;
  /** Workspace-scoped read; another workspace's order looks like one that does not exist. */
  get(workspaceId: string, orderId: string): Promise<Order | null>;
  list(workspaceId: string): Promise<Order[]>;
  /**
   * Webhook path only. One atomic step: the paid transition happens at most once per order, and each event id is applied once.
   * Mirrors `update orders set status='paid' ... where checkout_session_id=$1 and status='pending'` plus a unique index on event id.
   */
  applyPaid(input: PaidEventInput): Promise<PaidOutcome>;
  /**
   * AMP-042 refund path only (called after a verified refund event). One atomic step: paid -> refunded, at most once.
   * Null when the order is not in this workspace; `changed: false` when it was not paid (nothing is altered).
   */
  markRefunded(workspaceId: string, orderId: string): Promise<{ order: Order; changed: boolean } | null>;
}

/** Called exactly once per order, right after the pending -> paid transition. AMP-042 (delivery) subscribes here. */
export type OrderPaidHook = (order: Order) => void | Promise<void>;
