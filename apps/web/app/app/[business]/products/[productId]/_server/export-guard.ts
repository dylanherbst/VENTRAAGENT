// Every decision behind the product download route, as a plain function so the node tests load it (the route file imports next/server).
// Order: demo storage on (the same gate as the editor page), the business and product are this workspace's own, the request names a
// format, the product has a file to export, then the one export from lib/aimp/factory/export.ts. Nothing is written.
// An unknown business, a missing product and another business's product all get the SAME answer, so existence is never revealed.
// An archived product can still be opened in the editor (read only), so its download works too.
// The file comes from the version the editor shows as current: the approved one, else the newest.
import { exportProduct, exportRequestFromQuery } from '../../../../../../lib/aimp/factory/export.ts';
import { ProductFactoryError } from '../../../../../../lib/aimp/factory/generate.ts';
import { ProductError } from '../../../../../../lib/aimp/products/types.ts';
import { NO_BUSINESS, NO_PRODUCT, checkOwnProduct } from '../../_server/own-product.ts';
import type { EditorContexts, EditorRuntime } from './editor.ts';

export { NO_BUSINESS, NO_PRODUCT };
export const NOT_AVAILABLE = 'That download is not available for this product.';
export const BAD_FORMAT = 'Choose a download: xlsx or png.';
export const NO_SPEC = 'This product has no file to download yet.';

export interface ExportGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed. */
  rt: () => EditorRuntime;
  ctx: Pick<EditorContexts, 'productCtx'>;
}

/** What the route sends. A text body is the licence note. */
export type ExportDecision =
  | { ok: true; fileName: string; contentType: string; body: Uint8Array | string }
  | { ok: false; status: 400 | 404 | 422 | 503; message: string };

const refuse = (status: 400 | 404 | 422 | 503, message: string): ExportDecision => ({ ok: false, status, message });
const NOT_FOUND = refuse(404, NO_PRODUCT);

/** A file name that is safe inside a Content-Disposition header: letters, digits, dot, dash, underscore only. */
export function safeFileName(name: string, fallback = 'download'): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 100);
  return cleaned || fallback;
}

export function downloadHeaders(fileName: string, contentType: string, bytes: number): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${safeFileName(fileName)}"`,
    'Content-Length': String(bytes),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export async function decideExport(g: ExportGuardInput, rawBusinessId: unknown, rawProductId: unknown, query: { get(name: string): string | null }): Promise<ExportDecision> {
  if (!g.availability.available) return refuse(503, g.availability.reason);
  const own = checkOwnProduct(g.rt, rawBusinessId, rawProductId);
  if (!own.ok) return NOT_FOUND;
  const { rt, businessId, productId } = own;
  let versions;
  try {
    await rt.products.getProduct(g.ctx.productCtx, productId, businessId);
    versions = await rt.products.listVersions(g.ctx.productCtx, productId);
  } catch (e) {
    if (e instanceof ProductError && e.code === 'not_found') return NOT_FOUND;
    throw e;
  }
  if (versions.some((v) => v.businessId !== businessId || v.productId !== productId)) return NOT_FOUND;

  // The editor only ever asks for format (and part). width and accent are not accepted: they are ignored, never passed on.
  const req = exportRequestFromQuery({ get: (name) => (name === 'format' ? query.get('format') : null) });
  if (!req.ok) return refuse(400, BAD_FORMAT);
  const part = query.get('part');
  if (part !== null && part !== 'licence') return refuse(400, BAD_FORMAT);

  const current = versions.find((v) => v.status === 'approved') ?? versions[versions.length - 1];
  if (!current) return refuse(422, NO_SPEC);

  let out;
  try { out = exportProduct(current.spec, req.request); } catch (e) {
    if (e instanceof ProductFactoryError) return refuse(422, NOT_AVAILABLE);
    throw e;
  }
  if (!out.ok) return refuse(422, out.message);
  if (part === 'licence') return { ok: true, fileName: out.sidecar.fileName, contentType: out.sidecar.contentType, body: out.sidecar.text };
  return { ok: true, fileName: out.fileName, contentType: out.contentType, body: out.bytes };
}
