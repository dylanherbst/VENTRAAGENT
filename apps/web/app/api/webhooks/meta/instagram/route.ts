// Meta webhook for Instagram (Instagram Login path). GET = subscription check; POST = signed events (signature checked over the RAW
// body before anything is read). 503 until the keys are set.
import { verifyChallenge } from '../../../../../lib/aimp/setter/webhook';
import { live } from '../../../../start/_server/setter-runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
  if (!token) return new Response('Not configured', { status: 503 });
  const q = new URL(req.url).searchParams;
  const c = verifyChallenge({ mode: q.get('hub.mode'), token: q.get('hub.verify_token'), challenge: q.get('hub.challenge') }, token);
  return c ? new Response(c, { status: 200, headers: { 'content-type': 'text/plain' } }) : new Response('Forbidden', { status: 403 });
}

const MAX_BODY = 1_000_000;
export async function POST(req: Request): Promise<Response> {
  const rt = live();
  if (!rt) return new Response('Not configured', { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413 });
  const r = await rt.setter.receive(raw, req.headers.get('x-hub-signature-256'));
  // No detail in the response; outcomes are in the audit log.
  return new Response(r.status === 200 ? 'EVENT_RECEIVED' : 'Unauthorized', { status: r.status });
}
