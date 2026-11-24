// Zernio webhook: X-Zernio-Signature = hex HMAC-SHA256(raw body, ZERNIO_WEBHOOK_SECRET). Answer fast (Zernio wants a 2xx within 5 s).
// 401 on a bad signature; 200 for duplicates and events we do not use, so Zernio stops retrying them.
import { agentTeam } from '../../../start/_server/agent-team-runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response('Too large', { status: 413 });
  const r = agentTeam().handleZernioWebhook(raw, { signature: req.headers.get('x-zernio-signature'), eventId: req.headers.get('x-zernio-event-id') });
  if (!r.ok && r.error === 'bad_signature') return new Response('Bad signature', { status: 401 });
  if (!r.ok && r.error === 'bad_body') return new Response('Bad body', { status: 400 });
  return Response.json({ received: true });
}
