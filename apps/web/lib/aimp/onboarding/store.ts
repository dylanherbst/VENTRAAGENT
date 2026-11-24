// Save and resume for onboarding drafts. A DraftStore saves one draft per user/workspace key.
// Loading never throws: unreadable or old drafts keep every valid answer and list the rest as
// needing re-entry.
import { answerKey, isStepId, nextStep, stepIds, validateStep } from './model.ts';
import type { Answers, StepId } from './model.ts';

export const DRAFT_VERSION = 1;
export type DraftStep = StepId | 'review';

export interface Draft {
  version: number;
  key: string;
  step: DraftStep;
  answers: Answers;
  updatedAt: string;
}

/** Minimal slice of the browser Storage API, so tests and the page share one implementation. */
export interface DraftBackend {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

export type LoadStatus = 'empty' | 'ok' | 'old-version' | 'corrupt' | 'unavailable';

export interface LoadResult {
  status: LoadStatus;
  answers: Answers;
  step: DraftStep;
  updatedAt: string | null;
  /** Steps whose saved answer could not be used and must be entered again. */
  needsReentry: StepId[];
  message: string;
}

export interface SaveResult { ok: boolean; updatedAt: string | null; message: string }

export interface DraftStore {
  save(key: string, step: DraftStep, answers: Answers): SaveResult;
  load(key: string): LoadResult;
  clear(key: string): void;
}

/** Builds the per-user/workspace draft key. Each part is encoded so different pairs never collide. */
export function draftKey(userId: string, workspaceId: string): string {
  if (typeof userId !== 'string' || typeof workspaceId !== 'string' || !userId.trim() || !workspaceId.trim()) {
    throw new Error('draftKey needs a user id and a workspace id.');
  }
  return `${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

export const storageName =(key: string): string => `aimp:onboarding:v${DRAFT_VERSION}:${key}`;
// Older versions were stored under their own prefix; list the names we know about so they can be found.
const legacyName = (key: string, version: number): string => `aimp:onboarding:v${version}:${key}`;

export const emptyResult = (status: LoadStatus, message: string, needsReentry: StepId[] = []): LoadResult => ({
  status, answers: {}, step: 'budget', updatedAt: null, needsReentry, message,
});

/** Keeps each valid saved answer; reports present-but-unusable ones as needing re-entry. */
function salvage(raw: unknown): { answers: Answers; needsReentry: StepId[] } {
  const answers: Answers = {};
  const needsReentry: StepId[] = [];
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const step of stepIds) {
    const value = source[answerKey[step]];
    if (value === undefined) continue;
    const result = validateStep(step, value);
    if (result.ok) (answers as Record<string, unknown>)[answerKey[step]] = result.value;
    else needsReentry.push(step);
  }
  return { answers, needsReentry };
}

export function parseDraft(raw: string | null, key: string): LoadResult {
  if (raw === null) return emptyResult('empty', 'No saved answers yet.');
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return emptyResult('corrupt', 'Your saved answers could not be read, so please start again.', [...stepIds]); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyResult('corrupt', 'Your saved answers could not be read, so please start again.', [...stepIds]);
  const d = data as Record<string, unknown>;
  // A draft must name its owner; a missing or different key means it is not this person's.
  if (d.key !== key) return emptyResult('corrupt', 'Saved answers belong to someone else, so they were not used.', [...stepIds]);
  const { answers, needsReentry } = salvage(d.answers);
  const updatedAt = typeof d.updatedAt === 'string' && !Number.isNaN(Date.parse(d.updatedAt)) ? d.updatedAt : null;
  const next = nextStep(answers);
  const savedStep = d.step === 'review' || isStepId(d.step) ? (d.step as DraftStep) : null;
  // Never resume past a step that still needs an answer.
  const needFirst = next ?? 'review';
  const order = (s: DraftStep): number => (s === 'review' ? stepIds.length : stepIds.indexOf(s));
  const step: DraftStep = savedStep && order(savedStep) <= order(needFirst) ? savedStep : needFirst;
  const kept = Object.keys(answers).length;
  if (d.version !== DRAFT_VERSION) {
    return { status: 'old-version', answers, step, updatedAt, needsReentry, message: kept ? 'Your saved answers came from an older version. We kept what still fits.' : 'Your saved answers came from an older version and could not be used.' };
  }
  if (needsReentry.length) {
    return { status: 'corrupt', answers, step, updatedAt, needsReentry, message: 'Some saved answers could not be read. We kept the rest.' };
  }
  return { status: 'ok', answers, step, updatedAt, needsReentry: [], message: 'Welcome back. Your answers were saved.' };
}

export function createDraftStore(backend: DraftBackend, now: () => Date = () => new Date()): DraftStore {
  return {
    save(key, step, answers) {
      const updatedAt = now().toISOString();
      const draft: Draft = { version: DRAFT_VERSION, key, step, answers, updatedAt };
      try {
        backend.setItem(storageName(key), JSON.stringify(draft));
        return { ok: true, updatedAt, message: 'Saved' };
      } catch {
        return { ok: false, updatedAt: null, message: 'Could not save in this browser. Your answers are kept until you close this page.' };
      }
    },
    load(key) {
      try {
        const current = backend.getItem(storageName(key));
        if (current !== null) return parseDraft(current, key);
        for (let v = DRAFT_VERSION - 1; v >= 0; v -= 1) {
          const old = backend.getItem(legacyName(key, v));
          if (old !== null) return parseDraft(old, key);
        }
        return parseDraft(null, key);
      } catch {
        return emptyResult('unavailable', 'Saving is not available in this browser, so answers are kept only while this page is open.');
      }
    },
    clear(key) {
      try { backend.removeItem(storageName(key)); } catch { /* nothing to clear */ }
    },
  };
}

/** Backing map shared between store instances to mimic a persistent store in tests. */
export function createMemoryBackend(initial: Record<string, string> = {}): DraftBackend & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => { data.set(name, value); },
    removeItem: (name) => { data.delete(name); },
  };
}

export function createMemoryStore(backend: DraftBackend = createMemoryBackend(), now?: () => Date): DraftStore {
  return createDraftStore(backend, now);
}

/** Browser store (this browser only). Falls back to a quiet in-memory store when localStorage is blocked. */
export function createLocalStorageStore(now?: () => Date): DraftStore {
  let backend: DraftBackend;
  try {
    const ls = globalThis.localStorage;
    ls.getItem('aimp:onboarding:probe');
    backend = ls;
  } catch {
    backend = createMemoryBackend();
  }
  return createDraftStore(backend, now);
}

// No reusable sign-in/workspace hook exists for this page, so the test page uses a labelled demo key.
export const DEMO_DRAFT_KEY = draftKey('demo-user', 'demo-workspace');
