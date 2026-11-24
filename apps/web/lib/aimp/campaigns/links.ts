// Listing lookup and product links for campaigns (AMP-050). Links are never hand-built: the product slug comes from the
// catalogue's own storefront adapter (toStoreProduct) and the URL from the storefront's canonical URL helper, so a campaign
// link is the same address the store page itself declares as canonical.
import { toStoreProduct } from '../catalogue/storefront.ts';
import { canonicalUrl } from '../hosts/seo.ts';
import { isClaimableStoreSlug } from '../hosts/slug.ts';
import type { CampaignContext, CampaignIssue, CampaignIssueCode, CampaignListing, CampaignStoreRef } from './types.ts';

export type SellableListing = CampaignListing & { status: 'approved'; cover: NonNullable<CampaignListing['cover']> };

/** The product slug the storefront gives this listing. */
export function productSlugFor(l: SellableListing): string {
  return toStoreProduct({
    listingId: l.listingId, businessId: l.businessId, productId: l.productId, title: l.title, shortDescription: l.shortDescription,
    longDescription: l.longDescription, cover: l.cover, priceMinor: l.priceMinor, currency: l.currency,
  }, { coverStyle: 'grid' }).slug;
}

/** The listing's storefront product URL for this store. Absolute when the store's public origin is configured. */
export function productUrlFor(store: CampaignStoreRef, l: SellableListing): string {
  return canonicalUrl(store.slug, `/products/${productSlugFor(l)}`, store.env ?? {});
}

/** True when campaign links are absolute URLs (a store domain or app origin is configured). */
export function linksAreAbsolute(store: CampaignStoreRef): boolean {
  return /^https?:\/\//.test(canonicalUrl(store.slug, '', store.env ?? {}));
}

export function storeIssues(store: CampaignStoreRef | null | undefined): CampaignIssue[] {
  if (!store || !isClaimableStoreSlug(store.slug)) return [{ field: 'store', code: 'store_not_live', message: 'This business has no store address yet. Publish the store before planning a campaign.' }];
  if (store.status === 'paused') return [{ field: 'store', code: 'store_not_live', message: 'The store is paused, so nothing can be linked to. Resume the store first.' }];
  if (store.status !== 'live') return [{ field: 'store', code: 'store_not_live', message: 'The store is not published yet. Publish it before planning a campaign.' }];
  return [];
}

/** The store must be this brand's own store: the caller's slug is never trusted on its own. Only meaningful once a brand exists. */
export function storeOwnershipIssues(ctx: Pick<CampaignContext, 'brand' | 'store'>): CampaignIssue[] {
  if (!ctx.brand || !ctx.store || ctx.store.slug !== ctx.brand.slug) return [{ field: 'store.slug', code: 'store_mismatch', message: "This store does not belong to this business's brand. Campaign links must point at the brand's own store." }];
  return [];
}

const isSellable = (l: CampaignListing): l is SellableListing => l.status === 'approved' && l.cover !== null && typeof l.cover === 'object';
const sameTenant = (ctx: Pick<CampaignContext, 'workspaceId' | 'businessId'>, l: CampaignListing): boolean => l.workspaceId === ctx.workspaceId && l.businessId === ctx.businessId;

export type ListingLookup = { ok: true; listing: SellableListing } | { ok: false; code: CampaignIssueCode; message: string };

/**
 * Find the listing a content item may sell: it must be in the supplied catalogue, belong to this workspace and business,
 * and be the approved version with a cover (what the storefront shows). Drafts and superseded versions never qualify.
 */
export function lookupListing(ctx: Pick<CampaignContext, 'workspaceId' | 'businessId' | 'listings'>, listingId: unknown): ListingLookup {
  const all = typeof listingId === 'string' ? ctx.listings.filter((l) => l.listingId === listingId) : [];
  if (all.length === 0) return { ok: false, code: 'listing_unknown', message: 'That listing is not in this catalogue.' };
  const mine = all.filter((l) => sameTenant(ctx, l));
  if (mine.length === 0) return { ok: false, code: 'listing_other_tenant', message: 'That listing does not belong to this business.' };
  const live = mine.find(isSellable);
  if (!live) return { ok: false, code: 'listing_not_sellable', message: 'That listing is not approved for sale (it is a draft, was replaced, or has no cover).' };
  return { ok: true, listing: live };
}

/** Every listing this business can sell right now, one per listing id, ordered by listing id so output never depends on input order. */
export function sellableListings(ctx: Pick<CampaignContext, 'workspaceId' | 'businessId' | 'listings'>): SellableListing[] {
  const ids = [...new Set(ctx.listings.map((l) => l.listingId))].sort();
  const out: SellableListing[] = [];
  for (const id of ids) {
    const r = lookupListing(ctx, id);
    if (r.ok) out.push(r.listing);
  }
  return out;
}
