// Job kind registry: each kind lists its ordered steps, an optional declared cost per step and the handler for each step.
// Steps are copied onto the job when it is enqueued, so changing a definition later never rewrites jobs already in flight.
//
// DELIVERY GUARANTEE: the runner is AT-LEAST-ONCE per step, not exactly-once. A step can run again after a crash, a timeout,
// a lost lease or a failed checkpoint write, even though its side effect already happened. Every handler and every provider
// it calls MUST therefore be idempotent on `idempotencyKey` (stable per job + step). Checkpoints and the charge ledger make the
// job's own state and charges exactly-once; external effects are only exactly-once if the provider honours the key.
import { JobsError } from './types.ts';
import type { JobKind, JobRecord, JobStep, JsonValue } from './types.ts';

export interface StepArgs {
  /** Read-only snapshot of the job at claim time. */
  job: Readonly<JobRecord>;
  step: Readonly<JobStep>;
  input: JsonValue;
  /** Checkpoints of the steps that already succeeded, by step name. */
  outputs: Readonly<Record<string, JsonValue>>;
  /** Stable for this job + step across every retry and resume. Pass it to the provider so a repeat is a no-op. */
  idempotencyKey: string;
  now: number;
  /** Aborted when the step exceeds its time limit. Pass it to fetch/provider calls; the attempt is then treated as temporary. */
  signal: AbortSignal;
}
export interface StepResult {
  output: JsonValue;
  /** Cost for this run (minor units), recorded once, only when the step succeeds. It may LOWER the declared cost but never
   *  exceed it: the usage guard only sees the declared cost, so a higher value fails the step. */
  costMinor?: number;
}
export type StepHandler = (args: StepArgs) => Promise<StepResult>;

export interface StepDefinition { name: string; costMinor?: number; run: StepHandler }
export interface JobKindDefinition {
  kind: JobKind;
  steps: StepDefinition[];
  /** Per-step attempt cap. Default 5. */
  maxAttempts?: number;
}

export interface JobRegistry {
  register(def: JobKindDefinition): void;
  get(kind: JobKind): JobKindDefinition | null;
  kinds(): JobKind[];
}

export const DEFAULT_MAX_ATTEMPTS = 5;

export function createJobRegistry(defs: JobKindDefinition[] = []): JobRegistry {
  const map = new Map<JobKind, JobKindDefinition>();
  const register = (def: JobKindDefinition) => {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(def.kind)) throw new JobsError('invalid', `Job kind "${def.kind}" is not a valid name.`);
    if (def.steps.length === 0) throw new JobsError('invalid', `Job kind "${def.kind}" needs at least one step.`);
    const names = new Set<string>();
    for (const s of def.steps) {
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(s.name) || names.has(s.name)) throw new JobsError('invalid', `Job kind "${def.kind}" has a missing or duplicate step name.`);
      if (s.costMinor !== undefined && (!Number.isInteger(s.costMinor) || s.costMinor < 0)) throw new JobsError('invalid', `Step "${s.name}" has an invalid cost.`);
      names.add(s.name);
    }
    if (map.has(def.kind)) throw new JobsError('conflict', `Job kind "${def.kind}" is already registered.`);
    map.set(def.kind, def);
  };
  for (const d of defs) register(d);
  return { register, get: (k) => map.get(k) ?? null, kinds: () => [...map.keys()] };
}
