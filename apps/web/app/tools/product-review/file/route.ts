import { ProductError } from '../../../../lib/aimp/products/index.ts';
import { ctx, demoService, errText } from '../demo.ts';

export const dynamic = 'force-dynamic';

// SECURITY: `ctx` here is the fixed DEMO workspace. Before any non-demo use it MUST be derived from the signed-in
// session (verified user -> workspace membership), never from the URL or the browser.
// ?version=<id>  previews the exact bytes of that version (hash-verified), with its status in x-version-status.
// ?product=<id>  downloads what a buyer would receive: the approved, pinned version only.
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    const svc = demoService();
    const version = q.get('version');
    const f = version ? await svc.previewVersion(ctx, version) : await svc.getBuyerFile(ctx, q.get('product') ?? '');
    const headers: Record<string, string> = {
      'content-type': f.contentType,
      'content-disposition': `attachment; filename="${f.fileName}"`,
      'cache-control': 'no-store',
      'x-content-sha256': f.hash,
    };
    if ('status' in f && typeof f.status === 'string') headers['x-version-status'] = f.status;
    return new Response(Buffer.from(f.bytes), { headers });
  } catch (e) {
    const status = e instanceof ProductError && e.code === 'not_found' ? 404 : 422;
    return Response.json({ error: errText(e) }, { status });
  }
}
