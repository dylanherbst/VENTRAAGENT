import { ProductFactoryError } from '../../../../lib/aimp/factory/generate';
import { renderSamplePdf } from '../../../../lib/aimp/factory/render';
import { ProductError } from '../../../../lib/aimp/products/types';
import { availability, checkBusiness, productCtx, runtime } from '../../_server/runtime';

export const dynamic = 'force-dynamic';

// File download for /start/products, the same behaviour as tools/product-review/file:
// ?b=<business>&version=<id>  the exact bytes of that version (hash-verified), with its status in x-version-status.
// ?b=<business>&product=<id>  what a buyer would receive: the approved, pinned version only.
// SECURITY: DEMO workspace only (see _server/runtime.ts). The business id comes from the browser and is only used to
// check the product was built for that business in this demo store; it is not an access control for real data.
export async function GET(request: Request): Promise<Response> {
  if (!availability().available) return Response.json({ error: 'Not found.' }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const businessId = q.get('b');
  const rt = runtime();
  const mine = checkBusiness(businessId) ? rt.productIds.get(businessId) ?? [] : [];
  try {
    const version = q.get('version');
    const product = q.get('product') ?? '';
    const owner = version ? mine.find((id) => version.startsWith(`${id}-v`)) : mine.find((id) => id === product);
    if (!owner) throw new ProductError('not_found', 'That file was not found.');
    if (q.get('sample') === '1' && version) {
      // The free sample: a short PDF drawn from that version's spec, for any status, so the owner can open it on a phone.
      const v = (await rt.products.listVersions(productCtx, owner)).find((x) => x.id === version);
      if (!v) throw new ProductError('not_found', 'That file was not found.');
      const sample = renderSamplePdf(v.spec, 'a4');
      return new Response(Buffer.from(sample.bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${sample.fileName}"`, 'cache-control': 'no-store' } });
    }
    const f = version ? await rt.products.previewVersion(productCtx, version) : await rt.products.getBuyerFile(productCtx, product);
    const headers: Record<string, string> = {
      'content-type': f.contentType,
      'content-disposition': `attachment; filename="${f.fileName}"`,
      'cache-control': 'no-store',
      'x-content-sha256': f.hash,
    };
    if ('status' in f && typeof f.status === 'string') headers['x-version-status'] = f.status;
    return new Response(Buffer.from(f.bytes), { headers });
  } catch (e) {
    const known = e instanceof ProductError || e instanceof ProductFactoryError;
    const status = e instanceof ProductError && e.code === 'not_found' ? 404 : 422;
    return Response.json({ error: known ? [e.message, ...e.problems].join(' ') : 'Something went wrong.' }, { status });
  }
}
