import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { sameOrigin } from '../../../../lib/request-security';
import { MAX_JSON_BODY_BYTES, RequestBodyTooLarge, readBoundedRequestBody } from '../../../../lib/request-body';
import { isPlainObject, isSameOriginJson } from '../../../../lib/api-errors';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../lib/workspace-route';
import { checkedAgentSettings, templateSettings, templates } from '../../../../lib/front-office/settings';
import type { TemplateId } from '../../../../lib/front-office/settings';
export const dynamic = 'force-dynamic';
/** Largest settings save body, in bytes (256,000: the shared JSON cap). */
const SETTINGS_MAX_BYTES = MAX_JSON_BODY_BYTES;

// The AI Setter and Receptionist settings for one business (workspace owners only: fo_get/save_agent_settings).
//   GET  /api/front-office/settings?workspace=<id>[&template=gym]   saved settings, or the template to start from
//   POST /api/front-office/settings?workspace=<id>  {settings, revision}   save (revision 0 = first save);
//        settings.knowledge omitted: the stored knowledge base is kept
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to edit your AI team.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  const r = await ws.db.rpc('fo_get_agent_settings', { w: ws.workspace });
  if (r.error) return /Owner access/.test(r.error.message) ? apiReply('no_workspace_access', 'Only the workspace owner can edit the AI team.') : apiReply('storage_unavailable', 'Unable to load settings. Check that the database is up to date.');
  const saved = r.data as { data: unknown; revision: number; updatedAt: string } | null;
  const t = req.nextUrl.searchParams.get('template');
  const template: TemplateId = templates.includes(t as TemplateId) ? t as TemplateId : 'gym';
  if (!saved) return NextResponse.json({ settings: templateSettings(template), revision: 0, saved: false }, { headers: privateHeaders });
  let settings;
  try { settings = checkedAgentSettings(saved.data); } catch { settings = saved.data; }
  return NextResponse.json({ settings, revision: saved.revision, updatedAt: saved.updatedAt, saved: true }, { headers: privateHeaders });
}

export async function POST(req: NextRequest) {
  if (!isSameOriginJson(req.headers, (o, h) => sameOrigin(o, h, req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN))) return apiReply('forbidden_origin', 'Use same-origin JSON.');
  const pre = preflight(req, { signedOut: 'Sign in to edit your AI team.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  let input: unknown;
  // A-36: the cap fits a maximum-size knowledge base (checkedKnowledge limits) plus every other field, about 150 KB.
  // Over it: 413 too_large with a plain message, never a vague "Invalid request".
  try { input = JSON.parse(await readBoundedRequestBody(req, SETTINGS_MAX_BYTES)); } catch (e) {
    return e instanceof RequestBodyTooLarge ? apiReply('too_large', 'These settings are too large to save (over 256 KB). Shorten some service, offer, policy or FAQ text and try again.') : apiReply('invalid_request', 'Invalid request.');
  }
  if (!isPlainObject(input) || !Number.isInteger(input.revision) || (input.revision as number) < 0) return apiReply('invalid_request', 'Invalid request.');
  let body = input.settings;
  // A-30: settings without a `knowledge` key keep the stored knowledge base (a form that does not edit it must not wipe
  // it). A `knowledge` key present replaces it; empty lists or null clear it. Nothing stored yet: empty lists.
  if (isPlainObject(body) && !Object.hasOwn(body, 'knowledge')) {
    const cur = await ws.db.rpc('fo_get_agent_settings', { w: ws.workspace });
    if (cur.error) return /Owner access/.test(cur.error.message) ? apiReply('no_workspace_access', 'Only the workspace owner can edit the AI team.') : apiReply('storage_unavailable', 'Unable to load settings. Check that the database is up to date.');
    const stored = (cur.data as { data?: unknown } | null)?.data;
    body = { ...body, knowledge: isPlainObject(stored) ? stored.knowledge ?? null : null };
  }
  let settings;
  try { settings = checkedAgentSettings(body); } catch (e) { return apiReply('invalid_request', e instanceof Error ? e.message : 'Check the settings.'); }
  const r = await ws.db.rpc('fo_save_agent_settings', { w: ws.workspace, payload: settings, expected_revision: input.revision });
  if (r.error) {
    if (/Owner access/.test(r.error.message)) return apiReply('no_workspace_access', 'Only the workspace owner can edit the AI team.');
    if (/changed elsewhere/.test(r.error.message)) return apiReply('conflict', 'Settings were changed elsewhere. Reload and try again.');
    return apiReply('storage_unavailable', 'Unable to save settings.');
  }
  return NextResponse.json({ settings, revision: r.data as number, saved: true }, { headers: privateHeaders });
}
