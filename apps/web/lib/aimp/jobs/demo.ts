// Demo wiring (fixtures only) for /tools/aimp-jobs: in-memory store, fixture providers, a manual clock the page can advance,
// a fault plan and an effect log. Kept on globalThis so it survives hot reloads. Tenant "other-workspace" exists to show refusal.
import { createProviderRegistry } from '../providers/index.ts';
import { createEffectLog, createDemoJobDefinitions, createFaultPlan } from './handlers.ts';
import type { EffectLog, FaultPlan } from './handlers.ts';
import { createJobRegistry } from './registry.ts';
import { createJobRunner } from './runner.ts';
import type { JobRunner } from './runner.ts';
import { createJobService } from './service.ts';
import type { JobService } from './service.ts';
import { createMemoryJobStore } from './store.ts';
import type { OperationContext } from '../contracts.ts';

export const DEMO_WORKSPACE = 'demo-workspace';
export const OTHER_WORKSPACE = 'other-workspace';
export const MAX_DEMO_JOBS = 30;
export const demoCtx = (key: string): OperationContext => ({ workspaceId: DEMO_WORKSPACE, businessId: 'demo-business', actorUserId: 'demo-merchant', idempotencyKey: key });
export const otherCtx = (key: string): OperationContext => ({ workspaceId: OTHER_WORKSPACE, actorUserId: 'other-merchant', idempotencyKey: key });

export interface DemoJobs {
  service: JobService;
  runner: JobRunner;
  effects: EffectLog;
  faults: FaultPlan;
  providers: ReturnType<typeof createProviderRegistry>;
  /** Manual clock in epoch ms so backoff can be skipped on the page. */
  clock: { now: () => number; advance: (ms: number) => void };
}

export function createDemoJobs(env: Readonly<Record<string, string | undefined>> = process.env, opts: { honourKeys?: boolean } = {}): DemoJobs {
  const providers = createProviderRegistry({ env });
  let t = Date.parse('2026-11-14T09:00:00Z');
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const effects = createEffectLog({ honourKeys: opts.honourKeys });
  const faults = createFaultPlan();
  const store = createMemoryJobStore();
  const registry = createJobRegistry(createDemoJobDefinitions({ providers, effects, faults }));
  const service = createJobService({ store, registry, now: clock.now });
  const runner = createJobRunner({ store, registry, owner: 'demo-runner', now: clock.now, random: () => 0.5, leaseMs: 60_000 });
  return { service, runner, effects, faults, providers, clock };
}

type G = typeof globalThis & { __aimpJobsDemo?: DemoJobs };
export function demoJobs(): DemoJobs {
  const g = globalThis as G;
  g.__aimpJobsDemo ??= createDemoJobs();
  return g.__aimpJobsDemo;
}
