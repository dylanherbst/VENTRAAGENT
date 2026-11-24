// Fulfilment and delivery (AMP-042): one verified paid order -> one fulfilment + one entitlement -> one delivery email.
// Pure types plus the storage seam. The memory store sits beside this file; the tables in
// docs/aimp/proposed/aimp_fulfilment.sql plug into the same interface later.
import type { OrderStatus } from '../orders/types.ts';

/**
 *  queued        record written, no delivery attempt yet
 *  delivering    an attempt holds the lease (a crashed attempt is reclaimed when the lease runs out)
 *  delivered     the buyer email with the download link was accepted by the email provider
 *  failed        the last attempt failed; it may be retried (attempts < maxAttempts)
 *  needs_review  retries are used up, or the failure cannot fix itself (file missing, version not approved): the owner must act
 *  revoked       the order was refunded; download access is withdrawn
 */
export const fulfilmentStatuses = ['queued', 'delivering', 'delivered', 'failed', 'needs_review', 'revoked'] as const;
export type FulfilmentStatus = (typeof fulfilmentStatuses)[number];

export type AttemptTrigger = 'paid_event' | 'retry' | 'job';
/** Safe, fixed codes. Raw provider or exception text is never stored. */
export type DeliveryErrorCode =
  | 'email_failed' | 'email_unavailable' | 'order_not_paid' | 'order_not_found' | 'wrong_tenant' | 'version_not_approved'
  | 'file_missing' | 'file_changed' | 'unexpected';

export interface DeliveryAttempt {
  n: number;
  trigger: AttemptTrigger;
  startedAt: string;
  finishedAt: string | null;
  outcome: 'running' | 'delivered' | 'failed' | 'abandoned';
  error: DeliveryErrorCode | null;
  /** The grant this attempt sent (an id, never a token). A retry reuses the working grant of the attempt before it. */
  grantId: string | null;
}

/**
 * The latest support reissue request, kept so the same request submitted twice sends one email.
 * `grantId` is null while that request is still being sent.
 */
export interface ReissueRequest { key: string; at: string; grantId: string | null }

/** The delivery result: what was sent, when, and through which provider call. Never the link itself. */
export interface DeliveryResult {
  deliveredAt: string | null;
  emailMessageId: string | null;
  /** The key the email provider call carried. A repeat of the same call cannot send twice. */
  emailIdempotencyKey: string | null;
  lastError: DeliveryErrorCode | null;
}

export interface Fulfilment {
  id: string;
  orderId: string;
  orderItemId: string;
  workspaceId: string;
  businessId: string;
  storeSlug: string;
  productId: string;
  /** The version that was bought. Delivery always sends this version, even after a newer one is approved. */
  productVersion: number;
  /** The verified provider event that paid the order. */
  paidEventId: string;
  status: FulfilmentStatus;
  attempts: number;
  maxAttempts: number;
  attemptLog: DeliveryAttempt[];
  delivery: DeliveryResult;
  /** While `delivering`: the attempt's lease end (ISO). */
  leaseUntil: string | null;
  /** Support reissues, counted separately from delivery attempts. */
  reissues: number;
  /** Double-submit guard for support reissues (a request key, never a token). */
  reissueRequest: ReissueRequest | null;
  createdAt: string;
  updatedAt: string;
}

/** What the buyer owns: this version of this product from this store, reachable through one active download grant. */
export interface Entitlement {
  id: string;
  fulfilmentId: string;
  orderId: string;
  orderItemId: string;
  workspaceId: string;
  businessId: string;
  storeSlug: string;
  productId: string;
  productVersion: number;
  buyerEmail: string;
  /** The current download grant in the files service (id only). Null until the first grant is issued. */
  grantId: string | null;
  grantExpiresAt: string | null;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

export type NewFulfilment = Omit<Fulfilment, 'status' | 'attempts' | 'attemptLog' | 'delivery' | 'leaseUntil' | 'reissues' | 'reissueRequest' | 'updatedAt'>;
export type NewEntitlement = Omit<Entitlement, 'grantId' | 'grantExpiresAt' | 'status' | 'revokedAt'>;

export type MoneyEventKind = 'refund' | 'partial_refund' | 'dispute' | 'refund_exception';
/** One row per verified refund / dispute event (unique on the provider event id). */
export interface MoneyEvent {
  eventId: string;
  type: string;
  kind: MoneyEventKind;
  workspaceId: string;
  businessId: string;
  orderId: string;
  amountMinor: number | null;
  /** True when a person has to decide (dispute, partial refund, refund of an order that was never paid). Nothing is decided automatically. */
  needsOwner: boolean;
  /** Fixed outcome code, see RefundOutcome. */
  outcome: string;
  note: string | null;
  at: string;
}

export type FulfilmentAuditEvent =
  | 'fulfilment_created' | 'delivery_started' | 'delivered' | 'delivery_failed' | 'delivery_needs_review' | 'delivery_skipped'
  | 'retry_requested' | 'retry_refused' | 'access_reissued' | 'reissue_refused' | 'reissue_duplicate'
  | 'order_refunded' | 'access_revoked' | 'refund_event_ignored' | 'needs_owner';

export interface FulfilmentAuditEntry {
  seq: number;
  at: string;
  event: FulfilmentAuditEvent;
  workspaceId: string;
  businessId: string | null;
  orderId: string | null;
  fulfilmentId: string | null;
  /** Who did it: 'system:payment-event', 'system:refund-event', 'system:job' or the support/owner user id. */
  actor: string;
  /** A fixed code or the support person's stated reason. Never a token, an email body or a file path. */
  reason: string | null;
  note: string | null;
}

/** Storage seam: this memory store now, tables later. Every method is one atomic step. */
export interface FulfilmentStore {
  readonly kind: 'memory' | 'database';
  /** Insert the fulfilment and its entitlement together, or return the existing pair for the same order (unique on order id). */
  createForOrder(f: NewFulfilment, e: NewEntitlement): Promise<{ fulfilment: Fulfilment; entitlement: Entitlement; created: boolean }>;
  /** Workspace-scoped reads: another workspace's row looks like one that does not exist. */
  get(workspaceId: string, orderId: string): Promise<Fulfilment | null>;
  getEntitlement(workspaceId: string, orderId: string): Promise<Entitlement | null>;
  list(workspaceId: string): Promise<Fulfilment[]>;
  /**
   * Take the delivery lease. Succeeds only when the fulfilment is `queued` or `failed` (or `delivering` with an expired lease)
   * AND attempts < maxAttempts. Bumps attempts and opens an attempt-log row. Null when it cannot be claimed.
   * Mirrors one conditional UPDATE ... RETURNING.
   */
  claimAttempt(workspaceId: string, orderId: string, input: { at: string; leaseUntil: string; trigger: AttemptTrigger }): Promise<Fulfilment | null>;
  /** Close attempt `n`. Refused (null) when that attempt no longer holds the lease. `needsReview` parks a failure for the owner. */
  settleAttempt(workspaceId: string, orderId: string, n: number, result:
    | { ok: true; at: string; grantId: string; emailMessageId: string; emailIdempotencyKey: string }
    | { ok: false; at: string; error: DeliveryErrorCode; grantId: string | null; needsReview: boolean; revoked?: boolean }): Promise<Fulfilment | null>;
  /** Point the entitlement at its current grant (only while the entitlement is active). */
  setGrant(workspaceId: string, orderId: string, grant: { id: string; expiresAt: string }): Promise<Entitlement | null>;
  /**
   * Take the reissue slot for one request key, in one atomic step. Not claimed when the same key is already there and
   * (a) is still being sent and was claimed after `staleBefore`, or (b) has finished and is `sticky` (a caller-supplied key) or was
   * claimed after `staleBefore`. Null when there is no fulfilment or it is revoked.
   */
  claimReissue(workspaceId: string, orderId: string, input: { key: string; at: string; staleBefore: string; sticky: boolean }): Promise<{ claimed: true } | { claimed: false; grantId: string | null } | null>;
  /** Give the slot back after a reissue that sent nothing, so the same request can be tried again. */
  releaseReissue(workspaceId: string, orderId: string, key: string): Promise<void>;
  /** Record a support reissue that delivered a fresh link. `requestKey` closes the matching reissue slot with the grant it sent. */
  recordReissue(workspaceId: string, orderId: string, input: { at: string; grantId: string; emailMessageId: string; emailIdempotencyKey: string; requestKey?: string }): Promise<Fulfilment | null>;
  /** Refund: entitlement -> revoked, fulfilment -> revoked. Idempotent. */
  revoke(workspaceId: string, orderId: string, at: string): Promise<{ fulfilment: Fulfilment; entitlement: Entitlement; changed: boolean } | null>;
  hasMoneyEvent(eventId: string): Promise<boolean>;
  /** Insert once per provider event id. False when the event id is already recorded. */
  recordMoneyEvent(ev: MoneyEvent): Promise<boolean>;
  listMoneyEvents(workspaceId: string): Promise<MoneyEvent[]>;
  appendAudit(e: Omit<FulfilmentAuditEntry, 'seq'>): Promise<void>;
  listAudit(workspaceId: string): Promise<FulfilmentAuditEntry[]>;
}

/** Who is asking. Every owner/support call is scoped to one store (business) inside one workspace. */
export interface StoreScope { workspaceId: string; businessId: string; actorId: string }

export type FulfilOutcome =
  | 'delivered' | 'already_delivered' | 'in_progress' | 'failed' | 'needs_review' | 'revoked' | 'retries_exhausted'
  | 'order_not_found' | 'order_not_paid' | 'invalid';
export interface FulfilResult { outcome: FulfilOutcome; fulfilment: Fulfilment | null; error?: DeliveryErrorCode }

export type ReissueRefusal = 'invalid' | 'order_not_found' | 'order_not_paid' | 'order_refunded' | 'not_deliverable' | 'email_failed' | 'email_unavailable' | 'in_progress';
export type ReissueResult =
  /** `duplicate` marks a repeat of a request that was already sent: nothing new was issued or emailed. */
  | { ok: true; fulfilment: Fulfilment; grantId: string; revokedGrantIds: string[]; duplicate?: true }
  | { ok: false; code: ReissueRefusal; message: string };

export type RefundOutcome =
  | 'refunded' | 'already_refunded' | 'duplicate_event' | 'needs_owner' | 'unknown_order' | 'bad_signature' | 'invalid' | 'unsupported_type';
export interface RefundResult { outcome: RefundOutcome; orderId?: string }

/** One row of a store's order history. */
export interface OrderHistoryRow {
  orderId: string;
  createdAt: string;
  paidAt: string | null;
  title: string;
  amountMinor: number;
  currency: string;
  buyerEmail: string;
  orderStatus: OrderStatus;
  productId: string;
  productVersion: number;
  fulfilmentStatus: FulfilmentStatus | 'none';
  attempts: number;
  deliveredAt: string | null;
  lastError: DeliveryErrorCode | null;
  /** A dispute, partial refund or exhausted delivery is waiting for the owner. */
  needsOwner: boolean;
}

/** What a buyer sees for their own order (reference + email). No ids of other records, no link, no internal error. */
export interface BuyerOrderView {
  reference: string;
  title: string;
  amountMinor: number;
  currency: string;
  placedAt: string;
  orderStatus: OrderStatus;
  delivery: 'sent' | 'on_its_way' | 'not_sent' | 'access_withdrawn';
  deliveredAt: string | null;
  productVersion: number;
}
