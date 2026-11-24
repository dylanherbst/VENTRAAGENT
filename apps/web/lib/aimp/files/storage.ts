// In-memory fixture adapters: file storage (separate master/preview maps), order book and grant store.
import { createHash } from 'node:crypto';
import { FilesError } from './types.ts';
import type { FileKey, FileStorage, Grant, GrantStore, OrderBook, OrderItemRef, OrderStatus, StoredFile } from './types.ts';

const seg = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 120 || /[\\/\0]/.test(v) || v === '.' || v === '..') throw new FilesError('invalid_input', `${name} is not a valid path segment.`);
  return v;
};
/** tenant/business/product/version path. Throws on anything that could escape its folder. */
export function fileKeyPath(k: FileKey): string {
  if (!Number.isInteger(k.version) || k.version < 1) throw new FilesError('invalid_input', 'version must be a positive integer.');
  return [seg(k.workspaceId, 'workspaceId'), seg(k.businessId, 'businessId'), seg(k.productId, 'productId'), `v${k.version}`].join('/');
}

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(; ?charset=[A-Za-z0-9._-]{1,40})?$/i;
/** A simple, header-safe MIME type (no CR/LF); anything else becomes application/octet-stream. */
export const safeContentType = (t: unknown): string => (typeof t === 'string' && t.length <= 200 && MIME.test(t) ? t : 'application/octet-stream');

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const copy = (f: StoredFile): StoredFile => ({ fileName: f.fileName, contentType: f.contentType, bytes: new Uint8Array(f.bytes) });

export function createMemoryFileStorage(): FileStorage {
  const masters = new Map<string, StoredFile>();
  const previews = new Map<string, StoredFile>();
  return {
    async putMaster(key, file) { masters.set(fileKeyPath(key), copy(file)); },
    async getMaster(key) { const f = masters.get(fileKeyPath(key)); return f ? copy(f) : null; },
    async putPreview(key, file) {
      const p = fileKeyPath(key);
      const m = masters.get(p);
      // A "preview" that is byte-identical to the master would publish the paid file.
      if (m && sha(m.bytes) === sha(file.bytes)) throw new FilesError('invalid_input', 'A preview must differ from the master file.');
      previews.set(p, copy(file));
    },
    async getPreview(key) { const f = previews.get(fileKeyPath(key)); return f ? copy(f) : null; },
  };
}

export interface MemoryOrderBook extends OrderBook {
  addPaidOrder(input: { orderId: string; itemId: string; workspaceId: string; businessId: string; productId: string; productVersion: number; status?: OrderStatus }): OrderItemRef;
  setStatus(orderId: string, status: OrderStatus): void;
}
export function createMemoryOrderBook(): MemoryOrderBook {
  const items = new Map<string, OrderItemRef>();
  return {
    async getItem(id) { const i = items.get(id); return i ? { ...i } : null; },
    addPaidOrder(i) {
      const ref: OrderItemRef = { id: i.itemId, orderId: i.orderId, workspaceId: i.workspaceId, businessId: i.businessId, productId: i.productId, productVersion: i.productVersion, orderStatus: i.status ?? 'paid' };
      items.set(ref.id, ref);
      return { ...ref };
    },
    setStatus(orderId, status) { for (const i of items.values()) if (i.orderId === orderId) i.orderStatus = status; },
  };
}

export function createMemoryGrantStore(): GrantStore {
  const grants = new Map<string, Grant>();
  return {
    async put(g) { grants.set(g.id, { ...g }); },
    async get(id) { const g = grants.get(id); return g ? { ...g } : null; },
    async listByItem(itemId) { return [...grants.values()].filter((g) => g.orderItemId === itemId).map((g) => ({ ...g })); },
    async revoke(id, at) {
      const g = grants.get(id);
      if (!g) return false;
      g.revokedAt ??= at;
      return true;
    },
    // Synchronous read-then-write: atomic in one JS turn. A database does this with one conditional UPDATE.
    async tryConsume(id, atIso) {
      const g = grants.get(id);
      if (!g || g.revokedAt !== null || Date.parse(g.expiresAt) <= Date.parse(atIso) || g.downloads >= g.maxDownloads) return false;
      g.downloads += 1;
      return true;
    },
    async replaceActive(next, atIso) {
      const revoked: string[] = [];
      let last: string | null = null;
      for (const g of grants.values()) {
        if (g.orderItemId !== next.orderItemId) continue;
        last = g.id;
        if (g.revokedAt === null) { g.revokedAt = atIso; revoked.push(g.id); }
      }
      const stored: Grant = { ...next, replacesGrantId: next.replacesGrantId ?? last };
      grants.set(stored.id, { ...stored });
      return { grant: stored, revoked };
    },
  };
}
