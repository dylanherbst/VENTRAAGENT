import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { byteLength, responseByteCaps } from '../../../../lib/byte-size';
import { buildAccountExport, exportFileName } from '../../../../lib/account-export';
export const dynamic = 'force-dynamic';
// Read-only download of the signed-in user's saved drafts. Authorisation is the database launcher_drafts read policy (RLS) using the caller's own lp-access token; no service key, no writes.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to download your data.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.export);
  if (isResponse(ws)) return ws;
  try {
    const result = await ws.db.from('launcher_drafts').select('kind,data,revision,updated_at').eq('workspace_id', ws.workspace).limit(500);
    if (result.error) return apiReply('storage_unavailable', 'Unable to load your data. Please retry.');
    const exportedAt = new Date().toISOString();
    const body = buildAccountExport(result.data, ws.workspace, exportedAt);
    // RLS returns nothing to non-members; with no drafts we cannot tell, so confirm membership before returning an empty file.
    if (!body.draftCount) { const denied = await requireMembership(ws, 'Unable to load your data. Please retry.'); if (denied) return denied; }
    const text = JSON.stringify(body, null, 2);
    if (byteLength(text) > responseByteCaps.export) return apiReply('too_large', 'Your data is too large to download in one file.');
    return new NextResponse(text, { status: 200, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${exportFileName(exportedAt)}"` } });
  } catch { return apiReply('invalid_request', 'Invalid request.'); }
}
