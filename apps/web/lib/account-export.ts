import { launcherKinds } from './launcher-drafts.ts';

// Pure shaping for "download my data". Only known draft kinds are included and only these fields are exposed.
export type ExportRow = { kind: unknown; data: unknown; revision: unknown; updated_at: unknown };
export type ExportedDraft = { kind: string; revision: number; updatedAt: string | null; data: unknown };
export type AccountExport = { format: 'ventra-account-export'; version: 1; exportedAt: string; workspaceId: string; draftCount: number; drafts: ExportedDraft[] };

export function buildAccountExport(rows: unknown, workspaceId: string, exportedAt: string): AccountExport {
  const drafts: ExportedDraft[] = [];
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const { kind, data, revision, updated_at } = r as ExportRow;
      if (typeof kind !== 'string' || !(launcherKinds as readonly string[]).includes(kind)) continue;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0 || data === undefined) continue;
      drafts.push({ kind, revision: revision as number, updatedAt: typeof updated_at === 'string' ? updated_at : null, data });
    }
  }
  drafts.sort((a, b) => a.kind.localeCompare(b.kind));
  return { format: 'ventra-account-export', version: 1, exportedAt, workspaceId, draftCount: drafts.length, drafts };
}

export const exportFileName = (exportedAt: string) => `ventra-data-${exportedAt.slice(0, 10).replace(/[^0-9-]/g, '')}.json`;

/** Accepts only the exact shape the route returns. */
export function parseAccountExport(body: unknown): AccountExport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.format !== 'ventra-account-export' || b.version !== 1 || typeof b.exportedAt !== 'string' || typeof b.workspaceId !== 'string' || !Array.isArray(b.drafts) || b.draftCount !== b.drafts.length) return null;
  return body as AccountExport;
}
