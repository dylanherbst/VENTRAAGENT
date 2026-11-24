import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../lib/supabase/client';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../lib/request-body';
import { createRateLimiter } from '../../../../lib/rate-limit';
import { supabaseConfigured } from '../../../../lib/workspace-route';
import { sameOrigin } from '../../../../lib/request-security';
import { handleInbound } from '../../../../lib/front-office/orchestrator';
import type { Rpc } from '../../../../lib/front-office/orchestrator';
import { anthropicConfigFromEnv, anthropicLlm } from '../../../../lib/front-office/llm';
import { googleCalendar, googleConfigFromEnv } from '../../../../lib/front-office/calendar/google';
import { dryRunSender, senderFromEnv } from '../../../../lib/front-office/sms-send';
import { runSetterTurn, setterHooks } from '../../../../lib/front-office/setter/agent';
import { channelPermissions } from '../../../../lib/front-office/setter/actions';
import { loadSetter } from '../../../../lib/front-office/settings';
import { AuditDemoInvalid, auditDemoConfig, auditDemoHash, DEMO_NOT_ON, demoRpc, demoSender } from '../../../../lib/front-office/templates/audit';
import type { SetterConfig } from '../../../../lib/front-office/setter/config';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Website chat (tracker 1.8). The widget keeps a random visitor id in the browser and posts each message here.
// Channel: FRONT_OFFICE_CHAT_CHANNEL_ID / FRONT_OFFICE_CHAT_CHANNEL_KEY (server env; never sent to the browser).
// Other sites embedding the widget: FRONT_OFFICE_CHAT_ORIGINS (comma-separated origins). The AI answers only when
// FRONT_OFFICE_CHAT_LIVE=1 (owner approval); otherwise messages are recorded and a person follows up.
// Setter demo (Growth Audit -> Setter demo): a POST with `demo: { audit }` (a saved Growth Audit snapshot) runs the Setter
// with that business's details. It uses its own channel (FRONT_OFFICE_DEMO_CHANNEL_ID / _KEY), so demo leads never land in
// a real business's contacts; the config lives only for the request (no settings are read or changed); nothing is sent,
// booked or scheduled; and the AI answers only when FRONT_OFFICE_DEMO_LIVE=1 (owner approval). Request data cannot turn
// any of that on.
const VISITOR = /^[A-Za-z0-9_-]{16,64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const perVisitor = createRateLimiter(20, 60_000), global = createRateLimiter(1200, 60_000);
// Setter demo only (unauthenticated, can run paid model turns with caller-supplied business text). The visitor id is chosen
// by the caller, so demo turns are also limited per client address and by a demo-wide ceiling far below the chat one.
// Per server instance, reset on restart; not a substitute for a provider-side spending cap. Owner can tune these.
const DEMO_PER_CLIENT_LIMIT = 30, DEMO_PER_CLIENT_WINDOW_MS = 10 * 60_000; // 30 demo turns per client address per 10 minutes
const DEMO_GLOBAL_LIMIT = 120, DEMO_GLOBAL_WINDOW_MS = 60_000;              // 120 demo turns per minute across all clients
const demoPerClient = createRateLimiter(DEMO_PER_CLIENT_LIMIT, DEMO_PER_CLIENT_WINDOW_MS), demoGlobal = createRateLimiter(DEMO_GLOBAL_LIMIT, DEMO_GLOBAL_WINDOW_MS);
/** Client address hint: first x-forwarded-for entry, else x-real-ip (both set by the platform on Vercel). Callers with
 * neither share one 'unknown' bucket, so a missing header never means unlimited. */
function demoClientKey(req: NextRequest): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || (req.headers.get('x-real-ip') ?? '').trim();
  return 'ip:' + (ip.slice(0, 64) || 'unknown');
}

function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  if (sameOrigin(origin, req.headers.get('host'), req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN)) return origin;
  const list = (process.env.FRONT_OFFICE_CHAT_ORIGINS ?? '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes(origin) ? origin : null;
}
function reply(req: NextRequest, body: unknown, status = 200, extra: Record<string, string> = {}) {
  const origin = allowedOrigin(req);
  const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...cors, ...extra } });
}
function channelEnv() {
  const channel = process.env.FRONT_OFFICE_CHAT_CHANNEL_ID ?? '', key = process.env.FRONT_OFFICE_CHAT_CHANNEL_KEY ?? '';
  return supabaseConfigured() && UUID.test(channel) && key.length >= 32 ? { channel, key } : null;
}
function demoChannelEnv() {
  const channel = process.env.FRONT_OFFICE_DEMO_CHANNEL_ID ?? '', key = process.env.FRONT_OFFICE_DEMO_CHANNEL_KEY ?? '';
  return supabaseConfigured() && UUID.test(channel) && key.length >= 32 && channel !== process.env.FRONT_OFFICE_CHAT_CHANNEL_ID ? { channel, key } : null;
}
function rpcClient(): Rpc {
  const db = createSupabaseClient();
  return async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
}

export async function OPTIONS(req: NextRequest) {
  if (!allowedOrigin(req)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': allowedOrigin(req) as string, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' } });
}

export async function GET(req: NextRequest) {
  if (!allowedOrigin(req) && req.headers.get('origin')) return reply(req, { error: 'Not allowed.' }, 403);
  const auth = channelEnv();
  if (!auth) return reply(req, { error: 'Chat is not connected yet.', configured: false }, 503);
  const visitor = req.nextUrl.searchParams.get('visitor') ?? '';
  if (!VISITOR.test(visitor)) return reply(req, { error: 'Invalid visitor.' }, 400);
  try { return reply(req, { messages: await rpcClient()('fo_chat_history', { channel: auth.channel, channel_key: auth.key, visitor }) }); }
  catch { return reply(req, { error: 'Chat is unavailable. Please try again.' }, 503); }
}

export async function POST(req: NextRequest) {
  if (!allowedOrigin(req)) return reply(req, { error: 'Not allowed.' }, 403);
  if (!/^application\/json/i.test(req.headers.get('content-type') ?? '')) return reply(req, { error: 'Use JSON.' }, 415);
  const flood = global('chat');
  if (!flood.allowed) return reply(req, { error: 'Busy. Try again shortly.' }, 429, { 'Retry-After': String(flood.retryAfterSeconds) });
  const chatAuth = channelEnv(), demoAuth = demoChannelEnv();
  const notConnected = () => reply(req, { error: 'Chat is not connected yet.', configured: false }, 503);
  // Nothing connected: answer before reading the body, as plain chat always has.
  if (!chatAuth && !demoAuth) return notConnected();
  let input: { visitor?: unknown; message?: unknown; id?: unknown; demo?: unknown }, raw: string;
  // A demo request carries the Growth Audit snapshot, so it may be up to 40 KB; plain chat stays at 8 KB. Limits are bytes.
  try { raw = await readBoundedRequestBody(req, 40_000); } catch (e) { return !chatAuth ? notConnected() : reply(req, { error: 'Invalid request.' }, e instanceof RequestBodyTooLarge ? 413 : 400); }
  try { input = JSON.parse(raw); } catch { input = null as never; }
  const demo = !!input && typeof input === 'object' && !Array.isArray(input) && input.demo !== undefined;
  if (!demo) {
    if (!chatAuth) return notConnected();
    if (Buffer.byteLength(raw, 'utf8') > 8_000) return reply(req, { error: 'Invalid request.' }, 413);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(req, { error: 'Invalid request.' }, 400);
  }
  const auth = demo ? demoAuth : chatAuth;
  if (!auth) return reply(req, { error: 'The Setter demo is not connected yet.', configured: false, demo: true }, 503);
  if (demo) {
    // Before any validation, database or model work. Per client first, so one address cannot use up the demo-wide budget.
    const client = demoPerClient(demoClientKey(req));
    if (!client.allowed) return reply(req, { error: 'Too many demo messages. Try again later.', demo: true }, 429, { 'Retry-After': String(client.retryAfterSeconds) });
    const busy = demoGlobal('demo');
    if (!busy.allowed) return reply(req, { error: 'The Setter demo is busy. Try again shortly.', demo: true }, 429, { 'Retry-After': String(busy.retryAfterSeconds) });
  }
  const visitor = typeof input.visitor === 'string' ? input.visitor : '', message = typeof input.message === 'string' ? input.message.trim() : '', id = typeof input.id === 'string' ? input.id : '';
  if (!VISITOR.test(visitor) || !message || message.length > 2000 || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return reply(req, { error: 'Invalid message.' }, 400);
  let demoRun: { config: SetterConfig; hash: string } | null = null;
  if (demo) {
    const d = input.demo as { audit?: unknown } | null;
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.audit === undefined) return reply(req, { error: 'The demo needs a saved Growth Audit.', demo: true }, 400);
    try { demoRun = { config: auditDemoConfig(d.audit), hash: auditDemoHash(d.audit) }; } catch (e) { return reply(req, { error: e instanceof AuditDemoInvalid ? e.message : 'Growth audit is not valid.', demo: true }, 400); }
  }
  const limit = perVisitor(visitor);
  if (!limit.allowed) return reply(req, { error: 'Too many messages. Wait a moment.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
  if (demoRun) return demoTurn(req, auth, demoSender(visitor, demoRun.hash), message, id, demoRun.config);
  const rpc = rpcClient();
  try {
    let contact: string | null = null;
    // setterHooks: a booked visitor writing again is answered about their booking (task A-54), not left in silence.
    const result = await handleInbound(rpc, auth, { via: 'web-chat', sender: visitor, body: message, messageId: 'chat-' + visitor.slice(0, 16) + '-' + id }, setterHooks(c => { contact = c; }));
    if (result.reply || !contact) return reply(req, { reply: result.reply, live: true });
    const ai = anthropicConfigFromEnv(), gcal = googleConfigFromEnv();
    if (process.env.FRONT_OFFICE_CHAT_LIVE !== '1' || !ai) return reply(req, { reply: null, live: false, note: 'Thanks, your message is with the team. We will reply soon.' });
    const setter = await loadSetter(rpc, auth);
    if (!setter.on) return reply(req, { reply: null, live: false, note: 'Thanks, your message is with the team. We will reply soon.' });
    const turn = await runSetterTurn(contact, { llm: anthropicLlm(ai, fetch, 20_000), rpc, auth, calendar: gcal ? googleCalendar(gcal) : null, send: senderFromEnv(), config: setter.config, now: Date.now(), channel: 'web-chat', permissions: channelPermissions(rpc, auth) });
    return reply(req, { reply: turn.reply, live: true, booked: turn.booked });
  } catch {
    return reply(req, { error: 'Chat is unavailable. Please try again.' }, 503);
  }
}

/** One Setter demo turn on the demo channel. Opt-out (STOP) is handled by the orchestrator exactly as in live chat. */
/** sender: the visitor id keyed with the audit hash (demoSender), so each business gets its own demo contact. */
async function demoTurn(req: NextRequest, auth: { channel: string; key: string }, sender: string, message: string, id: string, config: SetterConfig) {
  const rpc = demoRpc(rpcClient());
  try {
    let contact: string | null = null;
    const result = await handleInbound(rpc, auth, { via: 'web-chat', sender, body: message, messageId: 'demo-' + sender.slice(-16) + '-' + sender.slice(0, 16) + '-' + id }, { setter: c => { contact = c; } });
    if (result.reply || !contact) return reply(req, { reply: result.reply, live: true, demo: true });
    const ai = anthropicConfigFromEnv();
    if (process.env.FRONT_OFFICE_DEMO_LIVE !== '1' || !ai) return reply(req, { reply: null, live: false, demo: true, note: DEMO_NOT_ON });
    const turn = await runSetterTurn(contact, { llm: anthropicLlm(ai, fetch, 20_000), rpc, auth, calendar: null, send: dryRunSender, config, now: Date.now(), channel: 'web-chat' });
    return reply(req, { reply: turn.reply, live: true, demo: true, state: turn.state });
  } catch {
    return reply(req, { error: 'The Setter demo is unavailable. Please try again.', demo: true }, 503);
  }
}
