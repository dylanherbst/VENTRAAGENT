// H19 / H20 Owner orders queue (screen 19) and order detail (screen 20): pure types. No I/O here.
// Built on the verified orders (AMP-041), fulfilment (AMP-042) and files (AMP-024/046) services. No new canonical state is invented:
// every state below is derived from OrderStatus and FulfilmentStatus (plus the money events fulfilment records).
import type { DeliveryErrorCode, FulfilmentService, MoneyEventKind } from '../fulfilment/index.ts';
import type { OrderStatus, OrderStore } from '../orders/index.ts';

/** Who is asking. Reads need the two tenant ids; actions also need an actor (it is written to the fulfilment audit log). */
export interface OwnerOrdersScope { workspaceId: string; businessId: string; actorId?: string }

export interface OwnerOrdersDeps {
  /** Only `get` is used: the order is checked against the scope's business before anything else is read or done. */
  orders: Pick<OrderStore, 'get'>;
  fulfilment: Pick<FulfilmentService, 'listStoreOrders' | 'listNeedsOwner' | 'getStoreOrder' | 'retryDelivery' | 'reissueAccess' | 'audit'>;
  now: () => Date;
}

/** Payment state is the order status as the orders service has it. */
export type PaymentState = OrderStatus;

/**
 *  not_started    no fulfilment record yet (unpaid, or paid and not picked up yet)
 *  in_progress    fulfilment `queued` or `delivering`
 *  delivered      fulfilment `delivered` (the email with the link was accepted by the provider)
 *  failed         fulfilment `failed` (last attempt failed, retry still possible)
 *  needs_review   fulfilment `needs_review` (attempts used up or cannot fix itself)
 *  revoking       the order is refunded but access is not yet recorded as withdrawn (fulfilment is not `revoked`, or a grant is still active):
 *                 "Refunded, access is still being removed". Needs attention.
 *  access_revoked fulfilment `revoked` (recorded only AFTER every grant was revoked), or refunded with no fulfilment record (so no grant
 *                 exists), and, in the detail, no grant active
 */
export const deliveryStates = ['not_started', 'in_progress', 'delivered', 'failed', 'needs_review', 'revoking', 'access_revoked'] as const;
export type DeliveryState = (typeof deliveryStates)[number];

export const orderFilters = ['all', 'needs_attention', 'delivered', 'refunded'] as const;
export type OrderFilter = (typeof orderFilters)[number];

export type AttentionCode =
  | 'dispute' | 'partial_refund' | 'refund_exception' | 'delivery_needs_review' | 'delivery_failed' | 'delivery_stuck' | 'access_revoking';

export interface Attention { code: AttentionCode; reason: string }

/** A dispute / partial refund / refund exception recorded for the order and still waiting for the owner. */
export type MoneyFlag = Exclude<MoneyEventKind, 'refund'> | null;

export interface OwnerOrderSummary {
  id: string;
  createdAt: string;
  paidAt: string | null;
  title: string;
  productVersion: number;
  /** Whole minor units (cents) and the currency, exactly as the order has them. */
  amountMinor: number;
  currency: string;
  /** `b***@example.test`: enough to recognise the buyer, not enough to contact them. */
  buyerMasked: string;
  paymentState: PaymentState;
  moneyFlag: MoneyFlag;
  deliveryState: DeliveryState;
  deliveredAt: string | null;
  attempts: number;
  /** Safe fixed error code from the last failed attempt, or null. */
  lastError: DeliveryErrorCode | null;
  needsAttention: boolean;
  /** Plain English. Null when `needsAttention` is false. */
  attention: Attention | null;
}

export interface OwnerOrderCounts { all: number; needs_attention: number; delivered: number; refunded: number }

export interface OwnerOrdersPage {
  workspaceId: string;
  businessId: string;
  filter: OrderFilter;
  /** Newest first (created time, then id). */
  orders: OwnerOrderSummary[];
  /** How many orders match the filter in total, before the page cut. */
  total: number;
  /** Counts for every filter of this business, for the filter tabs. */
  counts: OwnerOrderCounts;
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  generatedAt: string;
}

export interface OwnerOrdersFilter { filter?: OrderFilter; limit?: number; cursor?: string | null }

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** A paid order with no delivery email after this long needs a look (same value as the overview's "stuck delivery"). */
export const STUCK_DELIVERY_MS = 30 * 60_000;

export interface OwnerOrderLineItem {
  title: string;
  productId: string;
  productVersion: number;
  quantity: 1;
  amountMinor: number;
  currency: string;
}

export type GrantState = 'active' | 'expired' | 'used_up' | 'revoked';
/** A download grant, never with its token or link. */
export interface OwnerGrantView {
  id: string;
  state: GrantState;
  issuedAt: string;
  expiresAt: string;
  downloads: number;
  maxDownloads: number;
  revokedAt: string | null;
  replacesGrantId: string | null;
}
export interface OwnerAccessView {
  /** `none` before the first link was issued; otherwise `active` when at least one grant works, else `inactive`.
   *  `revoked` only when the order's access was withdrawn AND no grant is active; a refunded order with a live grant is `revoking`. */
  state: 'none' | 'active' | 'inactive' | 'revoking' | 'revoked';
  grants: OwnerGrantView[];
  activeCount: number;
  reissues: number;
}

export type TimelineKind =
  | 'order_created' | 'paid' | 'delivery_started' | 'delivery_email_sent' | 'delivery_failed' | 'delivery_needs_review'
  | 'link_reissued' | 'refunded' | 'access_revoked' | 'needs_owner' | 'retry_requested';
export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  label: string;
  /** `system` for automatic steps, otherwise the user id who acted. */
  actor: string;
}

export interface RefundStatusView {
  state: 'none' | 'refunded' | 'partial_refund' | 'dispute' | 'refund_exception';
  /** True when a person has to decide; nothing here is decided automatically. */
  needsOwner: boolean;
  events: { kind: MoneyEventKind; amountMinor: number | null; at: string; needsOwner: boolean }[];
  /** This build only shows the refund state. It issues no refunds. */
  note: string;
}

export interface ActionAllowance { allowed: boolean; /** Plain English; null only when allowed with nothing to add. */ reason: string | null }
export interface AllowedActions {
  resendDelivery: ActionAllowance;
  reissueAccess: ActionAllowance;
  /** Read-only view of the refund state. Always allowed to look; no refund can be issued here. */
  refundStatus: ActionAllowance;
}

export interface OwnerOrderDetail extends OwnerOrderSummary {
  workspaceId: string;
  businessId: string;
  lineItems: OwnerOrderLineItem[];
  delivery: { status: DeliveryState; attempts: number; maxAttempts: number | null; deliveredAt: string | null; lastError: DeliveryErrorCode | null; lastErrorText: string | null };
  access: OwnerAccessView;
  refund: RefundStatusView;
  timeline: TimelineEvent[];
  allowedActions: AllowedActions;
  generatedAt: string;
}

export type OwnerActionCode = 'invalid' | 'order_not_found' | 'not_allowed' | 'in_progress' | 'email_unavailable' | 'failed' | 'needs_review';
export type OwnerActionResult =
  | { ok: true; outcome: 'sent' | 'already_delivered' | 'duplicate'; message: string; revokedLinks: number }
  | { ok: false; code: OwnerActionCode; message: string };
