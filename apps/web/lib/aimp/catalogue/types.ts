// Catalogue types (AMP-023). A catalogue listing is what a buyer sees and what checkout charges: title, descriptions, cover,
// price. Status flow per listing version: draft -> approved -> superseded. Money is whole cents (AUD).
import type { AssetRole, OperationContext } from '../contracts.ts';

export type { OperationContext };

export type ListingStatus = 'draft' | 'approved' | 'superseded';
export type Currency = 'AUD';

/** A reference to a public image. Never a file: only an asset id and its role. */
export interface CoverRef { assetId: string; role: AssetRole }

export interface FieldChange { field: string; from: unknown; to: unknown }
export interface ListingHistoryEntry {
  at: string;
  by: string;
  kind: 'created' | 'edited' | 'repinned' | 'approved';
  /** Listing version this entry was recorded on. */
  version: number;
  changes: FieldChange[];
}

export interface CatalogueListing {
  /** Row id: `${listingId}-v${version}`. */
  id: string;
  /** Stable id for the catalogue entry across versions (one per product). Checkout and the storefront use this. */
  listingId: string;
  workspaceId: string;
  businessId: string;
  productId: string;
  /** The APPROVED product version this listing sells (AMP-022). */
  productVersionId: string;
  productVersion: number;
  /** 1, 2, 3 ... per listing. */
  version: number;
  status: ListingStatus;
  title: string;
  shortDescription: string;
  longDescription: string;
  cover: CoverRef | null;
  /** The price checkout charges once approved. Whole cents. */
  priceMinor: number;
  currency: Currency;
  /** True once the seller changed anything from the generated draft. Carried to later versions. */
  editedBySeller: boolean;
  /** Comparable prices (whole cents) used for suggestions; may be empty. */
  comparablePricesMinor: number[];
  /** Every create, edit, repin and approval so far, oldest first. */
  history: ListingHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** The fields a seller may change. Anything else is refused. */
export interface ListingEdits {
  title?: string;
  shortDescription?: string;
  longDescription?: string;
  priceMinor?: number;
  /** An asset id, or null to clear the cover. */
  coverAssetId?: string | null;
}

export interface CatalogueIssue { field: string; message: string }

export type CatalogueErrorCode =
  | 'invalid' | 'not_found' | 'product_not_approved' | 'brand_not_approved' | 'product_version_changed'
  | 'already_exists' | 'not_draft' | 'not_approved' | 'stale' | 'conflict';

export class CatalogueError extends Error {
  readonly code: CatalogueErrorCode;
  readonly issues: CatalogueIssue[];
  constructor(code: CatalogueErrorCode, message: string, issues: CatalogueIssue[] = []) {
    super(message);
    this.name = 'CatalogueError';
    this.code = code;
    this.issues = issues;
  }
}

/** Storage seam: this memory store now, database tables later. Each method is atomic per (workspace, listing). */
export interface CatalogueStore {
  readonly kind: 'memory' | 'database';
  /** Every version of one listing, oldest first. Empty for an unknown listing or another workspace. */
  list(workspaceId: string, listingId: string): Promise<CatalogueListing[]>;
  /** Every version of every listing of one business in this workspace. */
  listByBusiness(workspaceId: string, businessId: string): Promise<CatalogueListing[]>;
  /** Run `change` on the current versions and save what it returns. A throw saves nothing and propagates. */
  mutate<T>(workspaceId: string, listingId: string, change: (versions: CatalogueListing[]) => { versions: CatalogueListing[]; result: T }): Promise<T>;
}

/** What checkout may charge. Always read from the stored, approved listing. */
export interface CheckoutPrice {
  listingId: string;
  listingVersion: number;
  productId: string;
  /** The product version the listing was approved for. */
  productVersion: number;
  priceMinor: number;
  currency: Currency;
  title: string;
}

/** The only listing shape the storefront needs; no history, no approver, nothing private. */
export interface PublicListing {
  listingId: string;
  businessId: string;
  productId: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  cover: CoverRef;
  priceMinor: number;
  currency: Currency;
}

/** A public image registered for a product. */
export interface CoverAsset { id: string; workspaceId: string; businessId: string; productId: string; role: AssetRole }
export interface CoverAssetSource {
  get(workspaceId: string, assetId: string): Promise<CoverAsset | null>;
  listForProduct(workspaceId: string, productId: string): Promise<CoverAsset[]>;
}
