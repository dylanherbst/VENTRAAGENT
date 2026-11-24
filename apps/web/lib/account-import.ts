import { checkedDraftRaw, launcherKinds, loadLauncherDraft, saveLauncherDraft } from './launcher-drafts.ts';
import type { LauncherKind, RemoteLauncherDraft } from './launcher-drafts.ts';
import type { CourseRequest } from './course-account.ts';
import { parseAccountExport } from './account-export.ts';
import { byteLength } from './byte-size.ts';

// Restore from a file made by "Download my data". Pure planning plus a sequential runner that uses the same revisioned save as every other draft.
// Rule: an account copy that is the same or newer than the file is never overwritten. Older copies are replaced only after the owner agrees.

export const importFileByteLimit = 5_000_000;
export type ImportStatus = 'new' | 'unchanged' | 'older-in-account' | 'newer-in-account';
/** `otherWorkspace` is true when the file was exported from a different workspace than the import target. It is false when no target is given. */
export type ImportItem = { kind: LauncherKind; fileRevision: number; accountRevision: number; status: ImportStatus; raw: string; otherWorkspace: boolean };
export type ImportRejected = { kind: string; reason: string };
export type ParsedImport = { exportedAt: string; workspaceId: string; items: { kind: LauncherKind; revision: number; raw: string }[]; rejected: ImportRejected[] };

/** Validates the file text. Throws a plain message when the whole file is unusable; bad single drafts are listed in `rejected`. */
export function parseImportFile(text: string): ParsedImport {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.');
  if (byteLength(text) > importFileByteLimit) throw new Error('The file is too large to be a VENTRA export.');
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  const file = parseAccountExport(json);
  if (!file) throw new Error('This is not a VENTRA data export (wrong format, version or item count).');
  if (file.drafts.length > launcherKinds.length) throw new Error('The file lists more items than VENTRA has.');
  const items: ParsedImport['items'] = [];
  const rejected: ImportRejected[] = [];
  const seen = new Set<string>();
  for (const d of file.drafts as unknown[]) {
    const o = d && typeof d === 'object' ? d as Record<string, unknown> : {};
    const kind = typeof o.kind === 'string' ? o.kind : '(unknown)';
    if (!(launcherKinds as readonly string[]).includes(kind)) { rejected.push({ kind, reason: 'Unknown item type, skipped.' }); continue; }
    if (seen.has(kind)) { rejected.push({ kind, reason: 'Listed twice in the file, skipped.' }); continue; }
    seen.add(kind);
    if (!Number.isSafeInteger(o.revision) || (o.revision as number) < 1) { rejected.push({ kind, reason: 'Missing or invalid revision, skipped.' }); continue; }
    let raw: string;
    try { raw = JSON.stringify(o.data); checkedDraftRaw(raw); } catch (e) { rejected.push({ kind, reason: (e instanceof Error ? e.message : 'Invalid data') + ' Skipped.' }); continue; }
    items.push({ kind: kind as LauncherKind, revision: o.revision as number, raw });
  }
  return { exportedAt: file.exportedAt, workspaceId: file.workspaceId, items, rejected };
}

const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const same = (a: string, b: string) => JSON.stringify(canonical(JSON.parse(a))) === JSON.stringify(canonical(JSON.parse(b)));

/** Compares each file item with what the account holds now. `account` maps kind to the current account copy (null or absent: none). */
export function planImport(parsed: ParsedImport, account: ReadonlyMap<LauncherKind, RemoteLauncherDraft | null>, targetWorkspaceId?: string): ImportItem[] {
  const otherWorkspace = !!targetWorkspaceId && parsed.workspaceId.toLowerCase() !== targetWorkspaceId.toLowerCase();
  return parsed.items.map(i => {
    const cur = account.get(i.kind) ?? null;
    const accountRevision = cur ? cur.revision : 0;
    const status: ImportStatus = !cur ? 'new' : same(cur.raw, i.raw) ? 'unchanged' : cur.revision < i.revision ? 'older-in-account' : 'newer-in-account';
    return { kind: i.kind, fileRevision: i.revision, accountRevision, status, raw: i.raw, otherWorkspace };
  });
}
export const isWritable = (i: ImportItem) => i.status === 'new' || i.status === 'older-in-account';

export type ImportOutcome = { kind: LauncherKind; result: 'saved' | 'skipped' | 'failed'; message: string };
export type ImportDeps = { save?: typeof saveLauncherDraft; request?: CourseRequest };

/** Saves the chosen items one at a time with the revision seen during planning. A revision conflict fails that item only; nothing is retried or forced. */
export async function runImport(workspace: string, plan: readonly ImportItem[], replaceOlder: boolean, deps: ImportDeps = {}): Promise<ImportOutcome[]> {
  const save = deps.save ?? saveLauncherDraft;
  const out: ImportOutcome[] = [];
  for (const i of plan) {
    if (i.status === 'unchanged') { out.push({ kind: i.kind, result: 'skipped', message: 'Already the same in your account.' }); continue; }
    if (i.status === 'newer-in-account') { out.push({ kind: i.kind, result: 'skipped', message: 'Your account has a newer version, so it was kept.' }); continue; }
    if (i.status === 'older-in-account' && !replaceOlder) { out.push({ kind: i.kind, result: 'skipped', message: 'Older version in your account was kept (replace not chosen).' }); continue; }
    try {
      const revision = await save(workspace, i.kind, i.raw, i.accountRevision, deps.request);
      out.push({ kind: i.kind, result: 'saved', message: `Saved at revision ${revision}.` });
    } catch (e) { out.push({ kind: i.kind, result: 'failed', message: e instanceof Error ? e.message : 'Save failed.' }); }
  }
  return out;
}

export async function loadAccountState(workspace: string, kinds: readonly LauncherKind[], request?: CourseRequest): Promise<Map<LauncherKind, RemoteLauncherDraft | null>> {
  const m = new Map<LauncherKind, RemoteLauncherDraft | null>();
  for (const k of kinds) m.set(k, await loadLauncherDraft(workspace, k, request));
  return m;
}
