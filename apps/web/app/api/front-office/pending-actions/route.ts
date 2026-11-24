import { NextRequest, NextResponse } from 'next/server';
import { workspaceLimits } from '../../../../lib/rate-limit';
import { apiReply, isResponse, openWorkspace, preflight, privateHeaders } from '../../../../lib/workspace-route';
import { pendingActionStatuses } from '../../../../lib/front-office/contracts';
import type { PendingActionStatus } from '../../../../lib/front-office/contracts';
import { listPendingActions } from '../../../../lib/front-office/pending-actions';
import { memberStore, publicItem, queueError } from './shared';
export const dynamic = 'force-dynamic';

// The owner approval queue of one business (task A-21).
//   GET /api/front-office/pending-actions?workspace=<id>[&status=pending][&limit=100]   any member, newest first.
// Overdue items are expired first, so an item past its expiry is never listed as pending.
export async function GET(req: NextRequest) {
  const pre = preflight(req, { signedOut: 'Sign in to see what is waiting for you.' });
  if (isResponse(pre)) return pre;
  const ws = await openWorkspace(req, pre.token, workspaceLimits.settings);
  if (isResponse(ws)) return ws;
  const s = req.nextUrl.searchParams.get('status');
  if (s !== null && !(pendingActionStatuses as readonly string[]).includes(s)) return apiReply('invalid_request', 'Unknown status.');
  const l = req.nextUrl.searchParams.get('limit');
  const limit = l === null ? 100 : Number(l);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return apiReply('invalid_request', 'Limit must be 1 to 500.');
  try {
    const items = await listPendingActions(memberStore(ws), { status: (s ?? undefined) as PendingActionStatus | undefined, limit });
    return NextResponse.json({ items: items.map(publicItem) }, { headers: privateHeaders });
  } catch (e) { return queueError(e); }
}
