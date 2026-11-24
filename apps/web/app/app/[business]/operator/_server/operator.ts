// Server read for Operator runs (screen 34, AMP-128). A plain function that takes the /start runtime and the automation source as
// arguments, so it runs in the node tests without Next. No new backend: the runs are the job rows of the automation service's
// activity (lib/aimp/automation: activity). The workspace and the actor come from the server (`OperatorDeps`), the business from the
// route after the known-business check; nothing is taken from a request body.
//
// The /start runtime itself carries no automation store. The page passes the same source the Approvals page uses; when no source is
// passed the answer is `unavailable` and the page says so, never an empty list that looks real.
import type { OperationContext } from '../../../../../lib/aimp/contracts.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { ApprovalsDeps, ApprovalsRuntime } from '../../approvals/_server/approvals.ts';
import { FEED_LIMIT, runsOf } from '../view-model.ts';
import type { OperatorData } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type OperatorRuntime = ApprovalsRuntime;
/** `automation` is null when this runtime has no automation store; workspace and actor are server constants. */
export type OperatorDeps = ApprovalsDeps;

/** The only place an automation context is built for this page: workspace and actor from the server, business already checked. */
export const operatorContext = (d: Pick<OperatorDeps, 'workspaceId' | 'actorUserId'>, businessId: string): OperationContext => ({
  workspaceId: d.workspaceId, businessId, actorUserId: d.actorUserId, idempotencyKey: `operator:${businessId}`.slice(0, 99),
});

export type OperatorLookup =
  | { found: false }
  /** The business exists but there is no automation store to read (not zero runs: unknown). */
  | { found: true; state: 'unavailable' }
  | { found: true; state: 'ready'; data: OperatorData };

/**
 * One call for the page. An unknown business (which is how another workspace's business looks in this runtime) answers
 * `found: false` before the automation service is touched. Only job rows are handed on.
 */
export async function loadOperator(rt: OperatorRuntime, deps: OperatorDeps, businessId: string): Promise<OperatorLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  if (!deps.automation) return { found: true, state: 'unavailable' };
  const feed = await deps.automation().activity(operatorContext(deps, businessId), { limit: FEED_LIMIT });
  return { found: true, state: 'ready', data: { entries: runsOf(feed.entries) } };
}
