import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../../lib/rate-limit';
import { sameOrigin } from '../../../../../lib/request-security';
import { readBoundedRequestBody } from '../../../../../lib/request-body';
import { isPlainObject, isSameOriginJson } from '../../../../../lib/api-errors';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../../lib/workspace-route';
import { approvePendingAction, rejectPendingAction } from '../../../../../lib/front-office/pending-actions';
import type { PendingActionRecord } from '../../../../../lib/front-office/pending-actions';
import { approvalExecutor, approvalOptions, cannotPerform, memberStore, publicItem, queueError } from '../shared';
export const dynamic = 'force-dynamic';

// The owner decides one held action (task A-21).
//   POST /api/front-office/pending-actions/<id>?workspace=<id>  {decision: "approve"|"reject", note?}   owner only
// -> {outcome: performed|failed|rejected|expired|already_decided, item}
// Approve performs the original action exactly once (approvePendingAction); a repeat, or an item past its expiry, changes
// nothing. The item must belong to the workspace in the URL; anything else is the same generic 403.
// Instagram / Messenger items (A-37): Meta's 24-hour window is checked again at approval (approvalOptions). Inside it the
// send is queued for the jobs runner; outside it the item fails with META_WINDOW_CLOSED_AT_APPROVAL and one owner task.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginJson(req.headers, (o, h) => sameOrigin(o, h, req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN))) return apiReply('forbidden_origin', 'Use same-origin JSON.');
  const pre = preflight(req, { signedOut: 'Sign in to decide.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiReply('invalid_request', 'Invalid request.');
  let input: unknown;
  try { input = JSON.parse(await readBoundedRequestBody(req, 4_000)); } catch { return apiReply('invalid_request', 'Invalid request.'); }
  if (!isPlainObject(input) || (input.decision !== 'approve' && input.decision !== 'reject')) return apiReply('invalid_request', 'Decision must be approve or reject.');
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 500)) return apiReply('invalid_request', 'Note must be text of at most 500 characters.');
  const note = typeof input.note === 'string' ? input.note : null;
  const store = memberStore(ws);
  try {
    // Find the item in this workspace's queue (listing expires overdue items first).
    let item: PendingActionRecord | undefined = (await store.list({ status: 'pending', limit: 500 })).find(a => a.id === id);
    if (!item) item = (await store.list({ limit: 500 })).find(a => a.id === id);
    if (!item) return apiReply('no_workspace_access', 'Workspace access is unavailable.');
    if (item.status !== 'pending') return NextResponse.json({ outcome: item.status === 'expired' ? 'expired' : 'already_decided', item: publicItem(item) }, { headers: privateHeaders });
    if (input.decision === 'approve') {
      const why = cannotPerform(item, process.env);
      if (why) return apiReply('conflict', why, { item: publicItem(item) });
    }
    const r = input.decision === 'approve'
      ? await approvePendingAction(store, id, ws.userId, approvalExecutor(process.env), note, approvalOptions(process.env, item.channelId))
      : await rejectPendingAction(store, id, ws.userId, note);
    return NextResponse.json({ outcome: r.outcome, item: publicItem(r.item) }, { headers: privateHeaders });
  } catch (e) { return queueError(e); }
}
