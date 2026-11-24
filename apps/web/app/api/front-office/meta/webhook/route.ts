import { after, NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../../lib/supabase/client';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../../lib/request-body';
import { routeLimits } from '../../../../../lib/rate-limit';
import { supabaseConfigured } from '../../../../../lib/workspace-route';
import { handleInbound } from '../../../../../lib/front-office/orchestrator';
import type { Rpc } from '../../../../../lib/front-office/orchestrator';
import { autoSendOn, inReplyWindow, metaConfigFromEnv, metaSender, parseMetaWebhook, verifyChallenge, verifyMetaSignature } from '../../../../../lib/front-office/meta';
import { anthropicConfigFromEnv, anthropicLlm } from '../../../../../lib/front-office/llm';
import { googleCalendar, googleConfigFromEnv } from '../../../../../lib/front-office/calendar/google';
import { senderFromEnv } from '../../../../../lib/front-office/sms-send';
import { runSetterTurn } from '../../../../../lib/front-office/setter/agent';
import { channelPermissions } from '../../../../../lib/front-office/setter/actions';
import { SETTER_PROMPT_VERSION } from '../../../../../lib/front-office/setter/prompt';
import { BOOKING_CONFIRMATION_PROMPT } from '../../../../../lib/front-office/booking';
import { loadSetter } from '../../../../../lib/front-office/settings';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Meta webhook for Instagram and Messenger DMs (tracker 2.1). In the Meta app, subscribe the "messages" field with
//   https://<public origin>/api/front-office/meta/webhook?channel=<channel id>&key=<channel key>
// and verify token META_VERIFY_TOKEN. Replies wait in the approval queue (/tools/front-office-outbox) unless the owner
// sets FRONT_OFFICE_META_AUTOSEND=1. Outside Meta's 24-hour window nothing is sent automatically.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = (status: number, text: string) => new NextResponse(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
function defer(work: () => Promise<void>) { try { after(work); } catch { void work(); } }

export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams, process.env.META_VERIFY_TOKEN ?? '');
  return challenge ? plain(200, challenge) : plain(403, 'Verification failed.');
}

export async function POST(req: NextRequest) {
  const flood = routeLimits.metaWebhookGlobal('meta');
  if (!flood.allowed) return plain(429, 'Too many requests.');
  const secret = process.env.META_APP_SECRET ?? '';
  if (!supabaseConfigured() || !secret) return plain(503, 'Meta webhook is not connected.');
  const channel = req.nextUrl.searchParams.get('channel') ?? '', key = req.nextUrl.searchParams.get('key') ?? '';
  if (!UUID.test(channel) || key.length < 32) return plain(403, 'Channel not recognised.');
  let raw: string;
  try { raw = await readBoundedRequestBody(req, 256_000); } catch (e) { return plain(e instanceof RequestBodyTooLarge ? 413 : 400, 'Invalid request.'); }
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), secret)) return plain(403, 'Invalid signature.');
  let events;
  try { events = parseMetaWebhook(JSON.parse(raw)); } catch { return plain(400, 'Invalid request.'); }
  const db = createSupabaseClient();
  const rpc: Rpc = async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
  const auth = { channel, key };
  const ai = anthropicConfigFromEnv(), gcal = googleConfigFromEnv(), meta = metaConfigFromEnv();
  try {
    for (const ev of events) {
      await handleInbound(rpc, auth, { via: ev.kind, sender: ev.sender, body: ev.text, messageId: ev.messageId }, ai ? {
        setter: (contact) => defer(async () => {
          try {
            const setter = await loadSetter(rpc, auth);
            if (!setter.on) return;
            const turn = await runSetterTurn(contact, { llm: anthropicLlm(ai, fetch, 30_000), rpc, auth, calendar: gcal ? googleCalendar(gcal) : null, send: senderFromEnv(), config: setter.config, now: Date.now(), channel: ev.kind, logReply: false, permissions: channelPermissions(rpc, auth) });
            if (!turn.reply) return;
            const prompt = turn.booked ? BOOKING_CONFIRMATION_PROMPT : SETTER_PROMPT_VERSION;
            const w = await rpc('fo_social_window', { channel, channel_key: key, contact }) as { recipient: string | null; optedOut: boolean; lastInbound: string | null };
            if (autoSendOn() && meta && w.recipient && !w.optedOut && inReplyWindow(w.lastInbound, Date.now())) {
              if (!turn.booked) await rpc('fo_log_outbound', { channel, channel_key: key, contact, message: turn.reply, agent_name: 'setter', prompt });
              await metaSender(meta)(ev.kind, w.recipient, turn.reply);
            } else {
              await rpc('fo_queue_outbound', { channel, channel_key: key, contact, message: turn.reply, prompt });
            }
          } catch (e) { console.error('front-office meta turn failed:', e instanceof Error ? e.message : 'unknown'); }
        }),
      } : {});
    }
    // Meta retries on anything but 200; ingest is idempotent by message id.
    return plain(200, 'EVENT_RECEIVED');
  } catch (e) {
    if (e instanceof Error && /Channel not recognised/.test(e.message)) return plain(403, 'Channel not recognised.');
    return plain(503, 'Front office storage is unavailable.');
  }
}
