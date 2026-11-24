// The automation service of the /start demo runtime (AMP-140). Server-only helper; no screen code.
// It gives the Operator runs page and the Approvals page what they read: the REAL automation service (lib/aimp/automation) over the
// REAL in-memory job engine with FIXTURE job handlers, owned by the /start runtime itself, so a /start business reads its own runs and
// approvals and not the separate automation demo's. Kept on the runtime, so it lives and dies with the other /start stores.
//
// Nothing is seeded and no run is invented: the service starts empty. A run exists only when something enqueues one.
// Today ONE /start step does (AMP-149): publishing the store, via `publishStoreAsJob` below (the real `publish-site` job, whose handler
// runs the AMP-146 checked publish). Product generation, orders and campaigns still call their own services directly, not the job engine.
// The other registered handlers (generate-product, fulfil-order, scheduled-post) are DEMO stubs: their outputs say `demo: true`.
// DEMO storage: lost when the server restarts. Real provider keys are never read (empty env gives the fixture adapters), and the job
// clock is the real one, so approval expiry and run times are true.
//
// Uses `.ts` import paths so the node tests can load it (runtime.ts itself cannot be loaded there). It never imports runtime.ts.
import { createAutomationService } from '../../../lib/aimp/automation/service.ts';
import type { AutomationService } from '../../../lib/aimp/automation/service.ts';
import { createMemoryAutomationStore } from '../../../lib/aimp/automation/store.ts';
import { createDemoJobDefinitions, createEffectLog, createFaultPlan } from '../../../lib/aimp/jobs/handlers.ts';
import type { HandlerDeps } from '../../../lib/aimp/jobs/handlers.ts';
import { createJobRegistry } from '../../../lib/aimp/jobs/registry.ts';
import { createJobRunner } from '../../../lib/aimp/jobs/runner.ts';
import type { JobRunner } from '../../../lib/aimp/jobs/runner.ts';
import { createJobService } from '../../../lib/aimp/jobs/service.ts';
import type { JobService } from '../../../lib/aimp/jobs/service.ts';
import { createMemoryJobStore } from '../../../lib/aimp/jobs/store.ts';
import { JobsError } from '../../../lib/aimp/jobs/types.ts';
import { createProviderRegistry } from '../../../lib/aimp/providers/index.ts';
import { createPublishSiteFor } from '../../../lib/aimp/publish-check/wiring.ts';
import type { PublishWiringOptions } from '../../../lib/aimp/publish-check/wiring.ts';

/** AI generations per period for a /start business until the owner sets another allowance (same as the automation demo). */
export const START_AUTOMATION_CAP = 3;

export interface StartAutomation {
  /** What the Operator and Approvals pages read and act through. Every call is scoped by workspace AND business inside the service. */
  automation: AutomationService;
  /** The job engine behind it (for a future caller that runs due jobs). Nothing runs jobs on its own today. */
  jobs: { service: JobService; runner: JobRunner };
  /**
   * Connects the real stores the publish-site job checks against (AMP-146). Until called (and for a business with no store) the job runs
   * the labelled demo stub. The options may hold getters, so a runtime still being built can pass its own stores. Calling again replaces it.
   */
  connectPublish(publish: PublishWiringOptions): void;
  /** True only when a real store is connected for this workspace and business (what publishStoreAsJob needs). False before connectPublish. */
  hasStore(scope: { workspaceId: string; businessId: string }): Promise<boolean>;
}

export interface StartAutomationOptions {
  /** Epoch milliseconds. Defaults to the real clock. */
  now?: () => number;
  /**
   * The real stores the publish-site job checks against (AMP-146). Given: a publish-site job for a business that has a store in `sites`
   * runs the REAL publish check (publishWithCheck over `sites`, an in-process page loader, the checkout probe) and rolls back or pauses
   * on failure. Omitted, or for a business with no store: the labelled demo stub, as before.
   */
  publish?: PublishWiringOptions;
}

export interface PublishStoreRequest {
  workspaceId: string;
  businessId: string;
  /** The signed-in owner who pressed Publish, from the server session (never read from a form). Required: there is no default. */
  actorUserId: string;
  /**
   * Repeating the same key for the same business returns the SAME run and never publishes twice. Up to 90 characters. Callers should
   * derive it from what is being published (for example business id + draft revision), not from a random value, to be retry-safe.
   */
  idempotencyKey: string;
}

export type PublishStoreOutcome =
  /** The real checked publish ran and passed: the store is live. */
  | { outcome: 'published'; jobId: string; created: boolean; version: number | null; message: string }
  /** The check failed: the store was rolled back to the earlier good version, or (a first publish) paused. Never left live and broken. */
  | { outcome: 'failed'; jobId: string; created: boolean; storeState: 'rolled_back' | 'paused' | 'unknown'; rolledBackTo: number | null; message: string }
  /** The run did not reach a result (retry pending, or the queue threw). Nothing runs it again by itself; nothing was confirmed live. */
  | { outcome: 'not_finished'; jobId: string; created: boolean; jobStatus: string; message: string }
  /** Publishing is switched off in the owner's automation settings: nothing was started. */
  | { outcome: 'paused'; message: string }
  /** No store exists for this business in this workspace: nothing was started (never a pretend publish). */
  | { outcome: 'no_store'; message: string }
  /** The request itself was refused (bad key, key reused for a different store). Nothing was published. */
  | { outcome: 'refused'; message: string };

/** The store address of a business in a workspace, or undefined when that workspace has no such store. */
export type StoreSlugLookup = (workspaceId: string, businessId: string) => string | undefined;

const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * AMP-149. Publishes a store as an Operator-visible run of the REAL `publish-site` job (handler: lib/aimp/jobs/handlers.ts, which calls
 * publishWithCheck over this runtime's real site-version store, AMP-146), then DRIVES it: the runner is awaited once after the enqueue, so the
 * run never sits at "Waiting to start". No timer is created. A retry that needs a later time is reported as `not_finished`, not waited for.
 *
 * The owner pressing Publish IS the approval, so the "Ask me first" mode does not hold it back; a Publishing area set to Paused does.
 * The run is then listed by the automation service for this workspace and business exactly like any other run.
 */
export async function publishStoreAsJob(
  sa: StartAutomation,
  storeSlugFor: StoreSlugLookup,
  req: PublishStoreRequest,
): Promise<PublishStoreOutcome> {
  const { workspaceId, businessId, actorUserId, idempotencyKey } = req;
  const ok = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
  if (!ok(workspaceId, 100) || !ok(businessId, 100) || !ok(actorUserId, 100) || !ok(idempotencyKey, 90)) {
    return { outcome: 'refused', message: 'The publish request was not valid, so nothing was published.' };
  }
  // Looked up by workspace AND business: a business id from another workspace never finds this store.
  const storeSlug = storeSlugFor(workspaceId, businessId);
  let has: boolean;
  try { has = !!storeSlug && (await sa.hasStore({ workspaceId, businessId })); } catch {
    return { outcome: 'refused', message: 'The store could not be read just now, so nothing was published. Try again.' };
  }
  if (!storeSlug || !has) {
    return { outcome: 'no_store', message: 'There is no store draft for this business, so nothing was published.' };
  }
  const ctx = { workspaceId, businessId, actorUserId, idempotencyKey: `${businessId}:publish:${idempotencyKey}` };
  let settings;
  try { settings = await sa.automation.getSettings(ctx); } catch {
    return { outcome: 'refused', message: 'Your automation settings could not be read just now, so nothing was published. Try again.' };
  }
  if (settings.modes.publishing === 'paused') {
    return { outcome: 'paused', message: 'Publishing is paused in your automation settings, so nothing was published.' };
  }
  let job;
  let created: boolean;
  try {
    // WARNING: this enqueues straight onto the job service and so SKIPS the "Ask me first" approval. The owner pressing Publish is the
    // approval, so it may only be called from an action the signed-in owner just pressed, with that owner as actorUserId (pending the
    // owner decision AMP-146-D). Never call it from a timer, an import or anything the owner did not press.
    ({ job, created } = await sa.jobs.service.enqueue(ctx, { kind: 'publish-site', input: { storeSlug } }));
  } catch (e) {
    // Only the job engine's own "key already used with different input" is a key problem; anything else is the queue failing.
    if (e instanceof JobsError && e.code === 'conflict') {
      return { outcome: 'refused', message: 'That publish request key was already used for something else, so nothing was published.' };
    }
    return { outcome: 'refused', message: 'The publish could not be started just now, so nothing was published. Try again.' };
  }
  // Drive it. Only jobs of this workspace are claimed; a job that is already finished is not due, so a repeat never publishes again.
  let done;
  try {
    await sa.jobs.runner.drain({ workspaceId });
    done = await sa.jobs.service.get(ctx, job.id, businessId);
  } catch {
    return { outcome: 'not_finished', jobId: job.id, created, jobStatus: 'unknown', message: 'The publish could not be driven to its result just now, so the store was not confirmed live. Check Runs, then publish again.' };
  }
  const publish = rec(done.steps.find((s) => s.name === 'publish')?.output);
  if (done.status === 'succeeded') {
    if (publish?.demo === true) return { outcome: 'refused', message: 'No real store was found for this publish, so nothing was published.' };
    return { outcome: 'published', jobId: done.id, created, version: typeof publish?.version === 'number' ? publish.version : null, message: 'Your store passed its checks and is live.' };
  }
  if (done.status === 'failed') {
    const how = publish?.outcome;
    return {
      outcome: 'failed', jobId: done.id, created,
      storeState: how === 'rolled_back' ? 'rolled_back' : how === 'unpublished' ? 'paused' : 'unknown',
      rolledBackTo: typeof publish?.rolledBackTo === 'number' ? publish.rolledBackTo : null,
      message: `${done.lastError ?? 'The publish check did not pass, so the store was not confirmed live.'} Repeating the same request returns this failed run; to try again, fix the store and publish from a new draft revision (a new key).`,
    };
  }
  // Nothing runs this job again on its own (no timer), so no retry is promised.
  return { outcome: 'not_finished', jobId: done.id, created, jobStatus: done.status, message: `${done.lastError ?? 'The publish is not finished yet.'} The store was not confirmed live. Check Runs, then publish again.` };
}

export function createStartAutomation(opts: StartAutomationOptions = {}): StartAutomation {
  const now = opts.now ?? Date.now;
  // An EMPTY env gives the fixture adapters; real keys in process.env are never read here.
  const providers = createProviderRegistry({ env: {} });
  const store = createMemoryJobStore();
  let publishFor: ReturnType<typeof createPublishSiteFor> | null = opts.publish ? createPublishSiteFor(opts.publish) : null;
  // Always set, so a store connected later is picked up; answers null (the stub) until something is connected.
  const publishSiteFor: NonNullable<HandlerDeps['publishSiteFor']> = async (scope) => (publishFor ? publishFor(scope) : null);
  const registry = createJobRegistry(createDemoJobDefinitions({ providers, effects: createEffectLog({}), faults: createFaultPlan(), publishSiteFor }));
  const service = createJobService({ store, registry, now });
  const runner = createJobRunner({ store, registry, owner: 'start-runner', now, random: () => 0.5, leaseMs: 60_000 });
  const automation = createAutomationService({ store: createMemoryAutomationStore(), jobs: service, now, defaultCap: START_AUTOMATION_CAP });
  return {
    automation, jobs: { service, runner },
    connectPublish: (publish) => { publishFor = createPublishSiteFor(publish); },
    hasStore: async (scope) => (publishFor ? (await publishFor(scope)) !== null : false),
  };
}
