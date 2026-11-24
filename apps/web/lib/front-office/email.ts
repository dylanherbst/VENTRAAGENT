// Email channel (tracker 1.9). Provider: Postmark (inbound webhook JSON + Messages API), assumed by Claude because it has
// the simplest inbound parsing; swapping provider means replacing this file only. See docs/agents/OWNER_TODO.md.
// Env: POSTMARK_SERVER_TOKEN, FRONT_OFFICE_EMAIL_FROM (verified sender, e.g. hello@ventra.com.au),
// FRONT_OFFICE_EMAIL_WEBHOOK_SECRET (the password in the inbound webhook URL's basic auth).
import { timingSafeEqual } from 'node:crypto';

export type InboundEmail = { from: string; name: string | null; subject: string; text: string; messageId: string };
export type EmailSender = (to: string, subject: string, text: string, inReplyTo?: string | null) => Promise<{ sent: boolean; id: string | null }>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Drop quoted history and signatures so the agent reads only what the person just wrote. */
export function newPart(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*$/.test(line.trim()) || /^_{5,}/.test(line.trim()) || /^From: .+/.test(line.trim())) break;
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function postmarkInbound(body: unknown): InboundEmail {
  const b = (body ?? {}) as Record<string, unknown>;
  const fromFull = (b.FromFull ?? {}) as Record<string, unknown>;
  const from = String(fromFull.Email ?? b.From ?? '').trim().toLowerCase();
  if (!EMAIL.test(from) || from.length > 254) throw new Error('Inbound email needs a sender address.');
  const messageId = String(b.MessageID ?? '').trim();
  if (messageId.length < 8 || messageId.length > 200) throw new Error('Inbound email needs a message id.');
  const subject = String(b.Subject ?? '').trim().slice(0, 200);
  const raw = typeof b.StrippedTextReply === 'string' && b.StrippedTextReply.trim() ? b.StrippedTextReply : String(b.TextBody ?? '');
  const text = newPart(raw).slice(0, 3800);
  const name = typeof fromFull.Name === 'string' && fromFull.Name.trim() ? fromFull.Name.trim().slice(0, 160) : null;
  return { from, name, subject, text, messageId };
}
export function basicAuthPasswordMatches(header: string | null, secret: string): boolean {
  const m = header?.match(/^Basic (.+)$/);
  if (!m || secret.length < 16) return false;
  let decoded: string;
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return false; }
  const got = Buffer.from(decoded.slice(decoded.indexOf(':') + 1)), want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}
export const replySubject = (subject: string) => /^re:/i.test(subject) ? subject : `Re: ${subject || 'Your enquiry'}`;

export const dryRunEmail: EmailSender = async () => ({ sent: false, id: null });
export function postmarkSender(token: string, from: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return async (to, subject, text, inReplyTo) => {
    const res = await fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST', cache: 'no-store',
      headers: { 'X-Postmark-Server-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, MessageStream: 'outbound', ...(inReplyTo ? { Headers: [{ Name: 'In-Reply-To', Value: inReplyTo }, { Name: 'References', Value: inReplyTo }] } : {}) }),
    });
    const j = await res.json().catch(() => ({})) as { MessageID?: string };
    if (!res.ok) throw new Error('The email provider did not accept the message.');
    return { sent: true, id: typeof j.MessageID === 'string' ? j.MessageID : null };
  };
}
/** Real email only with FRONT_OFFICE_SEND_LIVE=1 and Postmark configured; otherwise logged, not sent. */
export function emailSenderFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): EmailSender {
  const token = env.POSTMARK_SERVER_TOKEN?.trim(), from = env.FRONT_OFFICE_EMAIL_FROM?.trim();
  return token && from && EMAIL.test(from) && env.FRONT_OFFICE_SEND_LIVE === '1' ? postmarkSender(token, from, fetchImpl) : dryRunEmail;
}
