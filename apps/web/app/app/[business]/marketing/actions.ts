'use server';
// The one server action this page adds. All checks and both operations live in _server/marketing-guard.ts (`runMarketingOp`), which
// calls the campaign service (lib/aimp/campaigns). The workspace and the owner come from the server-side /start contexts, never from
// the request. Nothing is posted, scheduled or published from here.
import { storeEnv } from '../../../../lib/aimp/campaigns/demo';
import { availability, runtime } from '../../../start/_server/runtime';
import { runMarketingOp } from './_server/marketing-guard';
import type { MarketingReply } from './_server/marketing-guard';
import { marketingContexts } from './contexts';

export async function marketingAction(businessId: string, rawOp: unknown): Promise<MarketingReply> {
  return runMarketingOp({ availability: availability(), rt: runtime, ctx: marketingContexts(storeEnv(process.env)), now: () => new Date() }, businessId, rawOp);
}
