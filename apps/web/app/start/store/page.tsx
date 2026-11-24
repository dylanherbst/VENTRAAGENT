import type { Metadata } from 'next';
import { StoreView } from './store-view';

export const metadata: Metadata = { title: 'Your store' };

// Draft, preview, publish, pause and roll back the customer's store: the real site-version store and buy-button rule
// (the same calls as /tools/site-publish and /tools/storefront), on the glass library. The draft is built from the
// brand and listings approved in the earlier steps.
export default function StartStore() {
  return <StoreView />;
}
