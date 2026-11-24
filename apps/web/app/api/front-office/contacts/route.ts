import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { CONTACT_COLUMNS, collapseDuplicates, contactFromRow, contactsCursorFilter, emailSearchPattern, nameSearchPattern, nextContactsCursor, parseContactsQuery } from '../../../../lib/front-office/crm';
import type { ContactRow, ContactsQuery } from '../../../../lib/front-office/crm';
import type { Contact } from '../../../../lib/front-office/contracts';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(120, 60_000);

// One customer record (task A-9): the people of one business from fo_contacts, the record every agent and channel shares.
//   GET /api/front-office/contacts?workspace=<id>[&state=<ContactState>][&q=<name, email or phone>][&limit=1..200]
//       [&before=<createdAt>&beforeId=<id>]   -> { items: Contact[], next: { before, beforeId } | null }
// Signed-in members only. Reads run under the caller's own token, so RLS limits them to their workspace; the query also
// filters on the workspace. Newest first. A phone search accepts Australian local formats (0412 345 678); an email search
// is case-insensitive. Read only.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your customers.' });
  if (isResponse(pre)) return pre;
  let q: ContactsQuery;
  try { q = parseContactsQuery(req.nextUrl.searchParams); } catch (e) { return apiReply('invalid_request', e instanceof Error ? e.message : 'Invalid request.'); }
  const ws = await openWorkspace(req, pre.token, limiter);
  if (isResponse(ws)) return ws;
  const denied = await requireMembership(ws, 'Unable to load your customers. Please retry.');
  if (denied) return denied;
  let query = ws.db.from('fo_contacts').select(CONTACT_COLUMNS).eq('workspace_id', ws.workspace);
  if (q.state) query = query.eq('state', q.state);
  if (q.search?.column === 'name') query = query.ilike('name', nameSearchPattern(q.search.value));
  else if (q.search?.column === 'email') query = query.ilike('email', emailSearchPattern(q.search.value));
  else if (q.search) query = query.eq(q.search.column, q.search.value);
  if (q.before) query = query.or(contactsCursorFilter(q.before));
  const res = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(q.limit + 1);
  if (res.error) return apiReply('storage_unavailable', 'Unable to load your customers. Check that the database is up to date.');
  const rows = (res.data ?? []) as unknown as ContactRow[];
  const items = collapseDuplicates(rows.slice(0, q.limit).map(contactFromRow).filter((c): c is Contact => c !== null && c.workspaceId === ws.workspace));
  return NextResponse.json({ items, next: nextContactsCursor(rows, q.limit) }, { headers: privateHeaders });
}
