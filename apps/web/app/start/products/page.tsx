import type { Metadata } from 'next';
import { ProductsView } from './products-view';

export const metadata: Metadata = { title: 'Your products' };

// Build, check, review and approve the first product: the real Product Factory and product service (the same calls
// as /tools/product-factory and /tools/product-review), on the glass library, built from the customer's chosen idea.
export default function StartProducts() {
  return <ProductsView />;
}
