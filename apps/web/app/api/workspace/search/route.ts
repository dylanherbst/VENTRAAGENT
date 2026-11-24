import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { byteLength, responseByteCaps } from '../../../../lib/byte-size';
import { parseQuery, searchDrafts } from '../../../../lib/draft-search';
export const dynamic = 'force-dynamic';
// Read-only search of the signed-in user's saved drafts. Authorisation is the launcher_drafts read policy (RLS) under the caller's own lp-access token; no service key, no writes. Only short snippets are returned, never whole drafts.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to search your account.' });
  if (isResponse(pre)) return pre;
  let terms: string[];
  try { terms = parseQuery(req.nextUrl.searchParams.get('q')); } catch (error) { return apiReply('invalid_request', error instanceof Error ? error.message : 'Invalid search.'); }
  const ws = await openWorkspace(req, pre.token, workspaceLimits.search);
  if (isResponse(ws)) return ws;
  try {
    const result = await ws.db.from('launcher_drafts').select('kind,data').eq('workspace_id', ws.workspace).limit(500);
    if (result.error) return apiReply('storage_unavailable', 'Unable to search your data. Please retry.');
    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) { const denied = await requireMembership(ws, 'Unable to search your data. Please retry.'); if (denied) return denied; }
    const out = { signedIn: true, hits: searchDrafts(rows.map(r => ({ kind: String((r as { kind: unknown }).kind), data: (r as { data: unknown }).data })), terms, 'account') };
    if (byteLength(JSON.stringify(out)) > responseByteCaps.search) return apiReply('too_large', 'Too many results. Try a more specific search.');
    return NextResponse.json(out, { headers: privateHeaders });
  } catch { return apiReply('invalid_request', 'Invalid request.'); }
}
