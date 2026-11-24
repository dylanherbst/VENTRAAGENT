// Owner-only download of the approved product, so the seller can open exactly what buyers will get. Not a public link: buyers get the
// file only through the paid-order delivery link.
import { availability, checkBusiness } from '../../../../start/_server/runtime';
import { approvedProduct } from '../../../../../lib/aimp/offers/store';
import { renderProductPdf } from '../../../../../lib/aimp/factory/render';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ business: string }> }): Promise<Response> {
  const { business } = await ctx.params;
  if (!availability().available || !checkBusiness(business)) return new Response('Not found', { status: 404 });
  const p = approvedProduct(business);
  if (!p) return new Response('Nothing approved yet', { status: 404 });
  const size = new URL(req.url).searchParams.get('size') === 'letter' ? 'letter' : 'a4';
  const pdf = renderProductPdf(p.spec, size);
  return new Response(Buffer.from(pdf.bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' } });
}
