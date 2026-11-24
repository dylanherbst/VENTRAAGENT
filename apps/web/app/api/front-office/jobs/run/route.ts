import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../../lib/workspace-route';
import { metaRunnerChannels, runDueJobs, runnerAuthorized, runnerChannels, runnerSecrets } from '../../../../../lib/front-office/jobs';
import type { ChannelAuth, Rpc } from '../../../../../lib/front-office/orchestrator';
import { metaJobSender } from '../../../../../lib/front-office/meta';
import { isChannelKind } from '../../../../../lib/front-office/contracts';
import type { MetaKind } from '../../../../../lib/front-office/meta';
import { senderFromEnv } from '../../../../../lib/front-office/sms-send';
import { emailSenderFromEnv } from '../../../../../lib/front-office/email';
import { loadSetter } from '../../../../../lib/front-office/settings';
import { channelPermissions } from '../../../../../lib/front-office/setter/actions';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Job runner (tracker 1.4, 1.5): sends due follow-ups, reminders and no-show rescues on every configured channel
// (FRONT_OFFICE_CHANNEL_* for SMS, FRONT_OFFICE_CHAT_CHANNEL_* for website chat, FRONT_OFFICE_EMAIL_CHANNEL_* for email).
//   GET  /api/front-office/jobs/run   called every minute by Vercel Cron (vercel.json), Authorization: Bearer <CRON_SECRET>
//   POST /api/front-office/jobs/run   for any other scheduler,       Authorization: Bearer <FRONT_OFFICE_CRON_SECRET>
// Either secret is accepted on either method. Texts are logged; they are only really sent when FRONT_OFFICE_SEND_LIVE=1.
// Instagram / Messenger (FRONT_OFFICE_INSTAGRAM_CHANNEL_*, FRONT_OFFICE_MESSENGER_CHANNEL_*): only inside Meta's 24-hour
// window, and only really sent when FRONT_OFFICE_META_AUTOSEND=1 and Meta is configured; outside it, an owner task.
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function run(req: NextRequest) {
  const secrets = runnerSecrets(process.env);
  if (!secrets.length) return reply({ error: 'Job runner is not configured.', configured: false }, 503);
  if (!runnerAuthorized(req.headers.get('authorization'), secrets)) return reply({ error: 'Not allowed.' }, 401);
  // Instagram / Messenger channels run with meta set: Meta's 24-hour window decides every job (jobs.ts metaRoute).
  // via: what each channel is, for the follow-up consent rule (A-47); a name that is not a known channel kind is left
  // out, so a follow-up there needs a consent grant (fail closed).
  const channels: { name: string; auth: ChannelAuth; meta?: MetaKind }[] = [...runnerChannels(process.env), ...metaRunnerChannels(process.env).map(c => ({ ...c, meta: c.name }))];
  if (!supabaseConfigured() || !channels.length) return reply({ error: 'Front office channel is not configured.', configured: false }, 503);
  const db = createSupabaseClient();
  const rpc: Rpc = async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
  const send = senderFromEnv(), email = emailSenderFromEnv(), now = Date.now(), metaSend = metaJobSender(process.env);
  const results: { channel: string; kind: string; outcome: string; note: string; sent: boolean }[] = [];
  let failed = 0;
  for (const c of channels) {
    try {
      for (const r of await runDueJobs({ rpc, auth: c.auth, send, email, config: async () => (await loadSetter(rpc, c.auth)).config, now, permissions: channelPermissions(rpc, c.auth), ...(isChannelKind(c.name) ? { via: c.name } : {}), ...(c.meta ? { meta: { kind: c.meta, send: metaSend } } : {}) })) results.push({ channel: c.name, kind: r.kind, outcome: r.outcome, note: r.note, sent: r.sent });
    } catch { failed++; }
  }
  if (failed === channels.length) return reply({ error: 'Front office storage is unavailable.' }, 503);
  return reply({ ran: results.length, channels: channels.length, failedChannels: failed, results });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
