// Handlers for the four built-in job kinds. DEMO ONLY: they call the fixture provider adapters (never a live provider).
//
// DELIVERY GUARANTEE: the runner is at-least-once, so every provider call passes the step's stable idempotency key (a.idempotencyKey)
// to the adapter, which dedupes by it (fixtures here; live adapters forward it as the vendor idempotency header). A crash between the
// provider call and the checkpoint therefore repeats the call with the same key and the provider does the work once.
// `effects.once` stays as a second, independent choke point: honourKeys=true also de-duplicates at this layer; honourKeys=false
// does not, and records the key seen twice so the repeat is detectable (the provider adapter still dedupes).
// Where a step is a stub it says so and names the task that replaces it.
import type { ProviderRegistry } from '../providers/index.ts';
import { publishWithCheck, type PublishWithCheckDeps } from '../publish-check/index.ts';
import type { JobKindDefinition, StepArgs, StepResult } from './registry.ts';
import { JobError } from './types.ts';
import type { JsonValue } from './types.ts';

/** Stands in for the provider boundary. Every call carries the step's idempotency key. */
export interface EffectLog {
  once<T extends JsonValue>(key: string, label: string, run: () => Promise<T>): Promise<T>;
  /** Effects that really ran, in order (a repeat shows up again when keys are not honoured). */
  executed(): { key: string; label: string }[];
  /** Every call made with its key, including ones answered from a first result. */
  calls(): { key: string; label: string; duplicate: boolean }[];
  /** Repeat calls answered from the first result because the key was honoured. */
  suppressed(): number;
  /** Keys whose effect really ran more than once (only possible when keys are not honoured). */
  duplicateKeys(): string[];
}
export function createEffectLog(opts: { honourKeys?: boolean } = {}): EffectLog {
  const honour = opts.honourKeys ?? true;
  const results = new Map<string, Promise<JsonValue>>();
  const executed: { key: string; label: string }[] = [];
  const calls: { key: string; label: string; duplicate: boolean }[] = [];
  const seen = new Set<string>();
  let suppressed = 0;
  return {
    once(key, label, run) {
      calls.push({ key, label, duplicate: seen.has(key) });
      seen.add(key);
      const hit = honour ? results.get(key) : undefined;
      if (hit) { suppressed++; return hit as Promise<never>; }
      executed.push({ key, label });
      const p = run();
      if (honour) {
        results.set(key, p);
        p.catch(() => results.delete(key)); // a failed effect did not happen: allow the retry to try it
      }
      return p;
    },
    executed: () => executed.map((e) => ({ ...e })),
    calls: () => calls.map((c) => ({ ...c })),
    suppressed: () => suppressed,
    duplicateKeys: () => {
      const n = new Map<string, number>();
      for (const e of executed) n.set(e.key, (n.get(e.key) ?? 0) + 1);
      return [...n].filter(([, c]) => c > 1).map(([k]) => k);
    },
  };
}

/** Test and demo fault injection. 'after' fails once the effect has happened but before the checkpoint is saved (a crash). */
export interface FaultPlan {
  add(f: { kind: string; step: string; times: number; type: 'temporary' | 'permanent'; when?: 'before' | 'after'; message?: string }): void;
  check(kind: string, step: string, when: 'before' | 'after'): void;
  remaining(): number;
}
export function createFaultPlan(): FaultPlan {
  const faults: { kind: string; step: string; times: number; type: 'temporary' | 'permanent'; when: 'before' | 'after'; message: string }[] = [];
  return {
    add: (f) => { faults.push({ ...f, when: f.when ?? 'before', message: f.message ?? (f.type === 'permanent' ? 'The provider refused this request.' : 'The provider is busy right now.') }); },
    check(kind, step, when) {
      const f = faults.find((x) => x.kind === kind && x.step === step && x.when === when && x.times > 0);
      if (!f) return;
      f.times -= 1;
      throw new JobError(f.type, f.message);
    },
    remaining: () => faults.reduce((n, f) => n + f.times, 0),
  };
}

export interface HandlerDeps {
  providers: Pick<ProviderRegistry, 'llm' | 'email' | 'storage' | 'social'>;
  effects: EffectLog;
  faults?: FaultPlan;
  /** When set, `publish-site` really publishes, smoke-tests and rolls back (AMP-035). Unset: demo stubs. */
  publishSite?: PublishWithCheckDeps;
  /**
   * Per-business version of `publishSite` (AMP-146). Answers the real deps for a business that has a store, or null when it has none:
   * then that job runs the labelled demo stub. Takes precedence over `publishSite`. A throw is NOT "no store": it is a temporary job error.
   */
  publishSiteFor?: (scope: { workspaceId: string; businessId: string | null }) => Promise<PublishWithCheckDeps | null> | PublishWithCheckDeps | null;
}

const str = (v: JsonValue, k: string, fallback: string): string => {
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? v[k] : undefined;
  return typeof x === 'string' && x.length > 0 ? x.slice(0, 200) : fallback;
};

function need<T>(adapter: T | null, label: string): T {
  if (!adapter) throw new JobError('permanent', `${label} is not connected. Connect it in settings, then start the job again.`);
  return adapter;
}

export function createDemoJobDefinitions(deps: HandlerDeps): JobKindDefinition[] {
  const { providers, effects, faults } = deps;
  const step = (kind: string, name: string, fn: (a: StepArgs) => Promise<JsonValue>, costMinor?: number) => ({
    name, costMinor,
    run: async (a: StepArgs): Promise<StepResult> => {
      faults?.check(kind, name, 'before');
      const output = await fn(a);
      faults?.check(kind, name, 'after');
      return { output };
    },
  });
  const once = (a: StepArgs, label: string, run: () => Promise<JsonValue>) => effects.once(a.idempotencyKey, label, run);
  // The real publish deps for this job's business, or undefined (demo stub). Per-business resolver first, then the fixed deps.
  // check-version recorded `real: true`: this job's decision is "real store", and later steps may not flip it to the stub.
  const sawRealStore = (a: StepArgs): boolean => {
    const c = a.outputs['check-version'];
    return c !== null && typeof c === 'object' && !Array.isArray(c) && c.real === true;
  };
  const publishDepsFor = async (a: StepArgs): Promise<PublishWithCheckDeps | undefined> => {
    if (deps.publishSiteFor) {
      // A throw is NOT "no store": the store may exist but cannot be read right now, so the job retries instead of faking a pass.
      try { return (await deps.publishSiteFor({ workspaceId: a.job.workspaceId, businessId: a.job.businessId ?? null })) ?? undefined; } catch {
        throw new JobError('temporary', 'The store could not be read just now, so nothing was published or checked. It will try again.');
      }
    }
    return deps.publishSite;
  };

  return [
    {
      kind: 'generate-product',
      steps: [
        // Cost: one generation charge, recorded once when the step succeeds (not on retries).
        step('generate-product', 'draft-spec', (a) => once(a, 'llm.generate', async () => {
          const r = await need(providers.llm.adapter, 'The AI writer').generate({ prompt: `Draft a product for ${str(a.input, 'niche', 'planners')}`, idempotencyKey: a.idempotencyKey });
          return { text: r.text, model: r.model, demo: true };
        }), 5),
        step('generate-product', 'quality-check', async (a) => {
          const d = a.outputs['draft-spec'];
          const text = d !== null && typeof d === 'object' && !Array.isArray(d) && typeof d.text === 'string' ? d.text : '';
          if (!text.trim()) throw new JobError('permanent', 'The draft came back empty, so it was not saved. Try generating it again.');
          return { passed: true, checkedChars: text.length };
        }),
        step('generate-product', 'store-file', (a) => once(a, 'storage.put', async () => {
          const f = await need(providers.storage.adapter, 'File storage').put(`${a.job.workspaceId}/${a.job.id}/master.txt`, new TextEncoder().encode('demo'), { idempotencyKey: a.idempotencyKey });
          return { path: f.path, size: f.size, demo: true };
        })),
        // TODO(AMP-040 product lifecycle): replace the three demo steps with the real factory render + products service version.
      ],
    },
    {
      kind: 'publish-site',
      steps: [
        // With `deps.publishSite` wired these are REAL (AMP-035): publish the version, smoke-test it, undo it on failure.
        // Without it they stay DEMO stubs so the demo runner and its tests keep working.
        step('publish-site', 'check-version', async (a): Promise<JsonValue> => {
          if (!(await publishDepsFor(a))) return { ok: true, demo: true };
          if (!str(a.input, 'storeSlug', '') || !a.job.businessId) throw new JobError('permanent', 'Say which store to publish. Nothing was published.');
          return { ok: true, real: true };
        }),
        step('publish-site', 'publish', (a) => once(a, 'site.publish', async (): Promise<JsonValue> => {
          const real = await publishDepsFor(a);
          // check-version saw a real store: never fall back to the stub for this job.
          if (!real && sawRealStore(a)) throw new JobError('temporary', 'The store could not be found just now, so nothing was published. It will try again.');
          if (!real) return { liveUrl: `https://demo.invalid/${a.job.id}`, demo: true };
          const r = await publishWithCheck(real, { actor: { workspaceId: a.job.workspaceId, userId: 'publish-job' }, businessId: a.job.businessId ?? '', storeSlug: str(a.input, 'storeSlug', '') });
          // A conflict or "please try again" is temporary: the job retries with backoff instead of failing for good.
          if (!r.ok && r.retryable) throw new JobError('temporary', r.message);
          // Everything else is recorded as this step's result (also a failed check, with its structured lists) and judged by the next step.
          const lists = {
            checks: r.checks.map((c) => ({ check: c.check, detail: c.detail })),
            skipped: r.skipped.map((c) => ({ check: c.check, detail: c.detail })),
            failed: r.ok ? [] : r.failed.map((f) => ({ check: f.check, reason: f.reason })),
          };
          if (r.ok) return { published: true, outcome: r.outcome, version: r.version, ...lists };
          return {
            published: false, outcome: r.outcome, message: r.message, version: r.version ?? null, rolledBackTo: r.rolledBackTo ?? null,
            rollbackErrors: r.rollbackErrors ?? [], ...lists,
          };
        })),
        // The real result of the check: it fails the job when the publish did not pass, and says honestly when checkout was not tested.
        step('publish-site', 'smoke-test', async (a): Promise<JsonValue> => {
          const p = a.outputs.publish;
          const rec = p !== null && typeof p === 'object' && !Array.isArray(p) ? p : undefined;
          // The publish step said it was a demo stub (nothing real was published): so is this result. Decided from the recorded output, not re-resolved.
          if (!deps.publishSite && !deps.publishSiteFor) return { smokeTest: 'pass', demo: true };
          if (rec?.demo === true && sawRealStore(a)) throw new JobError('temporary', 'The store could not be found just now, so nothing was published or checked. It will try again.');
          if (rec?.demo === true) return { smokeTest: 'pass', demo: true };
          if (!rec || rec.published !== true) {
            throw new JobError('permanent', rec && typeof rec.message === 'string' && rec.message ? rec.message : 'The publish check did not pass, so the store was not confirmed live.');
          }
          const checks = Array.isArray(rec.checks) ? rec.checks : [];
          const checkoutTested = checks.some((c) => c !== null && typeof c === 'object' && !Array.isArray(c) && typeof c.check === 'string' && c.check.startsWith('checkout:'));
          return { smokeTest: 'pass', checks: checks.length, checkout: checkoutTested ? 'passed' : 'skipped', skipped: Array.isArray(rec.skipped) ? rec.skipped : [] };
        }),
      ],
    },
    {
      kind: 'fulfil-order',
      steps: [
        // DEMO stubs. TODO(AMP-041/AMP-042 fulfilment): verify the paid Stripe event, create the download grant, send the real email.
        step('fulfil-order', 'verify-payment', async (a) => ({ orderId: str(a.input, 'orderId', 'demo-order'), paid: true, demo: true })),
        step('fulfil-order', 'grant-download', (a) => once(a, 'files.grant', async () => ({ grant: `grant-${a.job.id}`, demo: true }))),
        step('fulfil-order', 'email-buyer', (a) => once(a, 'email.send', async () => {
          const m = await need(providers.email.adapter, 'Email').send({ to: str(a.input, 'buyerEmail', 'buyer@example.invalid'), subject: 'Your download is ready', text: 'Demo delivery email.', idempotencyKey: a.idempotencyKey });
          return { messageId: m.id, demo: true };
        })),
      ],
    },
    {
      kind: 'scheduled-post',
      steps: [
        step('scheduled-post', 'prepare-post', async (a) => ({ title: str(a.input, 'title', 'Demo pin'), link: str(a.input, 'link', 'https://demo.invalid/product'), demo: true })),
        // TODO(AMP-052 posts): publish through the real Pinterest adapter once connected; the fixture only queues.
        step('scheduled-post', 'publish-post', (a) => once(a, 'social.queuePost', async () => {
          const p = a.outputs['prepare-post'] as { title: string; link: string };
          const post = await need(providers.social.adapter, 'Pinterest').queuePost({ title: p.title, link: p.link, imageUrl: 'https://demo.invalid/pin.png', idempotencyKey: a.idempotencyKey });
          return { postId: post.id, demo: true };
        })),
      ],
    },
  ];
}
