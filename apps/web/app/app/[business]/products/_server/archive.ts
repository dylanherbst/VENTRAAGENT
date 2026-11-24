// Archive and restore for the Products page (AMP-097; service: AMP-096 + AMP-100). Plain functions that take the /start runtime as an
// argument so the node tests run the same code the server action runs (actions.ts imports Next-only modules and only forwards here).
// No archive rule lives here: what archiving does, who may do it and what the live store still shows all come from the product
// service (`archiveProduct`, `unarchiveProduct`). This file only checks the request and words the answer.
// Order of checks: demo storage on, valid ids, known business, the product is filed under this business, the request has a known
// shape, an archive carries the explicit confirmation. The service then checks workspace and business again ('not_found').
import { ProductError } from '../../../../../lib/aimp/products/types.ts';
import type { Ctx } from '../../../../../lib/aimp/products/types.ts';
import type { ProductService } from '../../../../../lib/aimp/products/service.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { NO_BUSINESS, NO_PRODUCT, checkOwnProduct } from './own-product.ts';

export { NO_BUSINESS, NO_PRODUCT };
export const WENT_WRONG = 'Something went wrong, so nothing was changed. Try again.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const NEEDS_CONFIRM = 'Please confirm that you want to archive this product. Nothing was changed.';
export const ARCHIVED_OK = 'Product archived. It is hidden from sale, and nothing was deleted.';
export const RESTORED_OK = 'Product restored. It is back exactly as it was before you archived it.';
export const REPUBLISH_NEEDED = 'Your live store still shows this product until you publish your website again.';
export const REPUBLISH_UNKNOWN = 'We could not check whether your live store still shows this product. If your store is live, publish your website again to be sure.';

/** What the live store does after an archive: `needed` = it still shows the product, `unknown` = could not be checked, `none` = nothing to do. */
export type RepublishState = 'needed' | 'unknown' | 'none';

export type ArchiveOp = { kind: 'archive'; confirm: true } | { kind: 'restore' };

export type ArchiveRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
  products: Pick<ProductService, 'archiveProduct' | 'unarchiveProduct'>;
};

export interface ArchiveGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => ArchiveRuntime;
  /** The signed-in workspace and actor (the fixed demo workspace today). Never taken from the request. */
  productCtx: Ctx;
}

export interface ArchiveReply {
  ok: boolean;
  message: string;
  /** Extra line about the live store; empty when there is nothing to say. */
  storeNote: string;
  republish: RepublishState;
  /** Where to publish again; set only when `republish` is not `none`. */
  websiteHref: string | null;
}

export type ArchiveGuard = { ok: false; message: string } | { ok: true; op: ArchiveOp; businessId: string; productId: string; rt: ArchiveRuntime };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shape check only. An archive without `confirm: true` is not an archive request. */
export function readArchiveOp(raw: unknown): ArchiveOp | 'unconfirmed' | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'restore') return { kind: 'restore' };
  if (raw.kind === 'archive') return raw.confirm === true ? { kind: 'archive', confirm: true } : 'unconfirmed';
  return null;
}

export function guardArchive(g: ArchiveGuardInput, businessId: unknown, productId: unknown, rawOp: unknown): ArchiveGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  const own = checkOwnProduct(g.rt, businessId, productId);
  if (!own.ok) return own;
  const op = readArchiveOp(rawOp);
  if (op === null) return { ok: false, message: BAD_REQUEST };
  if (op === 'unconfirmed') return { ok: false, message: NEEDS_CONFIRM };
  return { ok: true, op, businessId: own.businessId, productId: own.productId, rt: own.rt };
}

/** The service's `storeNeedsRepublish` in page terms. `null` is never read as "nothing to do". */
export function republishFrom(storeNeedsRepublish: boolean | null): RepublishState {
  return storeNeedsRepublish === true ? 'needed' : storeNeedsRepublish === false ? 'none' : 'unknown';
}

export const websiteHref = (businessId: string): string => `/app/${businessId}/website`;

const refuse = (message: string): ArchiveReply => ({ ok: false, message, storeNote: '', republish: 'none', websiteHref: null });

/** Guard, then the product service. This is everything `archiveProductAction` does. */
export async function runArchive(g: ArchiveGuardInput, businessId: unknown, productId: unknown, rawOp: unknown): Promise<ArchiveReply> {
  const checked = guardArchive(g, businessId, productId, rawOp);
  if (!checked.ok) return refuse(checked.message);
  try {
    if (checked.op.kind === 'restore') {
      await checked.rt.products.unarchiveProduct(g.productCtx, checked.productId, checked.businessId);
      return { ok: true, message: RESTORED_OK, storeNote: '', republish: 'none', websiteHref: null };
    }
    const r = await checked.rt.products.archiveProduct(g.productCtx, checked.productId, checked.businessId);
    const republish = republishFrom(r.storeNeedsRepublish);
    return {
      ok: true, message: ARCHIVED_OK, republish,
      storeNote: republish === 'needed' ? REPUBLISH_NEEDED : republish === 'unknown' ? REPUBLISH_UNKNOWN : '',
      websiteHref: republish === 'none' ? null : websiteHref(checked.businessId),
    };
  } catch (e) {
    // Another workspace, another business and an unknown product all look the same: not found.
    if (e instanceof ProductError && e.code === 'not_found') return refuse(NO_PRODUCT);
    throw e;
  }
}

/**
 * `runArchive` for the server action: anything it throws (other than the not-found it already words) becomes one plain refusal, and
 * only the error's name is logged. This is the whole body of `archiveProductAction`, kept here so the node tests run it.
 */
export async function runArchiveSafely(
  g: () => ArchiveGuardInput, businessId: unknown, productId: unknown, rawOp: unknown, log: (message: string, detail: string) => void = console.error,
): Promise<ArchiveReply> {
  try {
    return await runArchive(g(), businessId, productId, rawOp);
  } catch (e) {
    log('[app products] archive or restore failed:', e instanceof Error ? e.name : 'unknown error');
    return refuse(WENT_WRONG);
  }
}
