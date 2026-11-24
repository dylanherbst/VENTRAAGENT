// Server read for the Product editor (screen 13, AMP-084; C02 C03 C05 C06 C07 I05 I10). A plain function that takes the /start runtime
// as an argument, so it runs in the node tests without Next. No product, QA, approval or pricing rule lives here: versions, checks and
// the buyer file come from the product service, the listing from the catalogue service. The product id from the URL is never trusted:
// it must be one this business owns (the runtime's own index AND the service's business check), or the answer is "not found".
import { blueprintRegistry } from '../../../../../../lib/aimp/blueprints/index.ts';
import { listingIdFor } from '../../../../../../lib/aimp/catalogue/service.ts';
import type { CatalogueService } from '../../../../../../lib/aimp/catalogue/service.ts';
import { CatalogueError } from '../../../../../../lib/aimp/catalogue/types.ts';
import { canExportXlsx } from '../../../../../../lib/aimp/factory/export.ts';
import { MAX_REGENERATIONS } from '../../../../../../lib/aimp/products/service.ts';
import type { ProductService } from '../../../../../../lib/aimp/products/service.ts';
import { ProductError } from '../../../../../../lib/aimp/products/types.ts';
import { isBusinessId } from '../../../../../start/journey.ts';
import { isKnownBusiness } from '../../../_server/overview.ts';
import type { ProductsContexts, ProductsRuntime } from '../../_server/products.ts';
import { buildEditor } from '../view-model.ts';
import type { EditorVM } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type EditorRuntime = Omit<ProductsRuntime, 'products'> & { products: Pick<ProductService, 'listVersions' | 'getProduct'> };
export type EditorContexts = Pick<ProductsContexts, 'productCtx' | 'catalogueCtx'>;

export type EditorLookup = { found: false } | { found: true; editor: EditorVM };

/**
 * The product, its versions and its listing, or `found: false` for: an unknown business, a malformed or unknown product id, a product
 * that belongs to another business or workspace, or one whose versions do not all belong to this business.
 */
export async function loadProductEditor(rt: EditorRuntime, ctx: EditorContexts, businessId: string, productId: string): Promise<EditorLookup> {
  if (!isBusinessId(businessId) || !isBusinessId(productId)) return { found: false };
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  if (!(rt.productIds.get(businessId) ?? []).includes(productId)) return { found: false };
  let product;
  let versions;
  try {
    product = await rt.products.getProduct(ctx.productCtx, productId, businessId);
    versions = await rt.products.listVersions(ctx.productCtx, productId);
  } catch (e) {
    if (e instanceof ProductError && e.code === 'not_found') return { found: false };
    throw e;
  }
  if (!versions.length || versions.some((v) => v.businessId !== businessId || v.productId !== productId)) return { found: false };
  let listing: Awaited<ReturnType<CatalogueService['listVersions']>> = [];
  try { listing = await rt.catalogue.listVersions(ctx.catalogueCtx(businessId), listingIdFor(productId)); } catch (e) {
    if (!(e instanceof CatalogueError && e.code === 'not_found')) throw e;
  }
  const typeTitle = blueprintRegistry.find(versions[0].spec.blueprint.id)?.title ?? null;
  // The download section shows a spreadsheet link only when the shown version has tracker or checklist pages (same version the export route reads).
  const shown = versions.find((v) => v.status === 'approved') ?? versions[versions.length - 1];
  return { found: true, editor: buildEditor({ product, typeTitle, versions, listing, maxRegenerations: MAX_REGENERATIONS, canExportXlsx: canExportXlsx(shown.spec) }) };
}
