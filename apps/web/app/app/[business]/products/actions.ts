'use server';
// The server actions of this page. "Add a product" builds nothing itself: it checks the request (see _server/create-guard.ts), then
// hands the business's saved idea to the existing `productsAction` (app/start/actions.ts), which builds the product, runs its checks
// and registers it. "Archive" and "Restore" (AMP-097) check the request and call the product service (see _server/archive.ts).
import { availability, productCtx, runtime } from '../../../start/_server/runtime';
import { productsAction } from '../../../start/actions';
import { runArchiveSafely } from './_server/archive';
import type { ArchiveReply } from './_server/archive';
import { guardCreate } from './_server/create-guard';

/** `op` is `{ kind: 'archive', confirm: true }` or `{ kind: 'restore' }`. An archive without the confirmation is refused. */
export async function archiveProductAction(businessId: string, productId: string, op: unknown): Promise<ArchiveReply> {
  return runArchiveSafely(() => ({ availability: availability(), rt: runtime, productCtx }), businessId, productId, op);
}

export interface CreateProductReply { ok: boolean; message: string; errors: string[] }

export async function createProductAction(businessId: string): Promise<CreateProductReply> {
  const g = guardCreate({ availability: availability(), rt: runtime }, businessId);
  if (!g.ok) return { ok: false, message: g.message, errors: [] };
  const r = await productsAction(businessId, { kind: 'create', blueprintId: g.seed.blueprintId, inputs: g.seed.inputs });
  return { ok: r.ok, message: r.message, errors: r.errors };
}
