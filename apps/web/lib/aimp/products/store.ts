import { ProductError } from './types.ts';
import type { ProductRecord, ProductStore, ProductVersion } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

/** The approval invariant, enforced by the store itself: an approved row is QA-passed and pinned to its own file hash. */
function checkApprovedShape(v: ProductVersion): void {
  if (v.status === 'approved' && !(v.qaPassed && v.qa.every((q) => q.passed) && v.fileHash && v.approvedHash === v.fileHash)) {
    throw new ProductError('qa_not_passed', 'Only a version that passed every check, pinned to its own file hash, can be approved.');
  }
}

/**
 * In-memory store. Every method body is synchronous between its read and its write, so each call is atomic
 * (a database implementation must get the same guarantees from a transaction and unique indexes).
 */
export function createMemoryProductStore(): ProductStore {
  const products = new Map<string, ProductRecord>();
  const versions = new Map<string, ProductVersion>();
  const ofProduct = (workspaceId: string, productId: string) =>
    [...versions.values()].filter((v) => v.productId === productId && v.workspaceId === workspaceId);

  return {
    async createProduct(p) {
      if (products.has(p.id)) throw new ProductError('invalid', 'That product already exists.');
      products.set(p.id, clone(p));
    },
    async getProduct(workspaceId, productId) {
      const p = products.get(productId);
      return p && p.workspaceId === workspaceId ? clone(p) : null;
    },
    async listProducts(workspaceId, businessId) {
      return [...products.values()].filter((p) => p.workspaceId === workspaceId && p.businessId === businessId).map(clone);
    },
    async setArchived(workspaceId, productId, archive) {
      const p = products.get(productId);
      if (!p || p.workspaceId !== workspaceId) throw new ProductError('not_found', 'That product was not found.');
      const next: ProductRecord = { ...p };
      delete next.archivedAt;
      delete next.archivedBy;
      if (archive) { next.archivedAt = archive.archivedAt; next.archivedBy = archive.archivedBy; }
      products.set(productId, clone(next));
      return clone(next);
    },
    async listVersions(workspaceId, productId) {
      return ofProduct(workspaceId, productId).sort((a, b) => a.version - b.version).map(clone);
    },
    async getVersion(workspaceId, versionId) {
      const v = versions.get(versionId);
      return v && v.workspaceId === workspaceId ? clone(v) : null;
    },
    async createVersion(v, maxVersions) {
      if (v.status === 'approved' || v.status === 'superseded') throw new ProductError('invalid', 'A new version must start unapproved.');
      if (versions.has(v.id)) throw new ProductError('conflict', 'That version already exists, so nothing was overwritten.');
      const mine = ofProduct(v.workspaceId, v.productId);
      if (mine.some((x) => x.version === v.version)) throw new ProductError('conflict', `Version ${v.version} of this product already exists. Try again.`);
      if (maxVersions !== undefined && mine.length >= maxVersions) {
        throw new ProductError('regenerate_limit', 'This product has reached its regeneration limit. Keep one of the existing versions or start a new product.');
      }
      versions.set(v.id, clone(v));
    },
    async saveVersion(next) {
      const cur = versions.get(next.id);
      if (!cur || cur.workspaceId !== next.workspaceId) throw new ProductError('not_found', 'That version was not found.');
      if (cur.status === 'approved' || cur.status === 'superseded') {
        const supersede = cur.status === 'approved' && next.status === 'superseded';
        const sameOtherwise = JSON.stringify({ ...cur, status: 'x' }) === JSON.stringify({ ...next, status: 'x' });
        if (!(supersede && sameOtherwise)) throw new ProductError('immutable', 'An approved version cannot be changed. Regenerate to make a new version.');
      } else {
        checkApprovedShape(next);
        if (next.status === 'approved') throw new ProductError('invalid', 'Approve a version through approveVersion so the previous one is replaced in the same step.');
        if (next.status === 'superseded') throw new ProductError('invalid', 'Only an approved version can be superseded.');
      }
      versions.set(next.id, clone(next));
    },
    async approveVersion(workspaceId, versionId, meta) {
      const cur = versions.get(versionId);
      if (!cur || cur.workspaceId !== workspaceId) throw new ProductError('not_found', 'That version was not found.');
      if (cur.status === 'approved' || cur.status === 'superseded') throw new ProductError('immutable', 'That version is already approved or replaced and cannot be changed.');
      if (cur.status === 'draft') throw new ProductError('not_in_review', 'This version has not been checked yet.');
      const approved: ProductVersion = { ...cur, status: 'approved', approvedHash: cur.fileHash, approvedAt: meta.approvedAt, approvedBy: meta.approvedBy };
      checkApprovedShape(approved); // qa_failed rows fail here
      for (const old of ofProduct(workspaceId, cur.productId)) if (old.status === 'approved') versions.set(old.id, { ...old, status: 'superseded' });
      versions.set(approved.id, clone(approved));
      return clone(approved);
    },
  };
}
