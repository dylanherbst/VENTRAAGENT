import { createDownloadHandler } from '../../../../../../lib/aimp/files/handler.ts';
import type { FilesService } from '../../../../../../lib/aimp/files/service.ts';
import { fulfilmentRuntime } from '../../../../../../lib/aimp/fulfilment/demo.ts';

export const dynamic = 'force-dynamic';

// GET /api/aimp/fulfilment/download/<token>: the link inside the delivery email. The files service verifies the signed,
// purchase-bound grant (paid order, right tenant, approved version, not revoked/expired/over the limit) and streams the master
// as an attachment. Failures are a generic 404 or 410. DEMO serves the in-memory fixture file; in production (without
// AIMP_TOOLS_ENABLED=1) this answers 503 until live storage is wired.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  let files: FilesService | null = null;
  try { files = (await fulfilmentRuntime())?.world.files ?? null; } catch { files = null; }
  return createDownloadHandler(() => files)(request, ctx);
}
