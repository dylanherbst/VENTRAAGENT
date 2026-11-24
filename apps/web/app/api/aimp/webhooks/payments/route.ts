import { createPaymentWebhookHandler } from '../../../../../lib/aimp/checkout/handlers.ts';
import { checkoutRuntime } from '../../../../../lib/aimp/checkout/demo.ts';

export const dynamic = 'force-dynamic';

// POST /api/aimp/webhooks/payments: the provider's event endpoint. The signature is checked over the raw body before anything
// is read from it. Only a verified `checkout.session.completed` for a known pending session marks an order paid, once.
// DEMO accepts only fixture-signed events. In production (without AIMP_TOOLS_ENABLED=1) it is 503 until real keys exist (AMP-043-D).
export const POST = createPaymentWebhookHandler(async () => (await checkoutRuntime())?.checkout ?? null);
