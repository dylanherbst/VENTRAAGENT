// One customer record (task A-9): fo_contacts is the source of truth for every person the front office talks to.
//
// - readPhone / normalisePhone / normaliseEmail: the one way a phone (E.164, Australian local formats accepted, AU numbers
//   checked against real mobile and area-code shapes, 13/1300/1800 refused) or an email (trimmed,
//   lower case) is turned into the key fo_contacts is unique on. Every writer should pass values through these first,
//   so the same person on chat, SMS, email and calls lands on one row (the database enforces uniqueness per workspace).
// - contactFromRow: maps a raw fo_contacts row to the shared Contact contract (contracts.ts); rows that do not validate
//   are dropped, never passed to the UI half-formed.
// - collapseDuplicates: read-side guard. Rows of one workspace that share a normalised phone or email (legacy rows written
//   before normalisation) are shown once: the oldest row wins and fills its empty fields from the others.
// - planLocalImport: the browser-only CRM (lib/local-crm-contacts.ts) is a migration source only. This works out, without
//   writing anything, which local contacts match an existing fo_contacts row and which would be new.
// No runtime dependencies besides contracts.ts, so it loads in routes, tests and the browser.
import { contactStates, parseContact } from './contracts';
import type { Contact, ContactSource, ContactState } from './contracts';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The result of reading a phone number: E.164, or a plain-English reason it was refused. */
export type PhoneReading = { ok: true; phone: string } | { ok: false; reason: string };

const PHONE_UNREADABLE = 'Enter a mobile like 0412 345 678 or a number with its country code, like +44 20 7946 0958.';
// Australian service numbers (13 xx xx, 1300, 1800) are REFUSED as a contact's phone (decision A-31):
// - they are not reachable from outside Australia, so there is no true E.164 form to store (+61 1300... does not dial);
// - they cannot receive SMS, so the Setter's texts and confirmations would never arrive;
// - many people share one (every caller from a company switchboard), so keying contacts on it would put different
//   people on one record, which the one-record-per-phone rule must never do.
// A business's own inbound 1300/1800 line is a channel number (fo_channels), not a contact phone, and is not read here.
const PHONE_SERVICE_NUMBER = 'That is a 13, 1300 or 1800 business number, which cannot get texts. Ask for a mobile or a direct number.';
const PHONE_NOT_AU = 'That is not a valid Australian number. Mobiles start 04 and have 10 digits; landlines start 02, 03, 07 or 08.';

/** Reads a phone number. Australian local formats are accepted: 0412 345 678, (02) 9876 5432, 61 412 345 678,
 * 0061 412 345 678, +61 (0) 412 345 678, 412 345 678. Numbers from other countries must start with + or 00.
 * An Australian number (+61) must be a mobile (+614 then 8 digits) or a landline with area code 2, 3, 7 or 8
 * (then 8 digits); anything else under +61 (0000000000, 0112345678, 05..., 13/1300/1800) is refused with a reason. */
export function readPhone(raw: unknown): PhoneReading {
  const no = (reason: string): PhoneReading => ({ ok: false, reason });
  if (typeof raw !== 'string' || raw.length > 40) return no(PHONE_UNREADABLE);
  const t = raw.trim();
  if (!t || !/^[\d\s()+\-.]+$/.test(t)) return no(PHONE_UNREADABLE);
  const plus = t.startsWith('+');
  if (t.slice(1).includes('+')) return no(PHONE_UNREADABLE);
  const d = t.replace(/\(0\)/g, '').replace(/\D/g, '');
  // Service numbers written locally: 13 12 34, 1300 123 456, 1800 123 456 (also after 61 / 0061 / +61).
  const local = plus ? (d.startsWith('61') ? d.slice(2) : null) : d.startsWith('0061') ? d.slice(4) : d.startsWith('61') && d.length !== 11 ? d.slice(2) : d;
  if (local !== null && /^0?1(3\d{4}|[38]00\d{6})$/.test(local)) return no(PHONE_SERVICE_NUMBER);
  let out: string;
  if (plus) out = '+' + d;
  else if (d.startsWith('00')) out = '+' + d.slice(2);
  else if (d.startsWith('61') && d.length === 11) out = '+' + d;
  else if (d.startsWith('0') && d.length === 10) out = '+61' + d.slice(1);
  else if (/^\d{9}$/.test(d)) out = '+61' + d;
  else return no(PHONE_UNREADABLE);
  // An Australian number written with its trunk 0 after the country code (+61 0412...) drops the 0.
  if (out.startsWith('+610') && out.length === 13) out = '+61' + out.slice(4);
  if (!E164.test(out)) return no(PHONE_UNREADABLE);
  if (out.startsWith('+61')) {
    const nsn = out.slice(3);
    if (/^1(3\d{4}|[38]00\d{6})$/.test(nsn)) return no(PHONE_SERVICE_NUMBER);
    // Mobile: 4 then exactly 8 digits. Landline: area code 2 (NSW/ACT), 3 (VIC/TAS), 7 (QLD), 8 (SA/WA/NT), then 8 digits.
    if (!/^[2-478]\d{8}$/.test(nsn)) return no(PHONE_NOT_AU);
  }
  return { ok: true, phone: out };
}

/** A phone number as E.164, or null when it cannot be read safely (see readPhone for the rules and the reason). */
export function normalisePhone(raw: unknown): string | null {
  const r = readPhone(raw);
  return r.ok ? r.phone : null;
}

/** An email trimmed and lower-cased, or null when it is not a usable address. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length > 0 && e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** The identity keys of one person: normalised phone, email, website visitor, Instagram and Messenger ids. */
export function contactKeys(c: { phone?: string | null; email?: string | null; webVisitor?: string | null; instagramId?: string | null; messengerId?: string | null }): string[] {
  const keys: string[] = [];
  const p = normalisePhone(c.phone), e = normaliseEmail(c.email);
  if (p) keys.push('phone:' + p);
  if (e) keys.push('email:' + e);
  if (c.webVisitor) keys.push('visitor:' + c.webVisitor);
  if (c.instagramId) keys.push('instagram:' + c.instagramId);
  if (c.messengerId) keys.push('messenger:' + c.messengerId);
  return keys;
}

/** A raw fo_contacts row (PostgREST JSON). */
export type ContactRow = {
  id: unknown; workspace_id: unknown; name?: unknown; phone?: unknown; email?: unknown; web_visitor?: unknown; instagram_id?: unknown;
  messenger_id?: unknown; state: unknown; source: unknown; opted_out_at?: unknown; answers?: unknown; created_at: unknown; updated_at: unknown;
};
/** Columns the contacts route selects (never anything internal). */
export const CONTACT_COLUMNS = 'id,workspace_id,name,phone,email,web_visitor,instagram_id,messenger_id,state,source,opted_out_at,answers,created_at,updated_at';

const textOrNull = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
function cleanAnswers(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, a] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
    if (k.length < 1 || k.length > 80 || k === '__proto__') continue;
    if (typeof a === 'string') out[k] = a.slice(0, 1000);
    else if (typeof a === 'number' || typeof a === 'boolean') out[k] = String(a);
  }
  return out;
}

/** Maps one row to the Contact contract. Returns null for a row that does not validate (it is skipped, not repaired). */
export function contactFromRow(row: ContactRow): Contact | null {
  const optedOutAt = textOrNull(row.opted_out_at);
  const r = parseContact({
    id: row.id, workspaceId: row.workspace_id, name: textOrNull(row.name),
    // A stored email that is not a usable address fails validation below and the row is skipped.
    phone: textOrNull(row.phone), email: textOrNull(row.email) === null ? null : normaliseEmail(row.email) ?? row.email,
    webVisitor: textOrNull(row.web_visitor), instagramId: textOrNull(row.instagram_id), messengerId: textOrNull(row.messenger_id),
    state: row.state, source: row.source, optedOut: optedOutAt !== null, optedOutAt,
    answers: cleanAnswers(row.answers), createdAt: row.created_at, updatedAt: row.updated_at,
  });
  return r.ok ? r.value : null;
}

/** Shows each person once. Contacts of one workspace that share any identity key are one person: the oldest record is
 * kept (its id is what agents use) and fills empty fields from the newer ones. Order of first appearance is kept. */
export function collapseDuplicates(contacts: readonly Contact[]): Contact[] {
  const parent = contacts.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const owner = new Map<string, number>();
  contacts.forEach((c, i) => {
    for (const k of contactKeys(c)) {
      const key = c.workspaceId + '|' + k;
      const j = owner.get(key);
      if (j === undefined) owner.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, Contact[]>();
  contacts.forEach((c, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), c]); });
  const firstIndex = new Map<number, number>();
  contacts.forEach((_, i) => { const g = find(i); if (!firstIndex.has(g)) firstIndex.set(g, i); });
  return [...groups.entries()].sort((a, b) => firstIndex.get(a[0])! - firstIndex.get(b[0])!).map(([, members]) => {
    if (members.length === 1) return members[0];
    const sorted = [...members].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    const keep = { ...sorted[0], answers: { ...sorted[0].answers } };
    for (const o of sorted.slice(1)) {
      keep.name ??= o.name; keep.phone ??= o.phone; keep.email ??= o.email; keep.webVisitor ??= o.webVisitor;
      keep.instagramId ??= o.instagramId; keep.messengerId ??= o.messengerId;
      for (const [k, v] of Object.entries(o.answers)) if (!(k in keep.answers)) keep.answers[k] = v;
      // Opted out anywhere means opted out: never message a person who said stop on another record.
      if (o.optedOutAt && !keep.optedOutAt) { keep.optedOut = true; keep.optedOutAt = o.optedOutAt; }
      if (Date.parse(o.updatedAt) > Date.parse(keep.updatedAt)) keep.updatedAt = o.updatedAt;
    }
    return keep;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Contacts list query (GET /api/front-office/contacts)
// ---------------------------------------------------------------------------------------------------------------------

export type ContactsQuery = {
  state: ContactState | null;
  /** What to search: an exact phone or email when q reads as one, otherwise part of the name. */
  search: { column: 'phone' | 'email'; value: string } | { column: 'name'; value: string } | null;
  limit: number;
  /** Keyset cursor: items strictly older than (createdAt, id). */
  before: { createdAt: string; id: string } | null;
};
export const CONTACTS_DEFAULT_LIMIT = 50;
export const CONTACTS_MAX_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const NAME_SEARCH = /^[\p{L}\p{N} '.-]{1,80}$/u;

/** Reads the query string. Throws an Error with a plain-English message on bad input. */
export function parseContactsQuery(p: URLSearchParams): ContactsQuery {
  const s = p.get('state');
  if (s !== null && !(contactStates as readonly string[]).includes(s)) throw new Error('Unknown state.');
  const l = p.get('limit');
  const limit = l === null ? CONTACTS_DEFAULT_LIMIT : Number(l);
  if (!Number.isInteger(limit) || limit < 1 || limit > CONTACTS_MAX_LIMIT) throw new Error(`Limit must be 1 to ${CONTACTS_MAX_LIMIT}.`);
  const b = p.get('before'), bid = p.get('beforeId');
  let before: ContactsQuery['before'] = null;
  if (b !== null || bid !== null) {
    if (b === null || b.length > 40 || !ISO.test(b) || !Number.isFinite(Date.parse(b))) throw new Error('Before must be a date and time from a previous page.');
    if (bid === null || !UUID.test(bid)) throw new Error('Before id must be an id from a previous page.');
    before = { createdAt: b, id: bid.toLowerCase() };
  }
  const q = p.get('q')?.trim() ?? '';
  let search: ContactsQuery['search'] = null;
  if (q) {
    if (q.length > 80) throw new Error('Search must be at most 80 characters.');
    const email = q.includes('@') ? normaliseEmail(q) : null;
    const phone = !email && /^[\d\s()+\-.]+$/.test(q) ? normalisePhone(q) : null;
    if (q.includes('@') && !email) throw new Error('Enter a full email address to search by email.');
    if (email) search = { column: 'email', value: email };
    else if (phone) search = { column: 'phone', value: phone };
    else if (NAME_SEARCH.test(q)) search = { column: 'name', value: q };
    else throw new Error('Search by name, a full email or a phone number.');
  }
  return { state: s as ContactState | null, search, limit, before };
}
/** PostgREST ilike pattern for a name search; the query was already limited to letters, digits, space and ' . - */
export const nameSearchPattern = (value: string) => `*${value}*`;
/** PostgREST ilike pattern for an exact, case-insensitive email search, so legacy rows stored before normalisation
 * (Sam@Example.COM) are still found by sam@example.com. The value is normalised (lower case) and LIKE's own wildcards
 * are escaped: \ % _ match themselves. PostgREST turns * into %, and has no escape for it, so a * in an address (legal,
 * very rare) becomes _ (any one character): the search may also show an address differing only at that position.
 * Use with .ilike('email', emailSearchPattern(value)) instead of .eq('email', value). */
export const emailSearchPattern = (value: string) => value.replace(/[\\%_]/g, c => '\\' + c).replace(/\*/g, '_');
/** PostgREST `or` filter for the keyset cursor. Values were validated by parseContactsQuery. */
export const contactsCursorFilter = (b: NonNullable<ContactsQuery['before']>) => `created_at.lt."${b.createdAt}",and(created_at.eq."${b.createdAt}",id.lt.${b.id})`;
/** The cursor for the next page, from the raw rows fetched (limit + 1 asked for; null when this was the last page).
 * Taken from the last raw row of this page, before collapsing, so no row is skipped or repeated. */
export function nextContactsCursor(fetched: readonly { id: unknown; created_at: unknown }[], limit: number): { before: string; beforeId: string } | null {
  if (fetched.length <= limit) return null;
  const last = fetched[limit - 1];
  return typeof last.created_at === 'string' && typeof last.id === 'string' ? { before: last.created_at, beforeId: last.id } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Browser CRM migration source (read only)
// ---------------------------------------------------------------------------------------------------------------------

/** The fields of a browser CRM contact (lib/local-crm-contacts.ts Contact) this plan reads. */
export type LocalCrmContact = { id: string; name: string; email: string; phone: string; consentStatus?: string };
export type LocalImportStep =
  | { action: 'match'; localId: string; contactId: string; matchedOn: 'phone' | 'email' }
  | { action: 'create'; localId: string; name: string | null; phone: string | null; email: string | null; optedOut: boolean }
  | { action: 'same-as'; localId: string; sameAsLocalId: string }
  | { action: 'skip'; localId: string; reason: string };

/** Which browser CRM contacts are already in fo_contacts (by normalised phone, then email) and which would be new.
 * Two local contacts for one person become one 'create' plus 'same-as'. Writes nothing. */
export function planLocalImport(local: readonly LocalCrmContact[], existing: readonly Pick<Contact, 'id' | 'phone' | 'email'>[]): LocalImportStep[] {
  const byKey = new Map<string, string>();
  for (const c of existing) for (const k of contactKeys(c)) byKey.set(k, c.id);
  const seen = new Map<string, string>();
  return local.slice(0, 5000).map((l): LocalImportStep => {
    const reading = readPhone(l.phone);
    const phone = reading.ok ? reading.phone : null, email = normaliseEmail(l.email);
    if (!phone && !email) {
      // A 13/1300/1800 number says why it cannot be used, so the owner knows to ask for a mobile.
      const reason = !reading.ok && reading.reason === PHONE_SERVICE_NUMBER ? reading.reason : 'No usable phone or email.';
      return { action: 'skip', localId: l.id, reason };
    }
    if (phone && byKey.has('phone:' + phone)) return { action: 'match', localId: l.id, contactId: byKey.get('phone:' + phone)!, matchedOn: 'phone' };
    if (email && byKey.has('email:' + email)) return { action: 'match', localId: l.id, contactId: byKey.get('email:' + email)!, matchedOn: 'email' };
    const prior = (phone && seen.get('phone:' + phone)) || (email && seen.get('email:' + email));
    if (prior) return { action: 'same-as', localId: l.id, sameAsLocalId: prior };
    if (phone) seen.set('phone:' + phone, l.id);
    if (email) seen.set('email:' + email, l.id);
    const name = l.name.trim().slice(0, 160) || null;
    return { action: 'create', localId: l.id, name, phone, email, optedOut: l.consentStatus === 'opted_out' };
  });
}

/** fo_contacts.source for a contact created from the browser CRM. */
export const LOCAL_IMPORT_SOURCE: ContactSource = 'import';
