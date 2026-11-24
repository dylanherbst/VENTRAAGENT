import { launcherKinds } from './launcher-drafts.ts';
import { kindHref, kindLabel } from './draft-registry.ts';

// Plain-text search over saved drafts. Pure: the caller supplies the draft data (from browser storage or from the account under RLS).
export const minQuery = 2;
export const maxQuery = 80;
export const maxHits = 50;
const maxStrings = 5000;
const snippetRadius = 40;

export type SearchSource = 'browser' | 'account';
export type SearchHit = { kind: string; label: string; href: string; snippet: string; sources: SearchSource[] };

/** Returns the search terms, or throws a message the owner can read. */
export function parseQuery(q: unknown): string[] {
  if (typeof q !== 'string') throw new Error('Type something to search for.');
  const t = q.trim().toLowerCase();
  if (t.length < minQuery) throw new Error(`Type at least ${minQuery} characters.`);
  if (t.length > maxQuery) throw new Error(`Search text must be ${maxQuery} characters or fewer.`);
  return t.split(/\s+/).filter(Boolean);
}

/** Every human-readable string in a draft. Ids and bookkeeping fields are skipped; the walk is bounded. */
export function draftStrings(data: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (out.length >= maxStrings || depth > 12) return;
    if (typeof v === 'string') { if (v.trim() && !/(^|[a-z])Ids?$|^id$|^version$|^profileId$/.test(key)) out.push(v); }
    else if (Array.isArray(v)) for (const x of v) walk(x, key, depth + 1);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(data, '', 0);
  return out;
}

function snippetFor(strings: string[], terms: string[]): string {
  const hit = strings.find(s => s.toLowerCase().includes(terms[0])) ?? strings.find(s => terms.some(t => s.toLowerCase().includes(t))) ?? '';
  const flat = hit.replace(/\s+/g, ' ');
  const at = Math.max(0, flat.toLowerCase().indexOf(terms[0]));
  const start = Math.max(0, at - snippetRadius);
  return (start > 0 ? '…' : '') + flat.slice(start, at + terms[0].length + snippetRadius) + (at + terms[0].length + snippetRadius < flat.length ? '…' : '');
}

/** One hit per draft kind whose text contains every term. Unknown kinds are ignored. Sorted by name for a stable order. */
export function searchDrafts(drafts: readonly { kind: string; data: unknown }[], terms: readonly string[], source: SearchSource): SearchHit[] {
  const hits: SearchHit[] = [];
  const t = terms.map(x => x.toLowerCase());
  if (!t.length) return hits;
  for (const d of drafts) {
    if (!(launcherKinds as readonly string[]).includes(d.kind)) continue;
    const strings = draftStrings(d.data);
    const all = strings.join('\n').toLowerCase();
    if (!t.every(x => all.includes(x))) continue;
    hits.push({ kind: d.kind, label: kindLabel(d.kind), href: kindHref(d.kind), snippet: snippetFor(strings, t), sources: [source] });
  }
  return hits.sort((a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind)).slice(0, maxHits);
}

/** Combines browser and account hits: a draft found in both lists both sources and keeps the account snippet. */
export function mergeHits(browser: readonly SearchHit[], account: readonly SearchHit[]): SearchHit[] {
  const by = new Map<string, SearchHit>();
  for (const h of [...browser, ...account]) {
    const prior = by.get(h.kind);
    by.set(h.kind, prior ? { ...h, sources: [...new Set([...prior.sources, ...h.sources])].sort() as SearchSource[] } : { ...h });
  }
  return [...by.values()].sort((a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind)).slice(0, maxHits);
}

/** Accepts only the exact shape the route returns. */
export function parseSearchResponse(body: unknown): SearchHit[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.signedIn !== true || !Array.isArray(b.hits)) return null;
  for (const h of b.hits) {
    if (!h || typeof h !== 'object') return null;
    const x = h as Record<string, unknown>;
    if (typeof x.kind !== 'string' || typeof x.label !== 'string' || typeof x.href !== 'string' || typeof x.snippet !== 'string' || !Array.isArray(x.sources)) return null;
  }
  return b.hits as SearchHit[];
}
