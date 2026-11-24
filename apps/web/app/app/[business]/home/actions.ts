'use server';
// Home actions. "Send my weekly brief" writes the brief from real records and sends it to the fixture outbox only when the owner presses
// the button with an email address. No real email is sent in this demo. The workspace and owner are server constants.
import { weeklyBriefEmail } from '../../../../lib/aimp/home/build';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import type { InboxRuntime } from '../../../start/_server/inbox-runtime';
import { loadHome } from './_server/load-home';

export type BriefReply = { ok: true; message: string } | { ok: false; message: string };
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;

export async function sendWeeklyBriefAction(businessId: string, toEmail: string): Promise<BriefReply> {
  if (!availability().available) return { ok: false, message: 'Home is not switched on here.' };
  if (!checkBusiness(businessId)) return { ok: false, message: 'That shop was not found.' };
  const to = String(toEmail ?? '').trim();
  if (!EMAIL.test(to)) return { ok: false, message: 'Enter your email address.' };
  try {
    const r = await loadHome(businessId);
    if (!r.found) return { ok: false, message: 'That shop was not found.' };
    const mail = weeklyBriefEmail(r.home);
    const day = new Date().toISOString().slice(0, 10);
    await (runtime() as unknown as InboxRuntime).orderDemo.email.send({ to, subject: mail.subject, text: mail.text, idempotencyKey: `brief:${businessId}:${to.toLowerCase()}:${day}` });
    return { ok: true, message: `Your weekly brief was sent to ${to} (test outbox: nothing left this server).` };
  } catch {
    return { ok: false, message: 'The brief could not be sent. Nothing was sent.' };
  }
}
