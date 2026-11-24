import { createCheckoutHandler } from '../../../../lib/aimp/checkout/handlers.ts';
import { checkoutRuntime } from '../../../../lib/aimp/checkout/demo.ts';

export const dynamic = 'force-dynamic';

// POST /api/aimp/checkout { storeSlug, listingId, buyerEmail, idempotencyKey }. Price, product, seller are resolved on the server;
// any price or seller in the body is ignored. DEMO runs on fixtures; in production (without AIMP_TOOLS_ENABLED=1) it is 503
// until the real Stripe adapter exists (AMP-043-D).
export const POST = createCheckoutHandler(async () => (await checkoutRuntime())?.checkout ?? null);
