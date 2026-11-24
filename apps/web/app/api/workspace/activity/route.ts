import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { byteLength, responseByteCaps } from '../../../../lib/byte-size';
import { shapeActivity } from '../../../../lib/account-activity';
export const dynamic = 'force-dynamic';
// Read-only list of what the signed-in user saved to the account (kind, revision, time). Authorisation is the launcher_drafts read policy (RLS) under the caller's own lp-access token; no service key, no writes, draft content is not selected.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your account activity.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.activity);
  if (isResponse(ws)) return ws;
  try {
    const result = await ws.db.from('launcher_drafts').select('kind,revision,updated_at').eq('workspace_id', ws.workspace).limit(500);
    if (result.error) return apiReply('storage_unavailable', 'Unable to load your activity. Please retry.');
    const entries = shapeActivity(result.data);
    // RLS returns nothing to non-members; with no rows we cannot tell, so confirm membership before reporting an empty list.
    if (!entries.length) { const denied = await requireMembership(ws, 'Unable to load your activity. Please retry.'); if (denied) return denied; }
    const out = { signedIn: true, entries };
    if (byteLength(JSON.stringify(out)) > responseByteCaps.activity) return apiReply('too_large', 'Too much activity to show at once.');
    return NextResponse.json(out, { headers: privateHeaders });
  } catch { return apiReply('invalid_request', 'Invalid request.'); }
}
