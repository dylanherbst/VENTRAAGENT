// Business-name similarity check (AMP-026). Pure and deterministic: no network, no provider, no clock.
// It only compares spellings. It is NOT a trademark or business-name search and NOT legal clearance, and it never says a name is free.
import { KNOWN_BRANDS } from './known-brands.ts';

export const CLASH_NOTICE = 'This is a simple similarity check, not a trademark or business-name search and not legal clearance. Check the official registers before you rely on a name.';

export type ClashLevel = 'none' | 'possible' | 'likely';
export type ClashKind = 'exact' | 'near' | 'same_words' | 'contains_brand';
export type ClashSource = 'known_brand' | 'same_set' | 'existing';
export interface ClashMatch { name: string; kind: ClashKind; source: ClashSource }
export interface NameClash {
  level: ClashLevel;
  /** At most MAX_MATCHES, strongest first. */
  matches: ClashMatch[];
  /** Plain English for a beginner. */
  message: string;
  /** Always CLASH_NOTICE. Show it next to the message. */
  notice: string;
}
export interface ClashDeps {
  /** Names that already exist elsewhere (other businesses in the workspace or platform, or a later register lookup). */
  existingNames?: readonly string[];
  /** Override the built-in illustrative brand list. */
  knownBrands?: readonly string[];
}

export const MAX_MATCHES = 3;
const DROP = new Set(['the', 'and','co', 'inc', 'llc', 'ltd', 'limited', 'pty', 'studio', 'shop', 'company', 'corp', 'store']);

/** Lower case words without diacritics, punctuation or common business endings. Falls back to all words if only endings were left. */
export function normaliseName(raw: string): string[] {
  const all = String(raw ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = all.filter((w) => !DROP.has(w));
  return kept.length ? kept : all;
}

/** Levenshtein distance; stops early once the distance must exceed `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Allowed edit distance for a compact name length: short names must match exactly so they do not flag everything. */
function allowance(len: number): number {
  return len < 5 ? 0 : len < 9 ? 1 : len < 16 ? 2 : 3;
}

const MAX_COMPARE = 64;
const MIN_NEAR = 6;
/** A one-edit near match to a known brand on a short compact name is too weak to call likely. */
const SOFT_NEAR_BELOW = 9;

type Compare ='exact' | 'near' | 'same_words' | null;
function compare(a: string[], b: string[]): Compare {
  if (!a.length || !b.length) return null;
  const ca = a.join(''), cb = b.join('');
  if (ca === cb) return 'exact';
  if (a.length > 1 && a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')) return 'same_words';
  // Bound the cost: very long names only ever match exactly. Short words only match exactly (a near match needs both at least 6 long).
  if (ca.length > MAX_COMPARE || cb.length > MAX_COMPARE || ca.length < MIN_NEAR || cb.length < MIN_NEAR) return null;
  const max = allowance(Math.max(ca.length, cb.length));
  if (max > 0 && editDistance(ca, cb, max) <= max) return 'near';
  return null;
}

/** True when the brand's words appear in the name as whole consecutive words. */
function containsPhrase(words: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length >= words.length) return false;
  for (let i = 0; i + phrase.length <= words.length; i++) if (phrase.every((p, k) => words[i + k] === p)) return true;
  return false;
}

const RANK: Record<ClashKind, number> = { exact: 0, same_words: 1, near: 2, contains_brand: 3 };
const SOURCE_RANK: Record<ClashSource, number> = { known_brand: 0, existing: 1, same_set: 2 };

function message(level: ClashLevel, top: ClashMatch | undefined): string {
  if (level === 'none' || !top) return 'This check found nothing similar.';
  if (top.source === 'same_set') return `This name is very close to another option, "${top.name}". Pick one of them so your names are easy to tell apart.`;
  if (level === 'possible' && top.kind === 'near') return `This name is similar to "${top.name}". Something with that name may already be in use.`;
  if (level === 'likely') return `This name is very close to "${top.name}". It may already be in use.`;
  return `This name includes "${top.name}". Something with that name may already be in use.`;
}

/** Compare one name with known brands, the other options in the same set and any existing names. `others` must not include `name` itself. */
export function checkNameClash(name: string, others: readonly string[] = [], deps: ClashDeps = {}): NameClash {
  const words = normaliseName(name);
  const found: ClashMatch[] = [];
  const soft = new WeakSet<ClashMatch>();
  const add = (list: readonly string[], source: ClashSource) => {
    for (const other of list) {
      if (typeof other !== 'string') continue;
      const ow = normaliseName(other);
      const kind: ClashKind | null = compare(words, ow) ?? (source === 'known_brand' && containsPhrase(words, ow) ? 'contains_brand' : null);
      if (kind) {
        const m: ClashMatch = { name: other.trim(), kind, source };
        if (kind === 'near' && source === 'known_brand' && Math.max(words.join('').length, ow.join('').length) < SOFT_NEAR_BELOW) soft.add(m);
        found.push(m);
      }
    }
  };
  add(deps.knownBrands ?? KNOWN_BRANDS, 'known_brand');
  add(deps.existingNames ?? [], 'existing');
  add(others, 'same_set');
  const seen = new Set<string>();
  const matches = found
    .map((m, i) => ({ m, i }))
    .sort((x, y) => SOURCE_RANK[x.m.source] - SOURCE_RANK[y.m.source] || RANK[x.m.kind] - RANK[y.m.kind] || x.i - y.i)
    .map(({ m }) => m)
    .filter((m) => { const k = `${m.source}|${m.name.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_MATCHES);
  // Likely: same spelling or words as a brand or existing name. A near spelling or a match inside the same set is only "possible", as is a brand word inside a longer name.
  const likely = matches.some((m) => m.source !== 'same_set' && (m.kind === 'exact' || m.kind === 'same_words' || (m.kind === 'near' && !soft.has(m))));
  const level: ClashLevel = !matches.length ? 'none' : likely ? 'likely' : 'possible';
  return { level, matches, message: message(level, matches[0]), notice: CLASH_NOTICE };
}

/** One result per name, in the same order. Each name is compared with the other names in the list too. */
export function checkNameClashes(names: readonly string[], deps: ClashDeps = {}): NameClash[] {
  return names.map((n, i) => checkNameClash(n, names.filter((_, j) => j !== i), deps));
}
