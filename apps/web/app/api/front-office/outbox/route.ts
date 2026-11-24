import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { sameOrigin } from '../../../../lib/request-security';
import { readBoundedRequestBody } from '../../../../lib/request-body';
import { isPlainObject, isSameOriginJson } from '../../../../lib/api-errors';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../lib/workspace-route';
import { inReplyWindow, metaConfigFromEnv, metaSender } from '../../../../lib/front-office/meta';
import type { MetaKind } from '../../../../lib/front-office/meta';
import { uuid } from '../../../../lib/workspace-validation';
export const dynamic = 'force-dynamic';

// Approval queue for AI replies on Instagram and Messenger. Signed-in workspace members only (RLS + fo_decide_outbox).
//   GET  /api/front-office/outbox?workspace=<id>                      queued replies, oldest first
//   POST /api/front-office/outbox?workspace=<id>  {id, decision, text?} approve (optionally edited) or reject
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to review replies.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.outbox);
  if (isResponse(ws)) return ws;
  const r = await ws.db.from('fo_outbox').select('id,contact_id,body,prompt_version,created_at,channel_id').eq('workspace_id', ws.workspace).eq('status', 'queued').order('created_at').limit(100);
  if (r.error) return apiReply('storage_unavailable', 'Unable to load the queue. Check that the database is up to date.');
  return NextResponse.json({ items: r.data }, { headers: privateHeaders });
}

export async function POST(req: NextRequest) {
  if (!isSameOriginJson(req.headers, (o, h) => sameOrigin(o, h, req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN))) return apiReply('forbidden_origin', 'Use same-origin JSON.');
  const pre = preflight(req, { signedOut: 'Sign in to review replies.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.outbox);
  if (isResponse(ws)) return ws;
  let input: unknown;
  try { input = JSON.parse(await readBoundedRequestBody(req, 8_000)); } catch { return apiReply('invalid_request', 'Invalid request.'); }
  if (!isPlainObject(input) || (input.decision !== 'approved' && input.decision !== 'rejected')) return apiReply('invalid_request', 'Choose approve or reject.');
  let id: string;
  try { id = uuid(input.id); } catch { return apiReply('invalid_request', 'Invalid item.'); }
  const edited = typeof input.text === 'string' ? input.text.slice(0, 1000) : null;
  const d = await ws.db.rpc('fo_decide_outbox', { w: ws.workspace, item: id, decision: input.decision, edited });
  if (d.error) return apiReply('conflict', 'This reply was already handled, or the contact opted out.');
  const o = d.data as { id: string; status: string; body: string; kind: MetaKind | string; recipient: string | null; lastInbound: string | null };
  if (o.status !== 'approved') return NextResponse.json({ status: o.status }, { headers: privateHeaders });
  const meta = metaConfigFromEnv();
  let ok = false, info: string;
  if (!meta || !o.recipient || (o.kind !== 'instagram' && o.kind !== 'messenger')) info = 'Approved, but Instagram or Messenger is not connected yet.';
  else if (!inReplyWindow(o.lastInbound, Date.now())) info = 'Approved, but Meta’s 24-hour reply window has closed. Reply from the Instagram or Facebook app.';
  else {
    try { await metaSender(meta)(o.kind, o.recipient, o.body); ok = true; info = 'Sent'; } catch (e) { info = e instanceof Error ? e.message : 'Send failed.'; }
  }
  await ws.db.rpc('fo_outbox_sent', { w: ws.workspace, item: o.id, ok, info });
  return NextResponse.json({ status: ok ? 'sent' : 'failed', note: info }, { headers: privateHeaders });
}
