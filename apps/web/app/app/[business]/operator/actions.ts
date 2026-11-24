'use server';
// The one server action this page adds. It holds no rules: `runOperatorOp` (see _server/operator-guard.ts) checks the request and
// calls the automation service's retryJob. The workspace and the actor are the server's own constants; the op from the browser only
// names a run. The automation source is the Approvals page's, so both pages read the same store.
import { automationSource } from '../approvals/_server/source';
import { runOperatorOp } from './_server/operator-guard';
import type { OperatorReply } from './_server/operator-guard';
import { availability, OWNER, runtime, WORKSPACE } from '../../../start/_server/runtime';

export async function operatorAction(businessId: string, rawOp: unknown): Promise<OperatorReply> {
  return runOperatorOp({ availability: availability(), rt: runtime, deps: { automation: automationSource(), workspaceId: WORKSPACE, actorUserId: OWNER } }, businessId, rawOp);
}
