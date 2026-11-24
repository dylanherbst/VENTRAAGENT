// Server reads for the Products page (screen 12, AMP-083; E01). Plain functions that take the /start runtime as an argument, so they
// run in the node tests without Next. No product or pricing rule lives here: products come from the product service's own
// `listVersions` and prices from the catalogue service's `listVersions` (lib/aimp/products, lib/aimp/catalogue). Creating a product
// goes through the existing `productsAction` (app/start/actions.ts), see ../actions.ts.
import { blueprintRegistry } from '../../../../../lib/aimp/blueprints/index.ts';
import { listingIdFor } from '../../../../../lib/aimp/catalogue/service.ts';
import type { CatalogueService } from '../../../../../lib/aimp/catalogue/service.ts';
import type { OperationContext } from '../../../../../lib/aimp/catalogue/types.ts';
import { ProductError } from '../../../../../lib/aimp/products/types.ts';
import type { Ctx } from '../../../../../lib/aimp/products/types.ts';
import type { ProductService } from '../../../../../lib/aimp/products/service.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { buildRows, planCreate } from '../view-model.ts';
import type { CreatePlan, ProductRow, ProductSource } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type ProductsRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
  products: Pick<ProductService, 'listVersions' | 'getProduct'>;
  catalogue: Pick<CatalogueService, 'listVersions'>;
  seeds: { has(businessId: string): boolean };
};

export interface ProductsContexts {
  productCtx: Ctx;
  catalogueCtx: (businessId: string) => OperationContext;
  /** The demo's per-business product limit (`MAX_PRODUCTS_PER_BUSINESS` in app/start/_server/runtime.ts). */
  maxProducts: number;
}

export type ProductsLookup = { found: false } | { found: true; rows: ProductRow[]; create: CreatePlan };

/** Unknown business => `found: false`. Only the products this business owns are read; ids never come from the request. */
export async function loadProducts(rt: ProductsRuntime, ctx: ProductsContexts, businessId: string): Promise<ProductsLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const sources: ProductSource[] = [];
  for (const id of rt.productIds.get(businessId) ?? []) {
    let versions;
    let archived: boolean;
    try {
      versions = await rt.products.listVersions(ctx.productCtx, id);
      // The archived flag is the product service's (AMP-096). Asked with the business, so another business's product is 'not_found'.
      archived = Boolean((await rt.products.getProduct(ctx.productCtx, id, businessId)).archivedAt);
    } catch (e) {
      if (e instanceof ProductError && e.code === 'not_found') continue; // not in this workspace: it is not shown
      throw e;
    }
    if (!versions.length || versions.some((v) => v.businessId !== businessId)) continue;
    const listing = await rt.catalogue.listVersions(ctx.catalogueCtx(businessId), listingIdFor(id));
    sources.push({ id, typeTitle: blueprintRegistry.find(versions[0].spec.blueprint.id)?.title ?? null, versions, listing, archived });
  }
  const rows = buildRows(sources);
  return { found: true, rows, create: planCreate({ hasSeed: rt.seeds.has(businessId), count: rt.productIds.get(businessId)?.length ?? 0, max: ctx.maxProducts }) };
}
