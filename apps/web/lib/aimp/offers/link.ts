// Connects an approved offer to the existing products + catalogue pipeline, so checkout and the shop read the same approved product and
// the same stored price as everything else. Safe to call again: it reuses what already exists. The catalogue needs an APPROVED BRAND
// (listing copy comes from it), so without one the product is still saved and the result says "needs_brand" instead of failing.
import { CatalogueError } from '../catalogue/types.ts';
import type { CatalogueService } from '../catalogue/service.ts';
import { listingIdFor } from '../catalogue/service.ts';
import type { CoverAsset } from '../catalogue/types.ts';
import type { ProductService } from '../products/service.ts';
import type { ProductSpec } from '../factory/spec.ts';

export interface LinkDeps {
  products: Pick<ProductService, 'createProduct' | 'approve' | 'archiveProduct'>;
  catalogue: Pick<CatalogueService, 'createDraft' | 'editListing' | 'approveListing' | 'getListing'>;
  assets: { add(a: CoverAsset): void };
  workspaceId: string;
  actorId: string;
}
export interface Linked { productId: string; listingId: string | null; forVersion: number; priceMinor: number }
export type LinkResult =
  | { ok: true; state: 'live'; linked: Linked }
  | { ok: false; state: 'needs_brand'; message: string; linked: Linked }
  | { ok: false; state: 'failed'; message: string; linked: Linked | null };

export async function linkToCatalogue(
  d: LinkDeps,
  input: { businessId: string; spec: ProductSpec; priceMinor: number; version: number; previous: Linked | null },
): Promise<LinkResult> {
  const pctx = { workspaceId: d.workspaceId, actorId: d.actorId };
  const cctx = { workspaceId: d.workspaceId, businessId: input.businessId, actorUserId: d.actorId, idempotencyKey: `offer:${input.businessId}:v${input.version}` };
  let linked: Linked;
  try {
    const same = input.previous && input.previous.forVersion === input.version ? input.previous : null;
    if (same) linked = { ...same, priceMinor: input.priceMinor };
    else {
      if (input.previous) await d.products.archiveProduct(pctx, input.previous.productId, input.businessId);
      const { product, version } = await d.products.createProduct(pctx, { businessId: input.businessId, spec: input.spec });
      if (!version.qaPassed) return { ok: false, state: 'failed', message: 'The product did not pass the automatic checks, so it cannot be sold yet.', linked: null };
      await d.products.approve(pctx, version.id);
      for (const role of ['cover', 'preview', 'master'] as const) d.assets.add({ id: `${product.id}-${role}`, workspaceId: d.workspaceId, businessId: input.businessId, productId: product.id, role });
      linked = { productId: product.id, listingId: null, forVersion: input.version, priceMinor: input.priceMinor };
    }
  } catch (e) {
    return { ok: false, state: 'failed', message: e instanceof Error ? e.message : 'The product could not be saved.', linked: null };
  }
  try {
    const listingId = listingIdFor(linked.productId);
    const existing = await d.catalogue.getListing(cctx, listingId);
    if (!existing) await d.catalogue.createDraft(cctx, { businessId: input.businessId, productId: linked.productId });
    const latest = (await d.catalogue.getListing(cctx, listingId))!;
    const mustEdit = latest.priceMinor !== input.priceMinor || latest.title !== input.spec.title;
    const draft = latest.status === 'approved' && !mustEdit ? latest : await d.catalogue.editListing(cctx, listingId, { title: input.spec.title, priceMinor: input.priceMinor }, { expectedVersion: latest.version });
    if (draft.status !== 'approved') await d.catalogue.approveListing(cctx, listingId, { expectedVersion: draft.version });
    return { ok: true, state: 'live', linked: { ...linked, listingId } };
  } catch (e) {
    if (e instanceof CatalogueError && e.code === 'brand_not_approved') return { ok: false, state: 'needs_brand', message: 'Approve your brand to finish putting this product in your shop.', linked };
    const msg = e instanceof CatalogueError && e.issues.length ? e.issues.map((i) => i.message).join(' ') : e instanceof Error ? e.message : 'The listing could not be saved.';
    return { ok: false, state: 'failed', message: msg, linked };
  }
}
