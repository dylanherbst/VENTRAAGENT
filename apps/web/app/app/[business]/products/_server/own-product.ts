// The one check every product action on these pages starts with (archive and restore, and the product editor): the ids are well
// formed, the business is known to this runtime, and the product is filed under THIS business. A plain function so the node tests
// run it. The product service still checks workspace and business again; this only refuses early, with the page's words.
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_PRODUCT = 'We could not find that product.';

export type OwnProductRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'>;

export type OwnProductCheck<R> = { ok: false; message: string } | { ok: true; businessId: string; productId: string; rt: R };

/** `rt` is read only after both ids are well formed, so a malformed request touches nothing. */
export function checkOwnProduct<R extends OwnProductRuntime>(rt: () => R, businessId: unknown, productId: unknown): OwnProductCheck<R> {
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  if (!isBusinessId(productId)) return { ok: false, message: NO_PRODUCT };
  const runtime = rt();
  if (!isKnownBusiness(runtime, businessId)) return { ok: false, message: NO_BUSINESS };
  if (!(runtime.productIds.get(businessId) ?? []).includes(productId)) return { ok: false, message: NO_PRODUCT };
  return { ok: true, businessId, productId, rt: runtime };
}
