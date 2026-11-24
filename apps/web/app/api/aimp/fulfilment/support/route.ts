import { fulfilmentRuntime } from '../../../../../lib/aimp/fulfilment/demo.ts';
import { createSupportHandler } from '../../../../../lib/aimp/fulfilment/handlers.ts';
import { originOk } from '../_origin.ts';

export const dynamic = 'force-dynamic';

// POST /api/aimp/fulfilment/support { action: 'orders' | 'retry' | 'reissue', orderId?, reason? }: store owner / support actions.
// Same-origin JSON only, and the store is taken from the signed-in session, never from the body.
// FAIL CLOSED: owner sessions are not yet mapped to AiMoneyPrinter stores, so `authorize` resolves nobody and every call is
// answered 401 (503 in production without AIMP_TOOLS_ENABLED=1). The demo page /tools/aimp-fulfilment calls the same service
// directly. Wiring `authorize` to the workspace session + business ownership is a follow-up (see docs/aimp/fulfilment-notes.md).
export const POST = createSupportHandler(async () => (await fulfilmentRuntime())?.world.fulfilment ?? null, { originOk, authorize: () => null });
