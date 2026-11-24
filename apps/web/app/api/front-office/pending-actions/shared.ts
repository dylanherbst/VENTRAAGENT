import { createSupabaseClient } from '../../../../lib/supabase/client';
import { apiReply } from '../../../../lib/workspace-route';
import type { OpenedWorkspace } from '../../../../lib/workspace-route';
import { createSupabasePendingActionStore, PendingActionError } from '../../../../lib/front-office/pending-actions';
import type { ActionExecutor, ApproveOptions, PendingActionRecord, PendingActionStore } from '../../../../lib/front-office/pending-actions';
import type { ChannelAuth, Rpc } from '../../../../lib/front-office/orchestrator';
import { createJobsExecutor, metaRunnerChannels, runnerChannels, socialWindowCheck } from '../../../../lib/front-office/jobs';
import type { MetaKind } from '../../../../lib/front-office/meta';
import { isChannelKind } from '../../../../lib/front-office/contracts';
import type { Channel } from '../../../../lib/front-office/handoff';
import { createSetterExecutor } from '../../../../lib/front-office/setter/actions';
import { loadSetter } from '../../../../lib/front-office/settings';
import { senderFromEnv } from '../../../../lib/front-office/sms-send';
import { googleCalendar, googleConfigFromEnv } from '../../../../lib/front-office/calendar/google';

// Shared by the approval-queue routes (task A-21). Not a route file: Next only treats route.ts as a route.

/** The owner's or member's queue, read and decided under their own session (RLS and the fo_* checks apply). */
export function memberStore(ws: OpenedWorkspace): PendingActionStore {
  const rpc: Rpc = async (fn, args) => { const r = await ws.db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
  return createSupabasePendingActionStore({ rpc, workspaceId: ws.workspace });
}

/** What the owner sees for one item. The idempotency key and channel id stay on the server; an invalid payload is hidden. */
export function publicItem(a: PendingActionRecord) {
  return {
    id: a.id, product: a.product, contactId: a.contactId, callId: a.callId, mode: a.mode, payload: a.invalid ? null : a.payload,
    summary: a.summary, status: a.status, createdAt: a.createdAt, expiresAt: a.expiresAt, decidedAt: a.decidedAt, decidedBy: a.decidedBy,
    note: a.note, committedAt: a.committedAt, invalid: a.invalid,
  };
}

/** Maps a queue error to a safe reply. Not found and another business's item get the same generic 403. */
export function queueError(e: unknown) {
  if (e instanceof PendingActionError) {
    if (e.code === 'forbidden' || e.code === 'not_found') return apiReply('no_workspace_access', 'Workspace access is unavailable.');
    if (e.code === 'invalid') return apiReply('invalid_request', 'Invalid request.');
    if (e.code === 'conflict') return apiReply('conflict', e.message);
  }
  return apiReply('storage_unavailable', 'The approval queue is not available right now.');
}

/** Every channel an approved item can be performed on: the runner's SMS, chat, email and voice channels, plus the
 * Instagram and Messenger channels (A-37; FRONT_OFFICE_INSTAGRAM_CHANNEL_* / FRONT_OFFICE_MESSENGER_CHANNEL_*). */
/** kind: what that channel is (the customer's channel for the follow-up consent rule, A-47); null when it is not one we
 * know, which fails closed. */
export function approvalChannel(env: Record<string, string | undefined>, channelId: string | null): { auth: ChannelAuth; meta: MetaKind | null; kind: Channel | null } | null {
  if (!channelId) return null;
  const plain = runnerChannels(env).find(c => c.auth.channel === channelId);
  if (plain) return { auth: plain.auth, meta: null, kind: isChannelKind(plain.name) ? plain.name : null };
  const meta = metaRunnerChannels(env).find(c => c.auth.channel === channelId);
  return meta ? { auth: meta.auth, meta: meta.name, kind: meta.name } : null;
}

/** The rpc the executor and the Meta window check use: the fo_* channel functions check the channel key themselves.
 * The client is created on first use, so building the approve options never throws. */
function serviceRpc(): Rpc {
  let db: ReturnType<typeof createSupabaseClient> | null = null;
  return async (fn, args) => { db ??= createSupabaseClient(); const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
}

/** Why an approved item cannot be performed from here right now (so it stays pending), or null when it can. */
export function cannotPerform(a: PendingActionRecord, env: Record<string, string | undefined>): string | null {
  if (a.product !== 'setter') return 'Approving Receptionist actions from here is not switched on yet. The item is still waiting.';
  if (a.invalid) return null; // approving closes it as failed; it is never performed
  if (!approvalChannel(env, a.channelId)) return 'The channel this action came from is not connected here, so it cannot be performed yet. The item is still waiting.';
  return null;
}

/** The approve options for an item (A-37): on a connected channel, Meta's 24-hour window is checked again at approval
 * through fo_social_window (jobs.ts socialWindowCheck); a closed window queues the text for the owner. approvePendingAction
 * only uses it for Instagram and Messenger payloads. Without a connected channel there is no check, so a Meta payload
 * fails closed. */
export function approvalOptions(env: Record<string, string | undefined>, channelId: string | null): ApproveOptions {
  const c = approvalChannel(env, channelId);
  return c ? { replyWindow: socialWindowCheck(serviceRpc(), c.auth) } : {};
}

/** Performs an approved Setter item through the same executor as a direct action, on the channel it came from.
 * Texts go through senderFromEnv(): a dry run unless FRONT_OFFICE_SEND_LIVE is on. An Instagram or Messenger send or
 * follow-up is only marked approved here (createJobsExecutor); the jobs runner sends it, by Meta only inside the window
 * and only when FRONT_OFFICE_META_AUTOSEND=1 (metaJobSender), so approving never calls Meta directly. */
export function approvalExecutor(env: Record<string, string | undefined>): ActionExecutor {
  return async action => {
    const c = approvalChannel(env, action.channelId);
    if (!c) return { ok: false, note: 'The channel for this action is not connected, so nothing was done.' };
    const rpc = serviceRpc();
    const gcal = googleConfigFromEnv(env);
    const config = (await loadSetter(rpc, c.auth)).config;
    // via: the channel the held item came from (its channelId, stored server-side with the item when it was held), so an
    // approved follow-up uses the same consent rule as a direct one: a same-channel SMS/email reply, otherwise a grant.
    const setter = createSetterExecutor({ rpc, auth: c.auth, calendar: gcal ? googleCalendar(gcal) : null, config, now: Date.now(), send: senderFromEnv(env), via: c.kind });
    return createJobsExecutor(setter)(action);
  };
}
