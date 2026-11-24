import { after, NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../../lib/supabase/client';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../../lib/request-body';
import { createRateLimiter } from '../../../../../lib/rate-limit';
import { supabaseConfigured } from '../../../../../lib/workspace-route';
import { handleInbound } from '../../../../../lib/front-office/orchestrator';
import type { AgentHooks, Rpc } from '../../../../../lib/front-office/orchestrator';
import { basicAuthPasswordMatches, emailSenderFromEnv, postmarkInbound, replySubject } from '../../../../../lib/front-office/email';
import { anthropicConfigFromEnv, anthropicLlm } from '../../../../../lib/front-office/llm';
import { googleCalendar, googleConfigFromEnv } from '../../../../../lib/front-office/calendar/google';
import { senderFromEnv } from '../../../../../lib/front-office/sms-send';
import { runSetterTurn } from '../../../../../lib/front-office/setter/agent';
import { channelPermissions } from '../../../../../lib/front-office/setter/actions';
import { loadSetter } from '../../../../../lib/front-office/settings';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Inbound email webhook (tracker 1.9), Postmark format. Set the inbound webhook URL to
//   https://ventra:<FRONT_OFFICE_EMAIL_WEBHOOK_SECRET>@<public origin>/api/front-office/email/inbound?channel=<id>&key=<channel key>
// Answers 200 quickly; the Setter's reply is emailed afterwards (logged only unless FRONT_OFFICE_SEND_LIVE=1).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const flood = createRateLimiter(600, 60_000);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function defer(work: () => Promise<void>) { try { after(work); } catch { void work(); } }

export async function POST(req: NextRequest) {
  if (!flood('email').allowed) return reply({ error: 'Too many requests.' }, 429);
  if (!supabaseConfigured()) return reply({ error: 'Front office storage is not configured.' }, 503);
  const secret = process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET ?? '';
  if (secret.length < 16) return reply({ error: 'Email webhook is not connected.', configured: false }, 503);
  if (!basicAuthPasswordMatches(req.headers.get('authorization'), secret)) return reply({ error: 'Not allowed.' }, 401);
  const channel = req.nextUrl.searchParams.get('channel') ?? '', key = req.nextUrl.searchParams.get('key') ?? '';
  if (!UUID.test(channel) || key.length < 32) return reply({ error: 'Channel not recognised.' }, 403);
  let mail;
  try { mail = postmarkInbound(JSON.parse(await readBoundedRequestBody(req, 512_000))); }
  catch (e) { return reply({ error: 'Invalid email.' }, e instanceof RequestBodyTooLarge ? 413 : 400); }
  const db = createSupabaseClient();
  const rpc: Rpc = async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
  const auth = { channel, key };
  const body = (mail.subject ? `Subject: ${mail.subject}\n\n` : '') + (mail.text || '(no text)');
  const ai = anthropicConfigFromEnv(), gcal = googleConfigFromEnv();
  const agents: AgentHooks = ai ? {
    setter: (contact) => defer(async () => {
      try {
        if (mail.name) await rpc('fo_save_details', { channel, channel_key: key, contact, new_answers: {}, contact_name: mail.name, contact_email: null, contact_phone: null });
        const setter = await loadSetter(rpc, auth);
        if (!setter.on) return;
        const turn = await runSetterTurn(contact, { llm: anthropicLlm(ai, fetch, 30_000), rpc, auth, calendar: gcal ? googleCalendar(gcal) : null, send: senderFromEnv(), config: setter.config, now: Date.now(), channel: 'email', permissions: channelPermissions(rpc, auth) });
        if (turn.reply) await emailSenderFromEnv()(mail.from, replySubject(mail.subject), turn.reply, mail.messageId);
      } catch (e) { console.error('front-office email turn failed:', e instanceof Error ? e.message : 'unknown'); }
    }),
  } : {};
  try {
    // STOP / unsubscribe counts in the new text, or in the subject when the text is empty.
    const result = await handleInbound(rpc, auth, { via: 'email', sender: mail.from, body, messageId: mail.messageId, checkText: mail.text || mail.subject }, agents);
    if (result.reply) defer(async () => { await emailSenderFromEnv()(mail.from, replySubject(mail.subject), result.reply as string, mail.messageId); });
    return reply({ received: true, duplicate: result.duplicate });
  } catch (e) {
    if (e instanceof Error && /Channel not recognised/.test(e.message)) return reply({ error: 'Channel not recognised.' }, 403);
    return reply({ error: 'Front office storage is unavailable.' }, 503);
  }
}
