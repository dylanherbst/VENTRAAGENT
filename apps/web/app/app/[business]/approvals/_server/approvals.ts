// Server read for Approvals and activity (screen 35, AMP-127). A plain function that takes the /start runtime and the automation
// source as arguments, so it runs in the node tests without Next. No new backend: everything comes from the automation service
// (lib/aimp/automation: getSettings, approvals, activity). The workspace and the actor come from the server (`ApprovalsDeps`), the
// business from the route after the known-business check; nothing is taken from a request body.
//
// The /start runtime itself carries no automation store. The page passes the automation demo's service (as the Overview and the
// Dashboard do); when no source is passed the answer is `unavailable` and the page says so, never an empty list that looks real.
import type { OperationContext } from '../../../../../lib/aimp/contracts.ts';
import type { AutomationService } from '../../../../../lib/aimp/automation/service.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { ACTIVITY_LIMIT } from '../view-model.ts';
import type { ApprovalsData } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type ApprovalsRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'>;

export interface ApprovalsDeps {
  /** Null when this runtime has no automation store. Called only after the business has passed its checks. */
  automation: (() => AutomationService) | null;
  /** Server-side constants (app/start/_server/runtime.ts: WORKSPACE, OWNER). */
  workspaceId: string;
  actorUserId: string;
}

/** The only place an automation context is built for this page: workspace and actor from the server, business already checked. */
export const automationContext = (d: Pick<ApprovalsDeps, 'workspaceId' | 'actorUserId'>, businessId: string): OperationContext => ({
  workspaceId: d.workspaceId, businessId, actorUserId: d.actorUserId, idempotencyKey: `approvals:${businessId}`.slice(0, 99),
});

export type ApprovalsLookup =
  | { found: false }
  /** The business exists but there is no automation store to read (not zero approvals: unknown). */
  | { found: true; state: 'unavailable' }
  | { found: true; state: 'ready'; data: ApprovalsData };

/**
 * One call for the page. An unknown business (which is how another workspace's business looks in this runtime) answers
 * `found: false` before the automation service is touched.
 */
export async function loadApprovals(rt: ApprovalsRuntime, deps: ApprovalsDeps, businessId: string): Promise<ApprovalsLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  if (!deps.automation) return { found: true, state: 'unavailable' };
  const automation = deps.automation();
  const ctx = automationContext(deps, businessId);
  // Approvals first: reading them expires any that ran out of time, so the settings and the activity read after it agree.
  const approvals = await automation.approvals(ctx);
  const settings = await automation.getSettings(ctx);
  const feed = await automation.activity(ctx, { limit: ACTIVITY_LIMIT + 1 });
  return { found: true, state: 'ready', data: { settings, approvals, activity: feed.entries } };
}
