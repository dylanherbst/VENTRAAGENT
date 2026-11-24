'use server';
// The one server action this page adds: a read-only preview. Saving and approving use the existing `brandAction`
// (app/start/actions.ts) unchanged. Same DEMO runtime and the same switch as /start and the overview.
// The checks live in `_server/brand-guard.ts` so the node tests can call them; this file is only the glue.
import { availability, brandCtx, runtime } from '../../../start/_server/runtime';
import { runBrandPreview } from './_server/brand-guard';
import type { ClientBrandPreview } from './_server/brand-guard';

export async function previewBrandAction(businessId: string, edits: unknown): Promise<ClientBrandPreview> {
  return runBrandPreview({ availability: availability(), rt: runtime, ctx: brandCtx }, businessId, edits);
}
