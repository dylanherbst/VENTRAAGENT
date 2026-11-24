// HTTP handlers for the fulfilment routes (AMP-042). Plain Request -> Response so they are unit-tested without a server.
// Errors are short and never echo input, secrets or internals. Every handler fails closed: no service -> 503, wrong origin -> 403,
// no signed-in store owner -> 401.
import type { FulfilmentService } from './service.ts';
import type { FulfilOutcome, ReissueRefusal, StoreScope } from './types.ts';

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: HEADERS });

export type FulfilmentLookup = () => Promise<FulfilmentService | null> | FulfilmentService | null;
/** True only for a same-origin JSON request. The route supplies the real check; a missing check refuses everything. */
export type OriginCheck = (request: Request) => boolean;
/** Resolves the signed-in owner/support user to ONE store. Null when signed out or not allowed. Never reads ids from the body. */
export type Authorize = (request: Request) => Promise<StoreScope | null> | StoreScope | null;

const MAX_BODY_BYTES = 4_096;
const MAX_EVENT_BYTES = 65_536;

async function readText(request: Request, max: number): Promise<string | null> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > max) return null;
  const text = await request.text();
  return text.length > max ? null : text;
}
async function service(get: FulfilmentLookup): Promise<FulfilmentService | null> {
  try { return await get(); } catch { return null; }
}
async function readJson(request: Request): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  let text: string | null;
  try { text = await readText(request, MAX_BODY_BYTES); } catch { return { error: json(400, { error: 'Could not read the request.' }) }; }
  if (text === null) return { error: json(413, { error: 'That request is too large.' }) };
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { error: json(400, { error: 'Send a JSON object.' }) };
    return { body: v as Record<string, unknown> };
  } catch { return { error: json(400, { error: 'Send JSON.' }) }; }
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** POST refund / dispute events. Reads the RAW body (the signature covers the exact bytes). */
export function createRefundWebhookHandler(get: FulfilmentLookup) {
  return async function POST(request: Request): Promise<Response> {
    const svc = await service(get);
    if (!svc) return json(503, { error: 'Webhooks are not available right now.' });
    let raw: string | null;
    try { raw = await readText(request, MAX_EVENT_BYTES); } catch { return json(400, { error: 'Could not read the request.' }); }
    if (raw === null) return json(413, { error: 'That request is too large.' });
    const r = await svc.handleRefundEvent({ rawBody: raw, signature: request.headers.get('stripe-signature') });
    if (r.outcome === 'bad_signature' || r.outcome === 'invalid') return json(400, { received: false, error: 'Rejected.' });
    // Everything else is acknowledged so the provider stops retrying. The order id is not echoed.
    return json(200, { received: true, outcome: r.outcome });
  };
}

/** POST { storeSlug, reference, email } -> the buyer's own order, or one generic 404. */
export function createBuyerLookupHandler(get: FulfilmentLookup, opts: { originOk: OriginCheck }) {
  return async function POST(request: Request): Promise<Response> {
    const svc = await service(get);
    if (!svc) return json(503, { error: 'Order lookup is not available right now.' });
    if (!opts.originOk(request)) return json(403, { error: 'Use the store page to look up an order.' });
    const read = await readJson(request);
    if ('error' in read) return read.error;
    let view;
    try {
      view = await svc.lookupBuyerOrder({ storeSlug: str(read.body.storeSlug), reference: str(read.body.reference), email: str(read.body.email) });
    } catch { return json(500, { error: 'Something went wrong.' }); }
    if (!view) return json(404, { error: 'No order matches that reference and email.' });
    return json(200, { order: view });
  };
}

const REISSUE_STATUS: Record<ReissueRefusal, number> = {
  invalid: 400, order_not_found: 404, order_not_paid: 409, order_refunded: 409, not_deliverable: 409, email_failed: 502, email_unavailable: 503, in_progress: 409,
};
const RETRY_STATUS: Record<FulfilOutcome, number> = {
  delivered: 200, already_delivered: 200, in_progress: 202, failed: 502, needs_review: 409, retries_exhausted: 409, revoked: 409,
  order_not_found: 404, order_not_paid: 409, invalid: 400,
};

/**
 * POST { action: 'reissue' | 'retry' | 'orders', orderId?, reason? } for the signed-in store owner / support user.
 * The store comes from `authorize` (the session), never from the body, so one store cannot act on another's orders.
 */
export function createSupportHandler(get: FulfilmentLookup, opts: { originOk: OriginCheck; authorize: Authorize }) {
  return async function POST(request: Request): Promise<Response> {
    const svc = await service(get);
    if (!svc) return json(503, { error: 'Order support is not available right now.' });
    if (!opts.originOk(request)) return json(403, { error: 'Use same-origin JSON.' });
    let scope: StoreScope | null;
    try { scope = await opts.authorize(request); } catch { scope = null; }
    if (!scope) return json(401, { error: 'Sign in as the store owner to do this.' });
    const read = await readJson(request);
    if ('error' in read) return read.error;
    const action = str(read.body.action);
    try {
      if (action === 'orders') return json(200, { orders: await svc.listStoreOrders(scope) });
      if (action === 'reissue') {
        // Optional `requestKey`: the same key sent twice (a double click, a retried request) emails one link.
        const requestKey = read.body.requestKey;
        if (requestKey !== undefined && typeof requestKey !== 'string') return json(400, { error: 'Give the order reference and a short reason.', code: 'invalid' });
        const r = await svc.reissueAccess(scope, { orderId: str(read.body.orderId), reason: str(read.body.reason), ...(requestKey !== undefined ? { requestKey } : {}) });
        if (!r.ok) return json(REISSUE_STATUS[r.code], { error: r.message, code: r.code });
        return json(200, { ok: true, status: r.fulfilment.status, reissues: r.fulfilment.reissues, ...(r.duplicate ? { duplicate: true } : {}) });
      }
      if (action === 'retry') {
        const r = await svc.retryDelivery(scope, str(read.body.orderId));
        return json(RETRY_STATUS[r.outcome], { outcome: r.outcome, status: r.fulfilment?.status ?? null, attempts: r.fulfilment?.attempts ?? 0 });
      }
    } catch { return json(500, { error: 'Something went wrong. Nothing was sent.' }); }
    return json(400, { error: 'Unknown action.' });
  };
}
