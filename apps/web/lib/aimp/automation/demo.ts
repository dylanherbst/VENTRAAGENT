// Demo wiring (fixtures only) for /tools/aimp-automation: the real automation service over the real in-memory job engine with
// fixture providers. Kept on globalThis so it survives hot reloads. "other-business" is a second business in the SAME workspace,
// used to show that nothing leaks between businesses.
import type { OperationContext } from '../contracts.ts';
import { createDemoJobs } from '../jobs/demo.ts';
import type { DemoJobs } from '../jobs/demo.ts';
import { createAutomationService } from './service.ts';
import type { AutomationService } from './service.ts';
import { createMemoryAutomationStore } from './store.ts';

export const AUTOMATION_WORKSPACE = 'demo-workspace';
export const AUTOMATION_BUSINESS = 'demo-business';
export const OTHER_BUSINESS = 'other-business';
export const DEMO_CAP = 3;
export const MAX_DEMO_ACTIONS = 40;
export const automationCtx = (key: string, businessId: string = AUTOMATION_BUSINESS): OperationContext => ({
  workspaceId: AUTOMATION_WORKSPACE, businessId, actorUserId: businessId === AUTOMATION_BUSINESS ? 'demo-merchant' : 'other-merchant', idempotencyKey: key,
});

export interface DemoAutomation { automation: AutomationService; jobs: DemoJobs; actions: { count: number } }

export function createDemoAutomation(env: Readonly<Record<string, string | undefined>> = process.env): DemoAutomation {
  const jobs = createDemoJobs(env);
  const automation = createAutomationService({ store: createMemoryAutomationStore(), jobs: jobs.service, now: jobs.clock.now, defaultCap: DEMO_CAP });
  return { automation, jobs, actions: { count: 0 } };
}

type G = typeof globalThis & { __aimpAutomationDemo?: DemoAutomation };
export function demoAutomation(): DemoAutomation {
  const g = globalThis as G;
  g.__aimpAutomationDemo ??= createDemoAutomation();
  return g.__aimpAutomationDemo;
}
