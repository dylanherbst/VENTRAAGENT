import { assetsRuntime } from '../../../../lib/aimp/campaign-assets/demo.ts';
import { exportCampaign } from '../../../../lib/aimp/campaign-assets/export.ts';

export const dynamic = 'force-dynamic';

// Download route for the campaign-assets test page: runs the real exportCampaign and returns the ZIP of approved assets.
// 404 in production unless AIMP_TOOLS_ENABLED=1. A refused export is a plain-text 409 with the reason.
export async function GET(): Promise<Response> {
  const p = assetsRuntime();
  if (!p) return new Response('Not found', { status: 404 });
  const rt = await p;
  const r = await exportCampaign(rt.deps, rt.scope, rt.campaignId);
  if (!r.ok) return new Response(r.errors.map((e) => e.message).join('\n'), { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(Buffer.from(r.zip), {
    status: 200,
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${r.fileName}"`, 'cache-control': 'no-store', 'x-publishing': r.publishing },
  });
}
