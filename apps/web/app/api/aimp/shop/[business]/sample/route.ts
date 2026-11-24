// Public free sample (at most 3 pages) of the approved product. It is the real sample, not a mock-up. 404 until a product is approved.
import { availability, checkBusiness } from '../../../../../start/_server/runtime';
import { approvedProduct } from '../../../../../../lib/aimp/offers/store';
import { renderSamplePdf } from '../../../../../../lib/aimp/factory/render';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ business: string }> }): Promise<Response> {
  const { business } = await ctx.params;
  if (!availability().available || !checkBusiness(business)) return new Response('Not found', { status: 404 });
  const p = approvedProduct(business);
  if (!p) return new Response('Not found', { status: 404 });
  const pdf = renderSamplePdf(p.spec, 'a4');
  return new Response(Buffer.from(pdf.bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'public, max-age=60' } });
}
