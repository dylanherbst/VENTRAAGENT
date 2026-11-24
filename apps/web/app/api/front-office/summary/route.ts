import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { summarise } from '../../../../lib/front-office/summary';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
/** Accepts an IANA zone the runtime knows; anything else falls back to Australian eastern time. */
export function timeZoneOf(value: string | null): string {
  if (!value || value.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return 'Australia/Sydney';
  try { new Intl.DateTimeFormat('en-AU', { timeZone: value }); return value; } catch { return 'Australia/Sydney'; }
}

// Read-only counts for the app's Home, Customers and Money screens. Signed-in workspace members only; reads run under
// the caller's own token, so RLS limits them to their workspace. No message bodies, names or numbers are returned.
//   GET /api/front-office/summary?workspace=<id>&tz=<IANA zone>
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your live numbers.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.summary);
  if (isResponse(ws)) return ws;
  const denied = await requireMembership(ws, 'Unable to load your numbers. Please retry.');
  if (denied) return denied;
  const now = Date.now();
  const week = new Date(now - 7 * DAY).toISOString(), month = new Date(now - 30 * DAY).toISOString();
  const w = ws.workspace;
  const [contacts, appointments, calls, handoffs, messages, outbox] = await Promise.all([
    ws.db.from('fo_contacts').select('state,created_at,opted_out_at').eq('workspace_id', w).limit(5000),
    ws.db.from('fo_appointments').select('starts_at,status').eq('workspace_id', w).gte('starts_at', month).limit(2000),
    ws.db.from('fo_calls').select('started_at,outcomes').eq('workspace_id', w).gte('started_at', week).limit(2000),
    ws.db.from('fo_handoffs').select('owner,created_at').eq('workspace_id', w).gte('created_at', week).limit(2000),
    ws.db.from('fo_messages').select('contact_id,direction,created_at').eq('workspace_id', w).eq('direction', 'inbound').gte('created_at', week).limit(5000),
    ws.db.from('fo_outbox').select('id', { count: 'exact', head: true }).eq('workspace_id', w).eq('status', 'queued'),
  ]);
  // Calls and the approval queue arrive in later migrations; treat a missing table as "nothing yet" rather than failing Home.
  if (contacts.error || appointments.error || handoffs.error || messages.error) return apiReply('storage_unavailable', 'Unable to load your numbers. Check that the database is up to date.');
  const summary = summarise({
    now, timeZone: timeZoneOf(req.nextUrl.searchParams.get('tz')),
    contacts: contacts.data ?? [], appointments: appointments.data ?? [], calls: calls.error ? [] : calls.data ?? [],
    handoffs: handoffs.data ?? [], messages: messages.data ?? [], queuedApprovals: outbox.error ? 0 : outbox.count ?? 0,
  });
  return NextResponse.json({ summary, partial: !!(calls.error || outbox.error) }, { headers: privateHeaders });
}
