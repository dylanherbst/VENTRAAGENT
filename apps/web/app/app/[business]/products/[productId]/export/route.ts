import { availability, productCtx, runtime } from '../../../../../start/_server/runtime';
import { decideExport, downloadHeaders } from '../_server/export-guard';

export const dynamic = 'force-dynamic';

// GET ?format=xlsx|png (add &part=licence for the licence note as a text file). All decisions are in _server/export-guard.ts.
export async function GET(request: Request, { params }: { params: Promise<{ business: string; productId: string }> }) {
  const { business, productId } = await params;
  const { searchParams } = new URL(request.url);
  let d;
  try {
    d = await decideExport({ availability: availability(), rt: runtime, ctx: { productCtx } }, business, productId, searchParams);
  } catch (e) {
    console.error('[app product export] could not build the file:', e instanceof Error ? e.name : 'unknown error');
    return new Response('We could not build that download. Nothing was changed.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (!d.ok) return new Response(d.message, { status: d.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  const bytes = typeof d.body === 'string' ? new TextEncoder().encode(d.body) : d.body;
  return new Response(new Blob([bytes as BlobPart], { type: d.contentType }), { status: 200, headers: downloadHeaders(d.fileName, d.contentType, bytes.byteLength) });
}
