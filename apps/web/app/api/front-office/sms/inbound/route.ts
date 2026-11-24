import { after, NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../../lib/supabase/client';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../../lib/request-body';
import { routeLimits } from '../../../../../lib/rate-limit';
import { supabaseConfigured } from '../../../../../lib/workspace-route';
import { formParams, inboundSms, twiml, verifyTwilioSignature } from '../../../../../lib/front-office/twilio';
import { handleInboundSms } from '../../../../../lib/front-office/orchestrator';
import type { AgentHooks, Rpc } from '../../../../../lib/front-office/orchestrator';
import { anthropicConfigFromEnv, anthropicLlm } from '../../../../../lib/front-office/llm';
import { googleCalendar, googleConfigFromEnv } from '../../../../../lib/front-office/calendar/google';
import { senderFromEnv } from '../../../../../lib/front-office/sms-send';
import { runSetterTurn } from '../../../../../lib/front-office/setter/agent';
import { channelPermissions } from '../../../../../lib/front-office/setter/actions';
import { loadSetter } from '../../../../../lib/front-office/settings';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Run work after the response; outside a request scope (tests) run it directly. */
function defer(work: () => Promise<void>) {
  try { after(work); } catch { void work(); }
}

// Twilio inbound SMS webhook (tracker 0.5). Configure the number's "A message comes in" webhook as
//   POST https://<public origin>/api/front-office/sms/inbound?channel=<channel id>&key=<channel key>
// The channel key comes from fo_create_channel; TWILIO_AUTH_TOKEN signs every request. No user session, no service key.
const xmlHeaders = { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' };
const plain = (status: number, text: string, headers: Record<string, string> = {}) => new NextResponse(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const flood = routeLimits.smsWebhookGlobal('front-office-sms');
  if (!flood.allowed) return plain(429, 'Too many requests.', { 'Retry-After': String(flood.retryAfterSeconds) });
  if (!supabaseConfigured()) return plain(503, 'Front office storage is not configured.');
  const token = process.env.TWILIO_AUTH_TOKEN;
  const unsignedOk = process.env.FRONT_OFFICE_ALLOW_UNSIGNED === '1' && process.env.NODE_ENV !== 'production';
  if (!token && !unsignedOk) return plain(503, 'SMS webhook is not connected: no Twilio auth token is configured.');
  const channel = req.nextUrl.searchParams.get('channel') ?? '', key = req.nextUrl.searchParams.get('key') ?? '';
  if (!UUID.test(channel) || key.length < 32 || key.length > 200) return plain(403, 'Channel not recognised.');
  let params: Record<string, string>;
  try { params = formParams(await readBoundedRequestBody(req, 16_000)); } catch (e) { return plain(e instanceof RequestBodyTooLarge ? 413 : 400, 'Invalid request.'); }
  if (token) {
    // Twilio signs the URL it called. Behind a proxy, set FRONT_OFFICE_PUBLIC_ORIGIN to that public origin.
    const origin = process.env.FRONT_OFFICE_PUBLIC_ORIGIN?.replace(/\/$/, '') ?? req.nextUrl.origin;
    if (!verifyTwilioSignature(token, origin + req.nextUrl.pathname + req.nextUrl.search, params, req.headers.get('x-twilio-signature'))) return plain(403, 'Invalid signature.');
  }
  let sms;
  try { sms = inboundSms(params); } catch { return plain(400, 'Invalid message.'); }
  const db = createSupabaseClient();
  const rpc: Rpc = async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
  try {
    // The Setter replies after Twilio gets its answer (Twilio waits at most 15 s). Its reply goes out through the sender,
    // which only really sends when FRONT_OFFICE_SEND_LIVE=1; otherwise it is logged only.
    const ai = anthropicConfigFromEnv(), gcal = googleConfigFromEnv();
    const agents: AgentHooks = ai ? {
      setter: (contact) => defer(async () => {
        try {
          const send = senderFromEnv();
          const setter = await loadSetter(rpc, { channel, key });
          if (!setter.on) return;
          const turn = await runSetterTurn(contact, { llm: anthropicLlm(ai), rpc, auth: { channel, key }, calendar: gcal ? googleCalendar(gcal) : null, send, config: setter.config, now: Date.now(), channel: 'sms', permissions: channelPermissions(rpc, { channel, key }) });
          if (turn.reply) await send(sms.from, turn.reply);
        } catch (e) {
          console.error('front-office setter turn failed:', e instanceof Error ? e.message : 'unknown');
        }
      }),
    } : {};
    const result = await handleInboundSms(rpc, { channel, key }, sms, agents);
    return new NextResponse(twiml(result.reply ?? undefined), { status: 200, headers: xmlHeaders });
  } catch (e) {
    if (e instanceof Error && /Channel not recognised/.test(e.message)) return plain(403, 'Channel not recognised.');
    // 503 makes Twilio retry; ingest is idempotent by message id.
    return plain(503, 'Front office storage is unavailable.');
  }
}
