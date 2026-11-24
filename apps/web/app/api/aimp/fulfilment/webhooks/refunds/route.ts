import { fulfilmentRuntime } from '../../../../../../lib/aimp/fulfilment/demo.ts';
import { createRefundWebhookHandler } from '../../../../../../lib/aimp/fulfilment/handlers.ts';

export const dynamic = 'force-dynamic';

// POST /api/aimp/fulfilment/webhooks/refunds: the provider's refund / dispute events. The signature is checked over the raw
// body before anything is read. A verified full refund marks the order refunded and revokes download access, once; disputes
// and partial refunds are only recorded for the owner. DEMO accepts only fixture-signed events. In production (without
// AIMP_TOOLS_ENABLED=1) it answers 503 until real keys and the orders table exist (AMP-043-D).
export const POST = createRefundWebhookHandler(async () => (await fulfilmentRuntime())?.world.fulfilment ?? null);
