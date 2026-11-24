// Private master files, separate approved previews, purchase-bound expiring download grants (AMP-024).
// Pure types plus the seams: file storage, the order book and the grant store. Fixture adapters live beside this file;
// the Supabase Storage / table implementations plug into the same interfaces later.
import type { VersionStatus } from '../products/types.ts';

/** Where a version's files live. Everything is keyed by tenant, business, product and version number. */
export interface FileKey { workspaceId: string; businessId: string; productId: string; version: number }

export interface StoredFile { fileName: string; contentType: string; bytes: Uint8Array }

/**
 * Two physically separate namespaces. There is deliberately NO method that turns a master into a URL or a preview:
 * masters are only readable through getMaster, which the grant service alone calls.
 */
export interface FileStorage {
  putMaster(key: FileKey, file: StoredFile): Promise<void>;
  getMaster(key: FileKey): Promise<StoredFile | null>;
  putPreview(key: FileKey, file: StoredFile): Promise<void>;
  getPreview(key: FileKey): Promise<StoredFile | null>;
}

export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'failed';

/** What the files service needs to know about an order line (a snapshot of order_items joined to orders). */
export interface OrderItemRef {
  id: string;
  orderId: string;
  workspaceId: string;
  businessId: string;
  productId: string;
  /** The product version number that was bought (order_items.product_version). */
  productVersion: number;
  orderStatus: OrderStatus;
}
export interface OrderBook { getItem(orderItemId: string): Promise<OrderItemRef | null> }

export interface Grant {
  id: string;
  orderItemId: string;
  workspaceId: string;
  businessId: string;
  issuedAt: string;
  /** ISO timestamp; also signed into the token. */
  expiresAt: string;
  maxDownloads: number;
  downloads: number;
  revokedAt: string | null;
  /** The grant this one replaced, when reissued. */
  replacesGrantId: string | null;
}

export interface GrantStore {
  put(g: Grant): Promise<void>;
  get(grantId: string): Promise<Grant | null>;
  listByItem(orderItemId: string): Promise<Grant[]>;
  revoke(grantId: string, at: string): Promise<boolean>;
  /**
   * Atomically count one download only if the grant is not revoked, not expired at `atIso` and under its cap.
   * Mirrors `update ... set downloads = downloads + 1 where id = $1 and revoked_at is null and expires_at > $2 and downloads < max_downloads returning ...`.
   */
  tryConsume(grantId: string, atIso: string): Promise<boolean>;
  /**
   * One atomic step: revoke every still-active grant for the same order line and insert the new one, so concurrent
   * reissues leave exactly one active grant. Returns the stored grant (replacesGrantId set) and the ids it revoked.
   */
  replaceActive(next: Grant, atIso: string): Promise<{ grant: Grant; revoked: string[] }>;
}

/** Distinct reason codes. Operators and the audit log see these; the public route never does. */
export type DenyReason =
  | 'invalid_token'        // malformed, tampered, bad signature, or no such grant
  | 'expired'
  | 'revoked'
  | 'limit_reached'
  | 'order_not_paid'       // pending, failed or refunded
  | 'order_not_found'
  | 'wrong_tenant'         // order/product/grant belong to a different workspace or business
  | 'version_not_approved' // draft, in review, failed QA or superseded
  | 'file_missing'
  | 'file_changed';        // stored master no longer matches the approved hash

export class FilesError extends Error {
  readonly code: DenyReason | 'invalid_input';
  constructor(code: DenyReason | 'invalid_input', message: string) { super(message); this.name = 'FilesError'; this.code = code; }
}

export type AuditEvent = 'master_stored' | 'preview_stored' | 'grant_issued' | 'grant_revoked' | 'grant_reissued' | 'download_allowed' | 'download_denied' | 'preview_served' | 'preview_denied';
export interface AuditEntry {
  seq: number;
  at: string;
  event: AuditEvent;
  reason: DenyReason | null;
  grantId: string | null;
  orderItemId: string | null;
  workspaceId: string | null;
  /** The business the entry belongs to; null when it could not be determined (e.g. an unknown order line or an invalid token). */
  businessId: string | null;
  /** Never a token. */
  note: string | null;
}

/**
 * businessId (AMP-046) is required: every grant read/write and the audit view are limited to that business inside the
 * workspace; another business's order line or grant answers exactly like one that does not exist. Empty or non-string is refused.
 */
export interface FilesCtx { workspaceId: string; businessId: string; actorId?: string }

export type RedeemResult =
  | { ok: true; file: StoredFile; grantId: string; remaining: number; sha256: string }
  | { ok: false; reason: DenyReason; grantId: string | null };

export type { VersionStatus };
