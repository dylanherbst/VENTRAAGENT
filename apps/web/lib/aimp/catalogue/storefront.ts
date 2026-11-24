// Adapter from an approved catalogue listing to the storefront's product shape (AMP-023). Read-only: the storefront loads
// approved listings through the service and renders them with this. It never carries a master file, only the public cover id.
import { slugify } from '../preview/generate.ts';
import type { CoverStyle, StoreProduct } from '../storefront/schema.ts';
import type { PublicListing } from './types.ts';

export interface StoreProductExtras {
  /** From the approved brand's visual direction. */
  coverStyle: CoverStyle;
  /** Page count of the approved product version, when known. */
  pages?: number;
  /** What is inside, e.g. the product's listing claims ("12 monthly pages"). Taken from the product, never invented. */
  includes?: string[];
  tags?: string[];
  featured?: boolean;
}

export function toStoreProduct(l: PublicListing, x: StoreProductExtras): StoreProduct {
  return {
    slug: slugify(l.title),
    title: l.title,
    summary: l.shortDescription,
    description: [l.longDescription],
    priceMinor: l.priceMinor,
    format: 'PDF',
    ...(x.pages ? { pages: x.pages } : {}),
    includes: [...(x.includes ?? [])],
    tags: [...(x.tags ?? [])],
    featured: x.featured ?? false,
    cover: { style: x.coverStyle, label: l.title },
  };
}
