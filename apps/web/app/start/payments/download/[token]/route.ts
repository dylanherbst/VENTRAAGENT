import { createDownloadHandler } from '../../../../../lib/aimp/files/handler';
import { availability, runtime } from '../../../_server/runtime';

export const dynamic = 'force-dynamic';

// GET /start/payments/download/<token>: the download link from a TEST purchase. It reads the same demo store the test purchase
// wrote to, so the signed, purchase-bound link opens the approved file. DEMO storage only; off when demo tools are off.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  return createDownloadHandler(() => (availability().available ? runtime().orderDemo.files : null))(request, ctx);
}
