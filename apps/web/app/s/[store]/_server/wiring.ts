// AMP-150: connects the public-store Test purchase to the real /start runtime. Server-only; imported by the store pages and by actions.ts.
// Not loaded by node tests (runtime.ts is not loadable there); the logic it feeds is in test-purchase.ts.
import { getPrimaryRegistry, startRuntimeFromGlobal } from '../../../../lib/aimp/hosts/registry';
import { loadPublishedStore } from '../../../../lib/aimp/storefront/load';
import { availability, runtime } from '../../../start/_server/runtime';
import type { TestPurchaseDeps } from './test-purchase';

export function testPurchaseDeps(): TestPurchaseDeps {
  return {
    availability,
    load: (slug) => loadPublishedStore(slug),
    world: async () => {
      // No /start runtime in this process means no /start store can exist: do not create one for a public page view.
      if (!startRuntimeFromGlobal()) return null;
      const rt = runtime();
      // `origin.primary` is the ONE built-in registry (AMP-152): `runStorefrontTestPurchase` refuses any address a built-in store holds.
      return { so: rt.orderDemo, src: { catalogue: rt.catalogue, products: rt.products, slugs: rt.slugs }, origin: { primary: await getPrimaryRegistry(), sites: rt.sites } };
    },
  };
}
