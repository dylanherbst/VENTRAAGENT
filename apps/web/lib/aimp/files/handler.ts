// HTTP handler for GET /api/aimp/files/[token]. Streams the master as an attachment, or answers with a generic
// 404 / 410 that never says which check failed (the audit log has the reason code).
import type { FilesService } from './service.ts';
import { safeContentType } from './storage.ts';
import type { DenyReason } from './types.ts';

const BASE: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** Only a genuine, signed link can reach 410; everything else (tampered, other tenant, unpaid, unapproved, missing) is 404. */
const GONE: ReadonlySet<DenyReason> = new Set(['expired', 'revoked', 'limit_reached']);

export const safeFileName = (n: string): string => n.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'download';

function denied(status: 404 | 410): Response {
  return new Response(JSON.stringify({ error: status === 410 ? 'This link is no longer available.' : 'Not found.' }), {
    status, headers: { ...BASE, 'content-type': 'application/json' },
  });
}

export type FilesLookup = () => FilesService | null;

export function createDownloadHandler(get: FilesLookup) {
  return async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
    const unavailable = () => new Response(JSON.stringify({ error: 'Downloads are not available right now.' }), { status: 503, headers: { ...BASE, 'content-type': 'application/json' } });
    let svc: FilesService | null;
    try { svc = get(); } catch { return unavailable(); } // e.g. a configuration error: generic 503, no detail
    if (!svc) return unavailable();
    let token: string;
    try { token = (await ctx.params).token; } catch { return denied(404); }
    let r;
    try { r = await svc.redeem(token); } catch { return denied(404); }
    if (!r.ok) return denied(GONE.has(r.reason) ? 410 : 404);
    return new Response(Buffer.from(r.file.bytes), {
      status: 200,
      headers: {
        ...BASE,
        'content-type': safeContentType(r.file.contentType),
        'content-length': String(r.file.bytes.byteLength),
        'content-disposition': `attachment; filename="${safeFileName(r.file.fileName)}"`,
        'x-content-sha256': r.sha256,
      },
    });
  };
}
