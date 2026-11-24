// selectIdea / editSelection (AMP-013). One selected idea = one durable business record + one queued build job.
// Idempotency: the key is workspace + idea id, and the store must create the pair atomically under a unique key
// (the in-memory store does; a database store uses a unique constraint on the key). Selecting the same idea again,
// a double-click or a re-submit returns the existing record and never a second business or job.
import type { BusinessModel } from '../contracts.ts';
import type { PlanInputs } from '../blueprints/index.ts';
import { blueprintRegistry } from '../blueprints/index.ts';
import { buildPreview, resolveIdea, type PreviewDeps, type SelectionIssue, type SelectionPreview } from './preview.ts';

export interface SelectedBusiness {
  id: string; workspaceId: string; blueprintId: string;
  /** Major version of the blueprint, as the businesses table stores it. */
  blueprintVersion: number;
  niche: string; model: BusinessModel; status: 'draft'; createdAt: string;
}
export interface BuildJob { id: string; type: 'build_business'; status: 'queued'; businessId: string; idempotencyKey: string; createdAt: string }

export interface SelectionRecord {
  /** Idempotency key: select:<workspace>:<idea id>. */
  key: string;
  workspaceId: string;
  ideaId: string;
  business: SelectedBusiness;
  job: BuildJob;
  /** The chosen blueprint inputs; edits replace these on the same record. */
  inputs: PlanInputs;
  /** 1 when first saved; +1 for every saved edit. */
  revision: number;
  updatedAt: string;
}

/** Where selections are saved. Both methods must be atomic per key. */
export interface SelectionStore {
  readonly kind: 'memory' | 'browser' | 'database';
  /** Create the record only if the key is new; otherwise return the existing one with created=false. `make` runs only when creating. */
  createOnce(key: string, make: () => SelectionRecord): Promise<{ record: SelectionRecord; created: boolean }>;
  get(key: string): Promise<SelectionRecord | undefined>;
  /**
   * Apply `change` to the freshly read record atomically; undefined when the key does not exist.
   * If `change` throws, nothing is saved and the error propagates (a database store rolls the transaction back).
   */
  update(key: string, change: (current: SelectionRecord) => SelectionRecord): Promise<SelectionRecord | undefined>;
  /** Records of one workspace only; other workspaces are never returned. */
  list(workspaceId: string): Promise<SelectionRecord[]>;
}

export interface SelectDeps extends PreviewDeps {
  store: SelectionStore;
  /** Injected clock (ISO strings). */
  now: () => Date;
  /** Injected id source; defaults to crypto.randomUUID(). */
  newId?: () => string;
}

export type SelectResult =
  | { ok: true; created: boolean; selection: SelectionRecord; preview: SelectionPreview }
  | { ok: false; errors: SelectionIssue[] };

const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function selectionKey(workspaceId: string, ideaId: string): string { return `select:${workspaceId}:${ideaId}`; }

function workspaceIssue(workspaceId: unknown): SelectionIssue | null {
  return typeof workspaceId === 'string' && WORKSPACE.test(workspaceId) ? null : { field: 'workspaceId', message: 'A workspace is needed to save a selection.' };
}
function isoNow(now: () => Date): string {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('now must return a valid Date');
  return d.toISOString();
}

/** Select one idea. Safe to call any number of times for the same idea: the first call creates, later calls return it. */
export async function selectIdea(workspaceId: string, idea: unknown, inputs: Record<string, unknown> | undefined, deps: SelectDeps): Promise<SelectResult> {
  const w = workspaceIssue(workspaceId);
  if (w) return { ok: false, errors: [w] };
  const found = resolveIdea(idea, deps.registry);
  if (!found.ok) return found;
  const key = selectionKey(workspaceId, found.ideaId);
  // A repeat selection returns the existing record before the inputs are looked at: re-submitting must never fail or change it.
  const existing = await deps.store.get(key);
  if (existing) {
    const shownExisting = rebuild(idea, existing, deps);
    if (shownExisting) return { ok: true, created: false, selection: existing, preview: shownExisting };
  }
  const built = buildPreview(idea, inputs, deps);
  if (!built.ok) return built;
  const preview = built.preview;
  const at = isoNow(deps.now);
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  const major = Number.parseInt(found.blueprint.version.split('.')[0] ?? '1', 10);

  const { record, created } = await deps.store.createOnce(key, () => {
    const businessId = newId();
    return {
      key, workspaceId, ideaId: found.ideaId,
      business: { id: businessId, workspaceId, blueprintId: found.blueprint.id, blueprintVersion: major, niche: String(preview.inputs.niche), model: found.blueprint.businessModel, status: 'draft' as const, createdAt: at },
      job: { id: newId(), type: 'build_business' as const, status: 'queued' as const, businessId, idempotencyKey: key, createdAt: at },
      inputs: { ...preview.inputs }, revision: 1, updatedAt: at,
    };
  });
  // For a repeat selection show the saved inputs, not the ones passed this time.
  const shown = created ? preview : rebuild(idea, record, deps) ?? preview;
  return { ok: true, created, selection: record, preview: shown };
}

function rebuild(idea: unknown, record: SelectionRecord, deps: PreviewDeps): SelectionPreview | undefined {
  const r = buildPreview(idea, record.inputs, deps);
  return r.ok ? r.preview : undefined;
}

export type EditResult = { ok: true; selection: SelectionRecord; preview: SelectionPreview } | { ok: false; errors: SelectionIssue[] };

/**
 * Edit the chosen blueprint inputs on the saved record (partial edits are merged over the saved inputs).
 * Edits never create a second business or job; they bump the revision and update the business niche.
 */
class EditRejected extends Error {
  readonly issues: SelectionIssue[];
  constructor(issues: SelectionIssue[]) { super(issues.map((i) => i.message).join(' ')); this.issues = issues; }
}

/**
 * The merge and validation happen inside the store's atomic update, on the freshly read record, so two edits cannot
 * overwrite each other from a stale read. Pass `expectedRevision` (the revision the owner was looking at) to refuse an
 * edit when someone else saved in between.
 */
export async function editSelection(workspaceId: string, idea: unknown, edits: Record<string, unknown>, deps: SelectDeps, opts: { expectedRevision?: number } = {}): Promise<EditResult> {
  const w = workspaceIssue(workspaceId);
  if (w) return { ok: false, errors: [w] };
  const found = resolveIdea(idea, deps.registry);
  if (!found.ok) return found;
  const key = selectionKey(workspaceId, found.ideaId);
  const at = isoNow(deps.now);
  let preview: SelectionPreview | undefined;
  let saved: SelectionRecord | undefined;
  try {
    saved = await deps.store.update(key, (cur) => {
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== cur.revision) {
        throw new EditRejected([{ field: 'revision', message: `These details changed since you opened them (now revision ${cur.revision}, you had ${opts.expectedRevision}). Reload and try again.` }]);
      }
      const built = buildPreview(idea, { ...cur.inputs, ...edits }, deps);
      if (!built.ok) throw new EditRejected(built.errors);
      preview = built.preview;
      return { ...cur, inputs: { ...built.preview.inputs }, business: { ...cur.business, niche: String(built.preview.inputs.niche) }, revision: cur.revision + 1, updatedAt: at };
    });
  } catch (e) {
    if (e instanceof EditRejected) return { ok: false, errors: e.issues };
    throw e;
  }
  if (!saved) return { ok: false, errors: [{ field: 'idea', message: 'This idea has not been selected yet. Select it first, then edit.' }] };
  return { ok: true, selection: saved, preview: preview as SelectionPreview };
}

/** Read a saved selection for an idea, with the preview rebuilt from its saved inputs. */
export async function loadSelection(workspaceId: string, idea: unknown, deps: SelectDeps): Promise<{ selection: SelectionRecord; preview: SelectionPreview } | undefined> {
  if (workspaceIssue(workspaceId)) return undefined;
  const found = resolveIdea(idea, deps.registry ?? blueprintRegistry);
  if (!found.ok) return undefined;
  const selection = await deps.store.get(selectionKey(workspaceId, found.ideaId));
  if (!selection) return undefined;
  const preview = rebuild(idea, selection, deps);
  return preview ? { selection, preview } : undefined;
}
