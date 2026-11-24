import { launcherKinds } from './launcher-drafts.ts';
import { kindHref, kindLabel } from './draft-registry.ts';

// What was saved to the account and when. Only the kind, revision and time are exposed; draft content never leaves the database here.
export type ActivityRow = { kind: unknown; revision: unknown; updated_at: unknown };
export type ActivityEntry = { kind: string; label: string; href: string; revision: number; updatedAt: string | null };

export function shapeActivity(rows: unknown): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const { kind, revision, updated_at } = r as ActivityRow;
    if (typeof kind !== 'string' || !(launcherKinds as readonly string[]).includes(kind)) continue;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) continue;
    const when = typeof updated_at === 'string' && !Number.isNaN(Date.parse(updated_at)) ? updated_at : null;
    out.push({ kind, label: kindLabel(kind), href: kindHref(kind), revision: revision as number, updatedAt: when });
  }
  // Newest first; entries with no time go last; ties by kind so the order is stable.
  return out.sort((a, b) => (a.updatedAt === null ? 1 : 0) - (b.updatedAt === null ? 1 : 0) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.kind.localeCompare(b.kind));
}

/** Accepts only the exact shape the route returns. */
export function parseActivityResponse(body: unknown): ActivityEntry[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.signedIn !== true || !Array.isArray(b.entries)) return null;
  for (const e of b.entries) {
    if (!e || typeof e !== 'object') return null;
    const x = e as Record<string, unknown>;
    if (typeof x.kind !== 'string' || typeof x.label !== 'string' || typeof x.href !== 'string' || !Number.isSafeInteger(x.revision) || (x.updatedAt !== null && typeof x.updatedAt !== 'string')) return null;
  }
  return b.entries as ActivityEntry[];
}

/** Plain wording for one timeline line. Revision 1 is the first save; later ones are updates. */
export const describeEntry = (e: ActivityEntry): string => `${e.label}: ${e.revision <= 1 ? 'first saved' : `updated (save number ${e.revision})`}`;
