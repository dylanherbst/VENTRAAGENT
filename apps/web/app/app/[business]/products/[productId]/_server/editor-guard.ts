// The checks `editProductAction` runs before it hands an edit to the existing /start actions, as a pure function so the node tests can
// run them (actions.ts imports Next-only modules). It decides WHICH existing action runs and with what; it never changes a product,
// a listing or a price itself. Order: demo storage on, valid ids, known business, the product is this business's own and not archived,
// the request has a known shape, a version id belongs to this product.
import { listingIdFor } from '../../../../../../lib/aimp/catalogue/service.ts';
import { ProductError } from '../../../../../../lib/aimp/products/types.ts';
import type { CatalogueOp, ProductsOp } from '../../../../../start/journey-types.ts';
import { NO_BUSINESS, NO_PRODUCT, checkOwnProduct } from '../../_server/own-product.ts';
import type { EditorContexts, EditorRuntime } from './editor.ts';

export { NO_BUSINESS, NO_PRODUCT };
export const NO_VERSION = 'That version was not found.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const ARCHIVED = 'This product is archived, so it cannot be changed here.';

export type EditorOp =
  | { kind: 'approve_version'; versionId: string }
  | { kind: 'regenerate' }
  | { kind: 'start_listing' }
  | { kind: 'save_listing'; version: number; title: string; shortDescription: string; longDescription: string; priceMinor: number }
  | { kind: 'approve_listing'; version: number }
  | { kind: 'repin_listing' };

/** The one existing action to run, with the exact op to hand it. */
export type Delegation = { target: 'products'; op: ProductsOp } | { target: 'catalogue'; op: CatalogueOp };

export interface EditorGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => EditorRuntime;
  ctx: Pick<EditorContexts, 'productCtx'>;
}

export type EditorGuard = { ok: false; message: string } | { ok: true; delegate: Delegation };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_TEXT = 20_000;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/** Shape check only. Whether a title is long enough or a price is allowed is the catalogue service's call. */
export function readOp(raw: unknown): EditorOp | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'approve_version': return typeof raw.versionId === 'string' && raw.versionId.length > 0 && raw.versionId.length <= 200 ? { kind: 'approve_version', versionId: raw.versionId } : null;
    case 'regenerate': return { kind: 'regenerate' };
    case 'start_listing': return { kind: 'start_listing' };
    case 'repin_listing': return { kind: 'repin_listing' };
    case 'approve_listing': return whole(raw.version) ? { kind: 'approve_listing', version: raw.version } : null;
    case 'save_listing':
      return whole(raw.version) && text(raw.title) && text(raw.shortDescription) && text(raw.longDescription) && typeof raw.priceMinor === 'number' && Number.isSafeInteger(raw.priceMinor)
        ? { kind: 'save_listing', version: raw.version, title: raw.title, shortDescription: raw.shortDescription, longDescription: raw.longDescription, priceMinor: raw.priceMinor }
        : null;
    default: return null;
  }
}

export async function guardEditorOp(g: EditorGuardInput, rawBusinessId: unknown, rawProductId: unknown, rawOp: unknown): Promise<EditorGuard> {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  const own = checkOwnProduct(g.rt, rawBusinessId, rawProductId);
  if (!own.ok) return own;
  const { rt, businessId, productId } = own;
  let archived: boolean;
  let versionIds: string[];
  try {
    archived = Boolean((await rt.products.getProduct(g.ctx.productCtx, productId, businessId)).archivedAt);
    versionIds = (await rt.products.listVersions(g.ctx.productCtx, productId)).filter((v) => v.businessId === businessId).map((v) => v.id);
  } catch (e) {
    if (e instanceof ProductError && e.code === 'not_found') return { ok: false, message: NO_PRODUCT };
    throw e;
  }
  if (archived) return { ok: false, message: ARCHIVED };
  const op = readOp(rawOp);
  if (!op) return { ok: false, message: BAD_REQUEST };
  const listingId = listingIdFor(productId);
  switch (op.kind) {
    case 'approve_version':
      return versionIds.includes(op.versionId) ? { ok: true, delegate: { target: 'products', op: { kind: 'approve', versionId: op.versionId } } } : { ok: false, message: NO_VERSION };
    case 'regenerate': return { ok: true, delegate: { target: 'products', op: { kind: 'regenerate', productId } } };
    case 'start_listing': return { ok: true, delegate: { target: 'catalogue', op: { kind: 'start', productId } } };
    case 'repin_listing': return { ok: true, delegate: { target: 'catalogue', op: { kind: 'repin', listingId } } };
    case 'approve_listing': return { ok: true, delegate: { target: 'catalogue', op: { kind: 'approve', listingId, version: op.version } } };
    case 'save_listing':
      return {
        ok: true,
        delegate: { target: 'catalogue', op: { kind: 'save', listingId, version: op.version, title: op.title, shortDescription: op.shortDescription, longDescription: op.longDescription, priceMinor: op.priceMinor } },
      };
  }
}
