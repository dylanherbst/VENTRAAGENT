'use server';
// Inbox server actions. No rule lives here: the inbox service validates, drafts and decides. The workspace and owner are the server's own
// constants; the browser only names a business (checked), a message and a decision.
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { inboxFor } from '../../../start/_server/inbox-runtime';
import type { InboxRuntime } from '../../../start/_server/inbox-runtime';
import type { InboxResult } from '../../../../lib/aimp/storeops/inbox';

const off: InboxResult = { ok: false, code: 'invalid', message: 'The Inbox is not switched on here.' };
const unknown: InboxResult = { ok: false, code: 'not_found', message: 'That shop was not found.' };

function ready(businessId: unknown): { inbox: ReturnType<typeof inboxFor> } | InboxResult {
  if (!availability().available) return off;
  if (!checkBusiness(businessId)) return unknown;
  return { inbox: inboxFor(runtime() as unknown as InboxRuntime) };
}

export async function addEnquiryAction(businessId: string, fromEmail: string, message: string): Promise<InboxResult> {
  const r = ready(businessId);
  if ('ok' in r) return r;
  return r.inbox.add(businessId, { fromEmail, message });
}

export async function decideEnquiryAction(businessId: string, threadId: string, decision: 'approve' | 'reject', body?: string): Promise<InboxResult> {
  const r = ready(businessId);
  if ('ok' in r) return r;
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, code: 'invalid', message: 'Choose approve or reject.' };
  return r.inbox.decide(businessId, String(threadId), decision, body === undefined ? undefined : { body });
}
