import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { sameOrigin } from '../../../../lib/request-security';
import { readBoundedRequestBody } from '../../../../lib/request-body';
import { isPlainObject, isSameOriginJson } from '../../../../lib/api-errors';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../lib/workspace-route';
import { DEFAULT_OPERATING_MODE, isOperatingMode, parseOperatingModes } from '../../../../lib/front-office/contracts';
import type { OperatingModes } from '../../../../lib/front-office/contracts';
export const dynamic = 'force-dynamic';

// The operating mode of the AI Setter and AI Receptionist for one business (task A-21; RPCs in migration 202611100001).
//   GET /api/front-office/modes?workspace=<id>   any member: {modes, revision, updatedAt}
//   PUT /api/front-office/modes?workspace=<id>   owner only: {modes: {setter, receptionist}, revision} -> {modes, revision}
// Modes: automatic | owner_approval | enquiry_only. Anything else is refused. Non-members get the same generic 403.
const NO_ACCESS = 'Workspace access is unavailable.';

export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see your AI team.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  const r = await ws.db.rpc('fo_get_operating_modes', { w: ws.workspace });
  if (r.error) return /Workspace access|permission denied/.test(r.error.message) ? apiReply('no_workspace_access', NO_ACCESS) : apiReply('storage_unavailable', 'Unable to load the AI modes. Check that the database is up to date.');
  const d = (r.data ?? {}) as { modes?: Record<string, unknown>; revision?: unknown; updatedAt?: unknown };
  // A stored value the app does not know is shown as the safe default, the same way the permission check reads it.
  const modes: OperatingModes = {
    setter: isOperatingMode(d.modes?.setter) ? d.modes.setter : DEFAULT_OPERATING_MODE,
    receptionist: isOperatingMode(d.modes?.receptionist) ? d.modes.receptionist : DEFAULT_OPERATING_MODE,
  };
  return NextResponse.json({ modes, revision: Number.isInteger(d.revision) ? d.revision : 0, updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null }, { headers: privateHeaders });
}

export async function PUT(req: NextRequest) {
  if (!isSameOriginJson(req.headers, (o, h) => sameOrigin(o, h, req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN))) return apiReply('forbidden_origin', 'Use same-origin JSON.');
  const pre = preflight(req, { signedOut: 'Sign in to change your AI team.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  let input: unknown;
  try { input = JSON.parse(await readBoundedRequestBody(req, 4_000)); } catch { return apiReply('invalid_request', 'Invalid request.'); }
  if (!isPlainObject(input) || !Number.isInteger(input.revision) || (input.revision as number) < 0) return apiReply('invalid_request', 'Invalid request.');
  const parsed = parseOperatingModes(input.modes);
  if (!parsed.ok) return apiReply('invalid_request', 'Choose Automatic, Owner approval or Enquiry only for both the Setter and the Receptionist.');
  const modes = parsed.value;
  const r = await ws.db.rpc('fo_save_operating_modes', { w: ws.workspace, setter: modes.setter, receptionist: modes.receptionist, expected_revision: input.revision });
  if (r.error) {
    const m = r.error.message;
    if (/Owner access|Workspace access|permission denied/.test(m)) return apiReply('no_workspace_access', 'Only the workspace owner can change the AI modes.');
    if (/changed elsewhere/.test(m)) return apiReply('conflict', 'The modes were changed elsewhere. Reload and try again.');
    if (/business settings first/.test(m)) return apiReply('conflict', 'Save the business settings first.');
    if (/Unknown operating mode/.test(m)) return apiReply('invalid_request', 'Unknown operating mode.');
    return apiReply('storage_unavailable', 'Unable to save the AI modes.');
  }
  return NextResponse.json({ modes, revision: r.data as number, saved: true }, { headers: privateHeaders });
}
