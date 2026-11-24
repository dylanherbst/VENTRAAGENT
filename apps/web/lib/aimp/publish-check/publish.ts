// publishWithCheck (AMP-035, D03; fixes AMP-098): publish through the real site-versions API, smoke-test what went live, and undo it if the test fails.
// Undo rule: previously published version -> roll back to it; nothing was published before -> pause (the store goes back to unpublished).
// A failed undo is never swallowed: the result says the store may still be live and what to do. Nothing in here throws to the caller.
// One publish per store at a time (in this process), and the undo only touches the store while OUR version is still the live one.
// Crash safety: every version published here carries PUBLISH_MARK in its note. If a run died after a failed check but before the
// undo, a retry sees the unchanged, marked, failing live version and undoes it instead of leaving it live.
import type { Actor, FailCode, HistoryView, SiteVersionStore } from '../site-versions/store.ts';
import { describeFailures, runPublishCheck, type CheckFail, type CheckPass, type PublishCheckDeps, type PublishCheckResult } from './check.ts';

/** `markChecked` (AMP-145) is optional so a thin wrapper without it keeps working: the pass is then kept in memory only (the old behaviour). */
export type PublishSiteApi = Pick<SiteVersionStore, 'publish' | 'rollback' | 'pause' | 'history' | 'resolvePublished' | 'getVersion'> & Partial<Pick<SiteVersionStore, 'markChecked'>>;

export interface PublishWithCheckDeps {
  versions: PublishSiteApi;
  check: PublishCheckDeps;
  /** How long one publish may hold the store's queue before it is recorded as `timed_out`. Default 120000. Tests inject a small value. */
  queueTimeoutMs?: number;
  /** Called (never throws into the publish) when a pass could not be recorded in the store for a reason other than "not supported yet". Plain text, no raw error text. */
  onWarning?: (message: string) => void;
}
export interface PublishWithCheckInput {
  actor: Actor;
  businessId: string;
  storeSlug: string;
  note?: string;
  expectedRevision?: number;
}

/** Written into the note of every version this module publishes, so a retry can tell it is one of ours. */
export const PUBLISH_MARK = '[publish-check]';
const NOTE_MAX = 200;

export type PublishOutcome = 'published' | 'rolled_back' | 'unpublished' | 'rollback_failed' | 'not_published' | 'unchanged_check_failed' | 'timed_out';
export type PublishWithCheckResult =
  | { ok: true; outcome: 'published'; version: number; checks: CheckPass[]; skipped: CheckPass[] }
  | {
    ok: false; outcome: Exclude<PublishOutcome, 'published'>; message: string; failed: CheckFail[];
    /** What did pass and what was not tested, kept so the owner can see the whole picture, not only the failures. */
    checks: CheckPass[]; skipped: CheckPass[];
    version?: number; rolledBackTo?: number; rollbackErrors?: string[];
    /** true: nothing is wrong with the store, trying again later can work (conflict, "please try again"). */
    retryable: boolean;
  };

const RETRYABLE: FailCode[] = ['conflict', 'failed'];

const stop = (message: string, errors: string[] = [], retryable = false): PublishWithCheckResult =>
  ({ ok: false, outcome: 'not_published', message: [message, ...errors].join(' '), failed: [{ check: 'publish', reason: message }], checks: [], skipped: [], retryable });

/** Longest one publish (publish, check, undo) may hold the per-store queue. */
export const DEFAULT_QUEUE_TIMEOUT_MS = 120_000;
interface Control { abandoned: boolean; /** set as soon as publish succeeds, so a timeout result can name the version */ version?: number }

const timedOut = (version?: number): PublishWithCheckResult => ({
  ok: false, outcome: 'timed_out', failed: [{ check: 'publish', reason: 'The publish did not finish in time.' }], checks: [], skipped: [], retryable: false,
  ...(version !== undefined ? { version } : {}),
  message: 'The publish did not finish in time and was given up on, so the store may or may not have changed. Look at your live store before publishing again.',
});

// One publish per store at a time: the next one starts when the previous has fully finished (including its undo), or has timed out.
// A run that exceeds the timeout gets the recorded result `timed_out`, is marked abandoned (it makes no further store changes
// once it notices) and stops blocking the queue.
const queues = new Map<string, Promise<void>>();
async function exclusive(key: string, fn: (ctl: Control) => Promise<PublishWithCheckResult>, timeoutMs: number): Promise<PublishWithCheckResult> {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(() => new Promise<PublishWithCheckResult>((resolve, reject) => {
    const ctl: Control = { abandoned: false };
    const timer = setTimeout(() => { ctl.abandoned = true; resolve(timedOut(ctl.version)); }, timeoutMs);
    // Not unref'd: the timer is bounded by timeoutMs, and an unref'd timer let the process (and tests) exit with the publish still pending.
    fn(ctl).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  }));
  const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail);
  try { return await run; } finally { if (queues.get(key) === tail) queues.delete(key); }
}

// AMP-145: a pass is recorded through the store (`markChecked`, read back as `checkedOk`). It lasts only as long as that store does:
// with the in-memory store a pass is lost on a restart; a pass survives a restart only once a database-backed store keeps it. This
// in-memory record is only the FALLBACK, used when the store has no `markChecked` or refuses it (for example a database store whose
// column is not migrated yet). Per version store; key workspace/slug/version/publishedAt.
const ledgers = new WeakMap<object, Set<string>>();
function passLedger(versions: object): Set<string> {
  let s = ledgers.get(versions);
  if (!s) { s = new Set(); ledgers.set(versions, s); }
  return s;
}

/** Record a pass in the store; if the store cannot, keep it in the in-memory fallback. Never throws.
 * Silent fallback only when there is no `markChecked` or the store answers `failed` (column not there yet). Any other refusal
 * (`denied`, `not_found`, `invalid`, `conflict`) or a throw keeps the in-memory pass too, but is reported through `onWarning`. */
async function recordPass(versions: PublishSiteApi, passes: Set<string>, passKey: string, actor: Actor, slug: string, version: number, onWarning?: (message: string) => void): Promise<void> {
  const warn = (message: string) => { try { onWarning?.(message); } catch { /* a broken warning hook must not change the outcome */ } };
  try {
    if (versions.markChecked) {
      const r = await versions.markChecked(actor, slug, version);
      if (r.ok) return;
      if (r.code !== 'failed') warn(`The pass of version ${version} could not be recorded in the store (${r.code}); it is kept in memory only.`);
    }
  } catch { warn(`The pass of version ${version} could not be recorded in the store (it stopped unexpectedly); it is kept in memory only.`); }
  passes.add(passKey);
}

/** The version that was live right before `version` went live, read from the history events (newest first). */
function previouslyLive(h: HistoryView, version: number): number | null {
  const goLive = h.events.filter((e) => (e.kind === 'publish' || e.kind === 'rollback') && typeof e.version === 'number');
  const i = goLive.findIndex((e) => e.version === version);
  if (i < 0) return null;
  const prev = goLive[i + 1];
  return prev?.version ?? null;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export async function publishWithCheck(deps: PublishWithCheckDeps, input: PublishWithCheckInput): Promise<PublishWithCheckResult> {
  try {
    const key = `${input?.actor?.workspaceId ?? ''}/${input?.storeSlug ?? ''}`;
    const ms = Number.isFinite(deps.queueTimeoutMs) && (deps.queueTimeoutMs as number) > 0 ? (deps.queueTimeoutMs as number) : DEFAULT_QUEUE_TIMEOUT_MS;
    return await exclusive(key, (ctl) => publishOnce(deps, input, ctl), ms);
  } catch {
    // publishOnce handles its own failures; this is the last line so the caller never sees a throw.
    return stop('Publishing stopped unexpectedly, so the store may or may not have changed. Check the live store before publishing again.', [], true);
  }
}

async function publishOnce(deps: PublishWithCheckDeps, input: PublishWithCheckInput, ctl: Control): Promise<PublishWithCheckResult> {
  const { versions } = deps;
  const { actor, businessId, storeSlug } = input;

  const userNote = (input.note ?? '').trim();
  const note = userNote ? `${userNote} ${PUBLISH_MARK}` : PUBLISH_MARK;
  if (note.length > NOTE_MAX) return stop(`The note must be at most ${NOTE_MAX - PUBLISH_MARK.length - 1} characters. Nothing was published.`);

  let before;
  try { before = await versions.history(actor, storeSlug); } catch { return stop('Nothing was published: the store could not be read. Please try again.', [], true); }
  if (!before.ok) return stop('Nothing was published.', before.errors, RETRYABLE.includes(before.code));
  const previous = before.value.liveVersion;
  // Paused (by the owner, or by us after a failed first publish): a new version would not be visible, so the check could not mean anything.
  if (before.value.paused) return stop('Your store is paused, so nothing was published. Resume it, then publish again.');

  if (ctl.abandoned) return timedOut();
  let pub;
  try { pub = await versions.publish(actor, storeSlug, { note, expectedRevision: input.expectedRevision }); }
  catch { return stop('Publishing stopped unexpectedly, so the store may or may not have changed. Please try again.', [], true); }
  if (!pub.ok) return stop('Nothing was published and your live store has not changed.', pub.errors, RETRYABLE.includes(pub.code));
  const unchanged = pub.value.unchanged === true;
  const version = pub.value.version;
  ctl.version = version;
  if (ctl.abandoned) return timedOut(version); // timed out while publishing: do not start the check

  const passes = passLedger(versions);
  const passKey = `${actor.workspaceId}/${storeSlug}/${version}/${pub.value.publishedAt}`;
  let result: PublishCheckResult;
  try { result = await runPublishCheck(deps.check, { workspaceId: actor.workspaceId, businessId, storeSlug, versionId: version }); }
  catch { result = { ok: false as const, failed: [{ check: 'check', reason: 'The publish check could not run.' }], checks: [], skipped: [] }; }
  if (result.ok) await recordPass(versions, passes, passKey, actor, storeSlug, version, deps.onWarning);
  if (result.ok) return { ok: true, outcome: 'published', version, checks: result.checks, skipped: result.skipped };

  // A retry (draft equals live): the live version is already published. It is ours to undo only if an earlier run of this check
  // published it (its note says so), AND it never passed its check, AND a confirming re-run fails too. A version that passed once is
  // never taken down because a later check of the same unchanged draft failed (provider outage, page-load flake): AMP-101.
  if (unchanged) {
    const ours = pub.value.source.kind === 'publish' && pub.value.note.includes(PUBLISH_MARK);
    const firstWhy = describeFailures(result.failed);
    const firstLists = { failed: result.failed, checks: result.checks, skipped: result.skipped, retryable: false };
    if (!ours) {
      // Publishing changed nothing and we did not publish this version: there is nothing of ours to undo.
      return { ok: false, outcome: 'unchanged_check_failed', version, ...firstLists, message: `Nothing new was published, but the live store has a problem. ${firstWhy}` };
    }
    if (pub.value.checkedOk === true || passes.has(passKey)) {
      return { ok: false, outcome: 'unchanged_check_failed', version, ...firstLists, message: `Version ${version} passed its check earlier and was left live, because this failure may be temporary. Check your store and try again. ${firstWhy}` };
    }
    let again: Awaited<ReturnType<typeof runPublishCheck>>;
    try { again = await runPublishCheck(deps.check, { workspaceId: actor.workspaceId, businessId, storeSlug, versionId: version }); }
    catch { again = { ok: false as const, failed: [{ check: 'check', reason: 'The publish check could not run.' }], checks: [], skipped: [] }; }
    if (again.ok) {
      await recordPass(versions, passes, passKey, actor, storeSlug, version, deps.onWarning);
      return { ok: true, outcome: 'published', version, checks: again.checks, skipped: again.skipped };
    }
    result = again; // the failure repeated: use the second run's findings
  }

  const why = describeFailures(result.failed);
  const lists = { failed: result.failed, checks: result.checks, skipped: result.skipped, retryable: false };
  const fail = (errors: string[], superseded = false): PublishWithCheckResult => rollbackFailed(version, lists, why, errors, superseded);

  // Only undo while our version is still what the store serves. If something else went live meanwhile, leave it alone.
  if (ctl.abandoned) return timedOut(version);
  let liveNow: number | null;
  let hist: HistoryView;
  try {
    const h = await versions.history(actor, storeSlug);
    if (!h.ok) return fail(h.errors.length ? h.errors : ['The store could not be read before undoing the publish.']);
    liveNow = h.value.liveVersion;
    hist = h.value;
  } catch { return fail(['The store could not be read before undoing the publish.']); }
  if (liveNow !== version) return fail([`Version ${liveNow ?? 'none'} is live now, not version ${version}, so nothing was undone.`], true);

  // Which version should the store go back to? The one that was live before ours, taken from history (never `version - 1`:
  // that can be a rollback copy or a version that was never live). A normal run: what was live before publishing.
  const target: number | null = unchanged ? previouslyLive(hist, version) : previous;
  if (ctl.abandoned) return timedOut(version);

  // Last guard before the store is changed: not abandoned AND our version still live, read fresh. It is the last await before the
  // rollback/pause call, so nothing but this read sits between the check and the change. The cross-process gap after this read is
  // closed by the store: rollback and pause carry `expectedLive: version` and answer `conflict` if another version went live (AMP-145).
  const lastGuard = async (): Promise<PublishWithCheckResult | null> => {
    if (ctl.abandoned) return timedOut(version);
    let liveLast: number | null;
    try {
      const h = await versions.history(actor, storeSlug);
      if (!h.ok) return fail(h.errors.length ? h.errors : ['The store could not be read before undoing the publish.']);
      liveLast = h.value.liveVersion;
    } catch { return fail(['The store could not be read before undoing the publish.']); }
    if (ctl.abandoned) return timedOut(version);
    if (liveLast !== version) return fail([`Version ${liveLast ?? 'none'} is live now, not version ${version}, so nothing was undone.`], true);
    return null;
  };

  if (target !== null) {
    // Read the target first, so no read sits between the last guard and the rollback.
    let targetConfig: unknown;
    try { const g = await versions.getVersion(actor, storeSlug, target); if (g.ok) targetConfig = g.value.config; } catch { /* confirmed below: without it the content cannot be compared */ }
    const stopped = await lastGuard();
    if (stopped) return stopped;
    let rb;
    try { rb = await versions.rollback(actor, storeSlug, target, { note: `Automatic rollback: version ${version} failed its publish check`, expectedLive: version }); }
    catch { return fail(['The rollback stopped unexpectedly.']); }
    // conflict with expectedLive: another version went live after our last read; the store left it alone.
    if (!rb.ok) return fail(rb.errors, rb.code === 'conflict');
    let now;
    try { now = await versions.resolvePublished(storeSlug); } catch { return fail(['The store could not be checked after the rollback.']); }
    if (now.status !== 'live') return fail(['The earlier version did not come back after the rollback.']);
    if (now.version !== rb.value.version) return fail([`Version ${now.version} is live after the rollback instead of the restored version.`]);
    if (targetConfig === undefined) return fail([`Version ${target} could not be read, so the restored content could not be confirmed.`]);
    if (stable(now.config) !== stable(targetConfig)) return fail([`The live content is not the same as version ${target} after the rollback.`]);
    return { ok: false, outcome: 'rolled_back', version, rolledBackTo: target, ...lists, message: `Publishing was undone and version ${target} is live again. ${why}` };
  }

  const stoppedBeforePause = await lastGuard();
  if (stoppedBeforePause) return stoppedBeforePause;
  let p;
  try { p = await versions.pause(actor, storeSlug, { expectedLive: version }); } catch { return fail(['Pausing the store stopped unexpectedly.']); }
  if (!p.ok) return fail(p.errors, p.code === 'conflict');
  let now;
  try { now = await versions.resolvePublished(storeSlug); } catch { return fail(['The store could not be checked after it was paused.']); }
  if (now.status !== 'paused') return fail(['The store is still reachable after it was paused.']);
  return { ok: false, outcome: 'unpublished', version, ...lists, message: `Publishing was undone and your store is not public (it is paused). Fix the problem, resume the store and publish again. ${why}` };
}

function rollbackFailed(version: number, lists: { failed: CheckFail[]; checks: CheckPass[]; skipped: CheckPass[] }, why: string, errors: string[], superseded = false): PublishWithCheckResult {
  return {
    ok: false, outcome: 'rollback_failed', version, ...lists, retryable: false, rollbackErrors: errors,
    message: superseded
      ? `Version ${version} failed its check, but another version went live since, so it was not undone automatically. Look at your live store now. ${why}`
      : `Version ${version} failed its check and could NOT be taken down automatically, so it may still be live. Pause the store or restore an earlier version now. ${why}`,
  };
}
