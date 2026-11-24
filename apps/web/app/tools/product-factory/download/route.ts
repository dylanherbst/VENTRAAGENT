import { downloadResponse } from '../../../../lib/aimp/factory/request.ts';

export const dynamic = 'force-dynamic';

// Download route for the Product Factory test page: builds the real product on the server and returns the PDF or ZIP.
// The behaviour lives in downloadResponse (lib) so it is unit-tested.
export async function GET(request: Request): Promise<Response> {
  return downloadResponse(request.url, process.env);
}
