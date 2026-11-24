// Twilio inbound SMS webhook helpers (tracker 0.5). Signature check per Twilio's spec: HMAC-SHA1 over the full URL
// followed by every POST parameter (sorted by name, name then value, no separators), base64, with the auth token as key.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type InboundSms = { from: string; to: string; body: string; messageSid: string };

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params)), got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
export function formParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}
const E164 = /^\+[1-9][0-9]{6,14}$/;
export function inboundSms(params: Record<string, string>): InboundSms {
  const from = (params.From ?? '').trim(), to = (params.To ?? '').trim(), messageSid = (params.MessageSid ?? params.SmsSid ?? '').trim();
  if (!E164.test(from) || !E164.test(to)) throw new Error('Inbound SMS needs E.164 From and To numbers.');
  if (!/^[A-Za-z0-9]{10,64}$/.test(messageSid)) throw new Error('Inbound SMS needs a message id.');
  const body = params.Body ?? '';
  if (body.length > 1600) throw new Error('Inbound SMS body is too long.');
  return { from, to, body, messageSid };
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** TwiML reply: empty (no auto-reply) or one message. */
export function twiml(message?: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response>' + (message ? `<Message>${xml(message)}</Message>` : '') + '</Response>';
}
