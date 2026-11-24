import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../lib/workspace-route';
import { shapeMembers } from '../../../../lib/team-members';
export const dynamic = 'force-dynamic';
// Read-only. Authorisation is the database member_read policy on memberships; no service key, no writes.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your team.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.team);
  if (isResponse(ws)) return ws;
  try {
    const result = await ws.db.from('memberships').select('user_id,role,active').eq('workspace_id', ws.workspace).eq('active', true);
    if (result.error) return apiReply('storage_unavailable', 'Unable to load the team. Please retry.');
    const members = shapeMembers(result.data, ws.userId);
    // RLS returns nothing to non-members; treat that as no access rather than an empty team.
    if (!members.some(m => m.isYou)) return apiReply('no_workspace_access', 'Workspace access is unavailable.');
    return NextResponse.json({ signedIn: true, members }, { headers: privateHeaders });
  } catch { return apiReply('invalid_request', 'Invalid request.'); }
}
