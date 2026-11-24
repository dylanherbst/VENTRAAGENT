import type { Metadata } from 'next';
import { CatalogueView } from './catalogue-view';

export const metadata: Metadata = { title: 'Listings and pricing' };

// Listing wording and price for each approved product: the real catalogue service, price suggestion and fee estimate
// (the same calls as /tools/catalogue), on the glass library, using the product and brand approved in earlier steps.
export default function StartCatalogue() {
  return <CatalogueView />;
}
