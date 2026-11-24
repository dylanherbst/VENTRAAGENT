// Job runner. Claims due jobs (atomic lease), executes ONLY the next incomplete step of each, persists the checkpoint, and
// settles. A crash or restart resumes at the last completed step: succeeded steps are not executed again. Time, randomness
// and ids are injected so tests are deterministic.
//
// DELIVERY GUARANTEE: AT-LEAST-ONCE per step with a stable per-step idempotency key (`${jobId}:${stepName}`). A step can run
// again after a crash, a step timeout, a lost lease or a failed checkpoint write even though its side effect already happened.
// Handlers and providers MUST be idempotent on that key; the runner cannot make an external call exactly-once by itself.
// What IS exactly-once: the checkpoint of a step and its charge (one atomic settle, ledger keyed by job + step).
//
// Isolation: the usage guard, the handler (with a timeout) and the store settle are separate steps. A throwing guard or handler
// becomes a retry; a throwing settle only affects that job (its lease expires and it is reclaimed). One bad job never stops
// the others in the same batch.
import type { JobRegistry, StepResult } from './registry.ts';
import type { JobStore, SettleOutcome } from './store.ts';
import { isJson, JobError, MAX_JSON_BYTES, safeText, stableStringify } from './types.ts';
import type { JobKind, JobRecord, JsonValue } from './types.ts';

export interface BackoffOptions { baseDelayMs: number; maxDelayMs: number; jitterRatio: number }
export const DEFAULT_BACKOFF: BackoffOptions = { baseDelayMs: 2_000, maxDelayMs: 15 * 60_000, jitterRatio: 0.25 };

/** Capped exponential backoff for the nth failed attempt (1-based). Jitter SUBTRACTS up to jitterRatio of the delay, so the
 *  result never exceeds the cap and runners still spread out once the cap is reached. random() is in [0, 1). */
export function backoffMs(attempt: number, o: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const delay = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(0, Math.round(delay * (1 - o.jitterRatio * random())));
}

/** Usage guard: called before a step that declares a cost runs, with the DECLARED cost (a handler may lower it, never raise it).
 *  Deny parks the job (paused) without using an attempt. A throwing guard is treated as a temporary failure. */
export type UsageGuard = (req: { workspaceId: string; jobId: string; kind: JobKind; stepName: string; costMinor: number }) => Promise<{ allow: true } | { allow: false; reason: string }>;

export interface RunnerOptions {
  store: JobStore;
  registry: JobRegistry;
  /** Unique per runner process. Two runners must use different owners. */
  owner: string;
  now?: () => number;
  random?: () => number;
  leaseMs?: number;
  /** Time limit for one step attempt. Always kept below leaseMs (default 80% of it) so the lease cannot expire mid-step. */
  stepTimeoutMs?: number;
  backoff?: Partial<BackoffOptions>;
  guard?: UsageGuard;
}

export type StepOutcomeKind = 'succeeded' | 'retry' | 'failed' | 'paused' | 'lost-lease' | 'error';
export interface RunReport {
  jobId: string;
  workspaceId: string;
  kind: JobKind;
  step: string;
  outcome: StepOutcomeKind;
  jobStatus: JobRecord['status'] | null;
  message: string | null;
}

export interface JobRunner {
  /** Claims up to `limit` due jobs and runs one step of each. One job failing never rejects the batch. */
  runDue(opts?: { limit?: number; workspaceId?: string }): Promise<RunReport[]>;
  /** Repeats runDue until nothing is due (bounded). Retries that wait for a later time are not waited for. */
  drain(opts?: { maxRounds?: number; limit?: number; workspaceId?: string }): Promise<RunReport[]>;
}

const UNEXPECTED = 'Something unexpected went wrong. It will be tried again.';
const NOT_SAVED = 'The step finished but its result could not be saved. It will be picked up again shortly.';

export function createJobRunner(opts: RunnerOptions): JobRunner {
  const { store, registry, owner } = opts;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const leaseMs = opts.leaseMs ?? 60_000;
  const timeoutMs = Math.max(1, Math.min(opts.stepTimeoutMs ?? Math.floor(leaseMs * 0.8), leaseMs - 1));
  const backoff: BackoffOptions = { ...DEFAULT_BACKOFF, ...opts.backoff };

  const messageOf = (e: unknown): string => safeText(e instanceof JobError ? e.message : UNEXPECTED);

  async function withTimeout(run: (signal: AbortSignal) => Promise<StepResult>, stepName: string): Promise<StepResult> {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ac.abort(); reject(new JobError('temporary', `The "${stepName}" step took too long and was stopped.`)); }, timeoutMs);
    });
    try { return await Promise.race([run(ac.signal), timeout]); } finally { clearTimeout(timer); }
  }

  /** Decides what happened to the claimed step. Never throws, never touches the store. */
  async function decide(job: JobRecord, stepIndex: number): Promise<SettleOutcome> {
    const step = job.steps[stepIndex];
    const failed = (error: string): SettleOutcome => ({ type: 'failed', stepIndex, error: safeText(error) });

    // A step claimed more often than allowed means workers keep dying inside it (every lost lease counts as an attempt).
    if (step.attempts > job.maxAttempts) return failed(`The "${step.name}" step stopped part-way ${job.maxAttempts} times, so the job was stopped to be safe. Check the connection, then retry the job.`);

    const stepDef = registry.get(job.kind)?.steps.find((s) => s.name === step.name);
    if (!stepDef) return failed('This kind of job is no longer supported, so it was stopped.');

    // Retry or give up after a temporary problem, honouring the attempt budget.
    const temporary = (message: string): SettleOutcome => {
      if (step.attempts >= job.maxAttempts) {
        return failed(`The "${step.name}" step did not work after ${step.attempts} tries (${message.replace(/[.\s]+$/, '')}). Check the connection, then retry the job.`);
      }
      return { type: 'retry', stepIndex, error: message, nextRunAt: now() + backoffMs(step.attempts, backoff, random) };
    };

    if (opts.guard && step.costMinor > 0) {
      try {
        const g = await opts.guard({ workspaceId: job.workspaceId, jobId: job.id, kind: job.kind, stepName: step.name, costMinor: step.costMinor });
        if (!g.allow) return { type: 'paused', stepIndex, error: safeText(g.reason) };
      } catch {
        return temporary('The usage limit could not be checked right now.');
      }
    }

    const outputs: Record<string, JsonValue> = {};
    for (const s of job.steps) if (s.status === 'succeeded' && s.output !== null) outputs[s.name] = s.output;

    try {
      const res = await withTimeout((signal) => stepDef.run({ job, step, input: job.input, outputs, idempotencyKey: `${job.id}:${step.name}`, now: now(), signal }), step.name);
      if (!res || !isJson(res.output) || stableStringify(res.output).length > MAX_JSON_BYTES) throw new JobError('permanent', `The "${step.name}" step returned something that cannot be saved.`);
      const cost = res.costMinor ?? step.costMinor;
      if (!Number.isInteger(cost) || cost < 0) throw new JobError('permanent', `The "${step.name}" step reported an invalid cost.`);
      if (cost > step.costMinor) throw new JobError('permanent', `The "${step.name}" step reported a cost above its declared limit.`);
      return { type: 'succeeded', stepIndex, output: res.output, costMinor: cost };
    } catch (e) {
      if (e instanceof JobError && e.kind === 'permanent') return failed(e.message);
      return temporary(messageOf(e));
    }
  }

  async function execute(job: JobRecord, stepIndex: number): Promise<RunReport> {
    const step = job.steps[stepIndex];
    const outcome = await decide(job, stepIndex);
    // Settle is outside every handler/guard try: a store error is not mistaken for a step failure.
    const after = await store.settle(job.workspaceId, job.id, { owner, leaseVersion: job.leaseVersion }, outcome, now());
    const message = outcome.type === 'succeeded' ? null : safeText(outcome.error);
    return { jobId: job.id, workspaceId: job.workspaceId, kind: job.kind, step: step.name, outcome: after ? outcome.type : 'lost-lease', jobStatus: after?.status ?? null, message };
  }

  const runDue: JobRunner['runDue'] = async (o = {}) => {
    const claims = await store.claim({ now: now(), owner, leaseMs, limit: o.limit ?? 10, workspaceId: o.workspaceId });
    const settled = await Promise.allSettled(claims.map((c) => execute(c.job, c.stepIndex)));
    return settled.map((r, i): RunReport => {
      if (r.status === 'fulfilled') return r.value;
      const { job, stepIndex } = claims[i];
      // Settle failed: the lease is still held and expires on its own, then the job is reclaimed and the step runs again.
      return { jobId: job.id, workspaceId: job.workspaceId, kind: job.kind, step: job.steps[stepIndex].name, outcome: 'error', jobStatus: null, message: NOT_SAVED };
    });
  };
  const drain: JobRunner['drain'] = async (o = {}) => {
    const all: RunReport[] = [];
    for (let i = 0; i < (o.maxRounds ?? 50); i++) {
      const r = await runDue({ limit: o.limit, workspaceId: o.workspaceId });
      if (r.length === 0) break;
      all.push(...r);
    }
    return all;
  };
  return { runDue, drain };
}
