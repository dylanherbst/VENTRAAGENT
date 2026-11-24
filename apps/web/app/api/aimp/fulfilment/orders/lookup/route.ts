import { fulfilmentRuntime } from '../../../../../../lib/aimp/fulfilment/demo.ts';
import { createBuyerLookupHandler } from '../../../../../../lib/aimp/fulfilment/handlers.ts';
import { originOk } from '../../_origin.ts';

export const dynamic = 'force-dynamic';

// POST /api/aimp/fulfilment/orders/lookup { storeSlug, reference, email }: a buyer's own order status. Same-origin JSON only.
// Any mismatch (reference, email or store) is the same generic 404. No link is ever returned here. DEMO runs on fixtures;
// in production (without AIMP_TOOLS_ENABLED=1) it answers 503 until orders are stored in the database.
export const POST = createBuyerLookupHandler(async () => (await fulfilmentRuntime())?.world.fulfilment ?? null, { originOk });
