import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { ACTIVITY_COLUMNS, activityFromRow, nextActivityCursor, parseActivityQuery } from '../../../../lib/front-office/activity';
import type { ActivityQuery, ActivityRow } from '../../../../lib/front-office/activity';
import type { ActivityEvent } from '../../../../lib/front-office/contracts';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(120, 60_000);

// One activity feed (task A-9): fo_events, the history every agent and channel writes, for one contact or the whole business.
//   GET /api/front-office/activity?workspace=<id>[&contact=<id>][&limit=1..200][&before=<activity id>]
//       -> { items: ActivityEvent[], next: number | null }   newest first; pass `next` as `before` for the next page.
// Signed-in members only; reads run under the caller's own token (RLS) and also filter on the workspace. A contact of
// another business returns an empty list, exactly like an unknown id. Read only.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see recent activity.' });
  if (isResponse(pre)) return pre;
  let q: ActivityQuery;
  try { q = parseActivityQuery(req.nextUrl.searchParams); } catch (e) { return apiReply('invalid_request', e instanceof Error ? e.message : 'Invalid request.'); }
  const ws = await openWorkspace(req, pre.token, limiter);
  if (isResponse(ws)) return ws;
  const denied = await requireMembership(ws, 'Unable to load recent activity. Please retry.');
  if (denied) return denied;
  let query = ws.db.from('fo_events').select(ACTIVITY_COLUMNS).eq('workspace_id', ws.workspace);
  if (q.contact) query = query.eq('contact_id', q.contact);
  if (q.before !== null) query = query.lt('id', q.before);
  const res = await query.order('id', { ascending: false }).limit(q.limit + 1);
  if (res.error) return apiReply('storage_unavailable', 'Unable to load recent activity. Check that the database is up to date.');
  const rows = (res.data ?? []) as unknown as ActivityRow[];
  const items = rows.slice(0, q.limit).map(activityFromRow).filter((e): e is ActivityEvent => e !== null);
  return NextResponse.json({ items, next: nextActivityCursor(rows, q.limit) }, { headers: privateHeaders });
}
