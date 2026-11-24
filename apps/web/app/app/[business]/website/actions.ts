'use server';
// The one server action this page adds. It changes nothing itself: it checks the request (see _server/website-guard.ts), then hands
// the op to the existing `storeAction` (app/start/actions.ts), the same path guided set-up uses to save, preview, publish and restore
// through the AMP-031 site-version store. There is no second publish path here.
import { availability, runtime, siteActor } from '../../../start/_server/runtime';
import { storeAction } from '../../../start/actions';
import { guardWebsiteOp } from './_server/website-guard';
import { buildPreview } from './view-model';
import type { PreviewModel } from './view-model';

export interface WebsiteReply { ok: boolean; message: string; errors: string[]; preview: PreviewModel | null }

export async function websiteAction(businessId: string, rawOp: unknown): Promise<WebsiteReply> {
  const g = await guardWebsiteOp({ availability: availability(), rt: runtime, actor: siteActor }, businessId, rawOp);
  if (!g.ok) return { ok: false, message: g.message, errors: g.errors ?? [], preview: null };
  const r = await storeAction(businessId, g.op);
  const preview = g.op.kind === 'preview' && r.ok && r.state.site?.preview ? buildPreview(r.state.site.preview) : null;
  return { ok: r.ok, message: r.message, errors: r.errors, preview };
}
