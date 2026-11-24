// Product version lifecycle (AMP-022): draft -> qa_failed | in_review -> approved -> superseded.
import type { ProductSpec } from '../factory/spec.ts';

export type VersionStatus = 'draft' | 'qa_failed' | 'in_review' | 'approved' | 'superseded';

export type QaCheckId = 'spec' | 'required_sections' | 'pdf_integrity' | 'layout' | 'listing_consistency';

export interface QaResult {
  id: QaCheckId;
  label: string;
  passed: boolean;
  /** Plain-English reasons; empty when passed. */
  reasons: string[];
}

export interface ProductRecord {
  id: string;
  workspaceId: string;
  businessId: string;
  blueprintId: string;
  createdAt: string;
  /** AMP-096: set while the product is archived (hidden from sale); absent when active. Versions are never touched. */
  archivedAt?: string;
  archivedBy?: string | null;
}

export interface ProductVersion {
  id: string;
  productId: string;
  workspaceId: string;
  businessId: string;
  /** 1, 2, 3 ... per product. */
  version: number;
  status: VersionStatus;
  spec: ProductSpec;
  /** sha256 (hex) of the exact buyer file (the ZIP). null when nothing could be rendered. */
  fileHash: string | null;
  fileName: string | null;
  fileBytes: number | null;
  pageCount: number | null;
  claimsOk: boolean;
  qa: QaResult[];
  qaPassed: boolean;
  /** Set on approval; equals fileHash and never changes afterwards. */
  approvedHash: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface Ctx { workspaceId: string; actorId?: string }

export type ProductErrorCode =
  | 'not_found' | 'qa_not_passed' | 'not_in_review' | 'immutable' | 'regenerate_limit'
  | 'hash_mismatch' | 'not_approved' | 'invalid' | 'conflict';

export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly problems: string[];
  constructor(code: ProductErrorCode, message: string, problems: string[] = []) {
    super(message);
    this.name = 'ProductError';
    this.code = code;
    this.problems = problems;
  }
}

/** Storage seam: the in-memory store now, the Supabase tables later. Every read is workspace-scoped. */
export interface ProductStore {
  createProduct(p: ProductRecord): Promise<void>;
  getProduct(workspaceId: string, productId: string): Promise<ProductRecord | null>;
  /** Every product of one business in this workspace, oldest first. */
  listProducts(workspaceId: string, businessId: string): Promise<ProductRecord[]>;
  /** Atomically set (or clear with null) the archived flag. Only that flag changes. Rejects an unknown product ('not_found'). */
  setArchived(workspaceId: string, productId: string, archive: { archivedAt: string; archivedBy: string | null } | null): Promise<ProductRecord>;
  listVersions(workspaceId: string, productId: string): Promise<ProductVersion[]>;
  getVersion(workspaceId: string, versionId: string): Promise<ProductVersion | null>;
  /**
   * Insert a new, unapproved version. Rejects (never overwrites) an existing id or an existing version number for the
   * product ('conflict'), and rejects when the product already has maxVersions versions ('regenerate_limit').
   */
  createVersion(v: ProductVersion, maxVersions?: number): Promise<void>;
  /** Update an existing unapproved version. Cannot approve (use approveVersion); an approved row can only become superseded. */
  saveVersion(v: ProductVersion): Promise<void>;
  /**
   * Atomically approve an in_review version (pinning approvedHash = fileHash) and supersede the product's previously
   * approved version, so a product never has two approved versions. Rejects qa_failed and draft versions.
   */
  approveVersion(workspaceId: string, versionId: string, meta: { approvedAt: string; approvedBy: string | null }): Promise<ProductVersion>;
}
