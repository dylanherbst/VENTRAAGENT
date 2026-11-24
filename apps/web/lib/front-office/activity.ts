// One activity feed (task A-9). fo_events is the single append-only history every agent writes: contact created, each
// inbound message (any channel), state changes, dispatches, handoffs, calls, bookings, opt-out and opt-in. The UI, the
// Setter and the Receptionist read the same rows through these helpers, so they never disagree about what happened.
//
// - activityFromRow: raw fo_events row -> ActivityEvent contract (contracts.ts). Unknown kinds are dropped; an agent
//   name the contract does not know reads as null.
// - parseActivityQuery / nextActivityCursor: newest first, keyset paging on the identity id (strictly increasing, so a
//   page boundary never skips or repeats an entry, even when several events share a timestamp).
// - describeActivity / activityDigest: one plain-English line per entry, for the UI and for an agent's context.
// No runtime dependencies besides contracts.ts.
import { activityKinds, agents, contactStates } from './contracts';
import type { ActivityEvent, ActivityKind, Agent, ContactState } from './contracts';

/** A raw fo_events row (PostgREST JSON). */
export type ActivityRow = { id: unknown; contact_id: unknown; kind: unknown; from_state?: unknown; to_state?: unknown; agent?: unknown; detail?: unknown; created_at: unknown };
/** Columns the activity route selects. workspace_id is filtered on, not returned. */
export const ACTIVITY_COLUMNS = 'id,contact_id,kind,from_state,to_state,agent,detail,created_at';
export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : null);

/** Maps one row to the ActivityEvent contract, or null when the row cannot be shown safely. */
export function activityFromRow(row: ActivityRow): ActivityEvent | null {
  const id = typeof row.id === 'string' && /^\d{1,15}$/.test(row.id) ? Number(row.id) : row.id;
  const kind = oneOf<ActivityKind>(activityKinds, row.kind);
  if (!Number.isSafeInteger(id) || (id as number) < 1 || !kind) return null;
  if (typeof row.contact_id !== 'string' || !UUID.test(row.contact_id)) return null;
  if (typeof row.created_at !== 'string' || row.created_at.length > 40 || !Number.isFinite(Date.parse(row.created_at))) return null;
  return {
    id: id as number,
    contactId: row.contact_id,
    kind,
    fromState: oneOf<ContactState>(contactStates, row.from_state),
    toState: oneOf<ContactState>(contactStates, row.to_state),
    agent: oneOf<Agent>(agents, row.agent),
    detail: typeof row.detail === 'string' && row.detail.length > 0 ? row.detail.slice(0, 500) : null,
    createdAt: row.created_at,
  };
}

/** Newest first. Ties (never expected: ids are unique) fall back to the time. */
export const sortActivity = (items: readonly ActivityEvent[]) => [...items].sort((a, b) => b.id - a.id || Date.parse(b.createdAt) - Date.parse(a.createdAt));

export type ActivityQuery = { contact: string | null; limit: number; before: number | null };
/** Reads ?contact=<id>&limit=1..200&before=<activity id>. Throws an Error with a plain-English message on bad input. */
export function parseActivityQuery(p: URLSearchParams): ActivityQuery {
  const c = p.get('contact');
  if (c !== null && !UUID.test(c)) throw new Error('Choose a valid contact.');
  const l = p.get('limit');
  const limit = l === null ? ACTIVITY_DEFAULT_LIMIT : Number(l);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_MAX_LIMIT) throw new Error(`Limit must be 1 to ${ACTIVITY_MAX_LIMIT}.`);
  const b = p.get('before');
  const before = b === null ? null : /^\d{1,15}$/.test(b) ? Number(b) : NaN;
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Before must be an activity id from a previous page.');
  return { contact: c ? c.toLowerCase() : null, limit, before };
}

/** The `before` value for the next page, from the raw rows fetched (limit + 1 asked for), or null on the last page.
 * Taken from the last raw row of this page, so a row that was not shown never ends paging early. */
export function nextActivityCursor(fetched: readonly ActivityRow[], limit: number): number | null {
  if (fetched.length <= limit) return null;
  const raw = fetched[limit - 1].id;
  const id = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(id) && (id as number) > 0 ? id as number : null;
}

const who = (a: Agent | null) => (a === null ? '' : a === 'human' ? 'a person' : `the ${a === 'receptionist' ? 'Receptionist' : a === 'setter' ? 'Setter' : a} agent`);
/** One plain-English line for an entry. Uses only stored fields; never invents detail. */
export function describeActivity(e: ActivityEvent): string {
  const d = e.detail ? `: ${e.detail}` : '';
  switch (e.kind) {
    case 'created': return `New contact${d}`;
    case 'inbound': return `Message received${e.detail ? ` (${e.detail})` : ''}`;
    case 'state': return `Moved ${e.fromState ?? '?'} to ${e.toState ?? '?'}${e.agent ? ` by ${who(e.agent)}` : ''}${d}`;
    case 'dispatch': return `Passed to ${who(e.agent) || 'nobody'}${d}`;
    case 'handoff': return `Handed to ${who(e.agent) || 'a person'}${d}`;
    case 'opt-out': return `Opted out${e.detail ? ` (${e.detail})` : ''}`;
    case 'opt-in': return `Opted back in${e.detail ? ` (${e.detail})` : ''}`;
    case 'call': return `Call${d}`;
    case 'booking': return `Booking${d}`;
    case 'message': return `Message${d}`;
  }
}

/** The latest entries of one contact as short lines, oldest first, for an agent's context (at most `max`). */
export function activityDigest(items: readonly ActivityEvent[], max = 20): string[] {
  return sortActivity(items).slice(0, Math.max(0, Math.min(max, ACTIVITY_MAX_LIMIT))).reverse().map(e => `${new Date(e.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC ${describeActivity(e)}`);
}
