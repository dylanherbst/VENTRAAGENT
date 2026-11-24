import { NextRequest, NextResponse } from 'next/server';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders, requireMembership } from '../../../../lib/workspace-route';
import { ROW_LIMITS, computePerformance, parseRange, performanceLimit, readPaged, readPagedByIds } from '../../../../lib/front-office/performance';
import type { AppointmentRow, ContactRow, EventRow } from '../../../../lib/front-office/performance';
export const dynamic = 'force-dynamic';

const refuse = (failure: 'error' | 'too_large') => failure === 'too_large'
  ? apiReply('too_large', 'There are too many records in this range to count exactly. Choose a shorter range.')
  : apiReply('storage_unavailable', 'Unable to load your performance. Check that the database is up to date.');

// Lead-to-booking performance from stored records only. Signed-in workspace members only; reads run under the
// caller's own token, so RLS limits them to their workspace. Counts only: no names, numbers or message text.
//   GET /api/front-office/performance?workspace=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&tz=<IANA zone>
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your performance.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, performanceLimit);
  if (isResponse(ws)) return ws;
  const range = parseRange(req.nextUrl.searchParams);
  if ('error' in range) return apiReply('invalid_request', range.error);
  const denied = await requireMembership(ws, 'Unable to load your performance. Please retry.');
  if (denied) return denied;
  const w = ws.workspace;
  // Every read is paged (PostgREST returns at most max_rows per response) with a stable order. Events and bookings are
  // read only for the cohort's contacts, in id chunks, so older contacts never count towards the caps.
  const contacts = await readPaged<ContactRow>((from, to) => ws.db.from('fo_contacts').select('id,workspace_id,state,opted_out_at,created_at').eq('workspace_id', w)
    .gte('created_at', range.startsAt).lt('created_at', range.endsAt).order('created_at').order('id').range(from, to), ROW_LIMITS.contacts);
  if ('failure' in contacts) return refuse(contacts.failure);
  const ids = contacts.rows.filter(c => c.workspace_id === w).map(c => c.id);
  const [events, appointments] = await Promise.all([
    readPagedByIds<EventRow>(ids, (chunk, from, to) => ws.db.from('fo_events').select('contact_id,workspace_id,kind,to_state,detail,created_at').eq('workspace_id', w)
      .in('contact_id', chunk).in('kind', ['created', 'inbound', 'state']).order('id').range(from, to), ROW_LIMITS.events),
    readPagedByIds<AppointmentRow>(ids, (chunk, from, to) => ws.db.from('fo_appointments').select('contact_id,workspace_id,status,created_at').eq('workspace_id', w)
      .in('contact_id', chunk).order('id').range(from, to), ROW_LIMITS.appointments),
  ]);
  if ('failure' in events) return refuse(events.failure);
  if ('failure' in appointments) return refuse(appointments.failure);
  const performance = computePerformance({ workspaceId: w, range, now: Date.now(), contacts: contacts.rows, events: events.rows, appointments: appointments.rows });
  return NextResponse.json({ performance }, { headers: privateHeaders });
}
