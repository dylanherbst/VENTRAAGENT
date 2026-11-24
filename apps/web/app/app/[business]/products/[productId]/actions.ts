'use server';
// The one server action this page adds. It builds, approves and prices nothing itself: it checks the request (see
// _server/editor-guard.ts), then hands it to the existing /start actions, which run the product service and the catalogue service:
//   approve a product version, build a new version -> `productsAction`
//   write, save, update or approve the listing and price -> `catalogueAction`
import { availability, productCtx, runtime } from '../../../../start/_server/runtime';
import { catalogueAction, productsAction } from '../../../../start/actions';
import { guardEditorOp } from './_server/editor-guard';

export interface EditProductReply { ok: boolean; message: string; errors: string[] }

export async function editProductAction(businessId: string, productId: string, op: unknown): Promise<EditProductReply> {
  const g = await guardEditorOp({ availability: availability(), rt: runtime, ctx: { productCtx } }, businessId, productId, op);
  if (!g.ok) return { ok: false, message: g.message, errors: [] };
  const r = g.delegate.target === 'products' ? await productsAction(businessId, g.delegate.op) : await catalogueAction(businessId, g.delegate.op);
  return { ok: r.ok, message: r.message, errors: r.errors };
}
