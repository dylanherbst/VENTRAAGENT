'use server';
// The one server action this page adds. All checks and all five operations live in _server/creative-guard.ts (`runCreativeOp`), which
// calls the campaign-assets service (lib/aimp/campaign-assets). The workspace and the owner come from the server-side /start contexts,
// never from the request. Nothing is posted, scheduled or published from here.
import { availability, runtime } from '../../../../start/_server/runtime';
import { marketingContexts } from '../contexts';
import { runCreativeOp } from './_server/creative-guard';
import type { CreativeReply } from './_server/creative-guard';

export async function creativeAction(businessId: string, rawOp: unknown): Promise<CreativeReply> {
  return runCreativeOp({ availability: availability(), rt: runtime, ctx: marketingContexts(), now: () => new Date() }, businessId, rawOp);
}
