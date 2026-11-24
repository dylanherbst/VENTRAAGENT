import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../../lib/supabase/client';
import { sameOrigin } from '../../../../lib/request-security';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../../lib/request-body';
import { checkedDraftRaw, checkedKind, launcherDraftByteLimit } from '../../../../lib/launcher-drafts';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { isPlainObject, isSameOriginJson, safeInteger } from '../../../../lib/api-errors';
import { apiReply, supabaseConfigured } from '../../../../lib/workspace-route';
import { uuid } from '../../../../lib/workspace-validation';
import { frozenKindReply } from '../../../../lib/scope-freeze';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store, private' };
async function handle(req: NextRequest) {
  const ok = (body: unknown) => NextResponse.json(body, { headers: noStore });
  if (req.method === 'POST' && !isSameOriginJson(req.headers, (o, h) => sameOrigin(o, h, req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN))) return apiReply('forbidden_origin', 'Use same-origin JSON.');
  if (!supabaseConfigured()) return apiReply('not_configured', 'Account storage is not configured. Browser drafts are unchanged.', { configured: false });
  const token = req.cookies.get('lp-access')?.value;
  if (!token) return apiReply('signed_out', 'Sign in to use account storage.');
  try {
    const auth = await createSupabaseClient().auth.getUser(token);
    if (auth.error || !auth.data.user) return apiReply('signed_out', 'Sign in again.');
    const rate = workspaceLimits.launcher(auth.data.user.id);
    if (!rate.allowed) return apiReply('rate_limited', 'Too many requests. Try again shortly.', {}, { 'Retry-After': String(rate.retryAfterSeconds) });
    const db = createSupabaseClient({ fetch: (url, init) => { const headers = new Headers(init?.headers); headers.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers, cache: 'no-store' }); } });
    const active = await db.rpc('session_active');
    if (active.error) return apiReply('storage_unavailable', 'Account storage is unavailable. Please retry.');
    if (!active.data) return apiReply('session_revoked', 'Session revoked. Sign in again.');
    if (req.method === 'GET') {
      const w = uuid(req.nextUrl.searchParams.get('workspace'));
      const kind = checkedKind(req.nextUrl.searchParams.get('kind'));
      const pausedGet = frozenKindReply(kind); if (pausedGet) return pausedGet;
      const result = await db.from('launcher_drafts').select('data,revision,updated_at').eq('workspace_id', w).eq('kind', kind).maybeSingle();
      return result.error ? apiReply('storage_unavailable', 'Unable to load the account draft. Check that the database is up to date.') : ok({ draft: result.data });
    }
    const input = JSON.parse(await readBoundedRequestBody(req, launcherDraftByteLimit + 4096));
    if (!isPlainObject(input)) return apiReply('invalid_request', 'Invalid request. Review the fields.');
    const w = uuid(input.workspace), kind = checkedKind(input.kind);
    const paused = frozenKindReply(kind); if (paused) return paused;
    const revision = safeInteger(input.revision);
    if (revision === null) return apiReply('invalid_request', 'Refresh before saving.');
    if (input.action === 'delete') {
      const result = await db.rpc('delete_launcher_draft', { w, draft_kind: kind, expected_revision: revision });
      return result.error ? apiReply('conflict', 'Delete not committed. Check owner access and refresh the revision.') : ok({ deleted: true });
    }
    if (input.action !== 'save') return apiReply('invalid_request', 'Unknown action.');
    const payload = checkedDraftRaw(JSON.stringify(input.draft));
    const result = await db.rpc('save_launcher_draft', { w, draft_kind: kind, payload, expected_revision: revision });
    return result.error ? apiReply('conflict', 'Save not committed. Check owner access and refresh the revision; your local draft is unchanged.') : ok({ saved: true, revision: result.data });
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return apiReply('too_large', 'Request too large.');
    return apiReply('invalid_request', error instanceof Error && /^(Unknown launcher|Draft |Choose a valid)/.test(error.message) ? error.message : 'Invalid request. Review the fields.');
  }
}
export const GET = handle;
export const POST = handle;
