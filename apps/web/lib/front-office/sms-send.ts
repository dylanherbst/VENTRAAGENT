// Outbound SMS through Twilio's Messages API. Callers log the message with fo_log_outbound BEFORE calling this
// (tracker 0.6). Sending to real people is a customer message: it only happens when the server sets
// FRONT_OFFICE_SEND_LIVE=1 (owner approval), otherwise messages are logged and not sent.
export type TwilioSendConfig = { accountSid: string; authToken: string; from: string };
export type SmsSender = (to: string, body: string) => Promise<{ sent: boolean; sid: string | null }>;

export function twilioSendConfigFromEnv(env: Record<string, string | undefined> = process.env): TwilioSendConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim(), authToken = env.TWILIO_AUTH_TOKEN?.trim(), from = env.TWILIO_FROM_NUMBER?.trim();
  return accountSid && authToken && from ? { accountSid, authToken, from } : null;
}
export function liveSendingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.FRONT_OFFICE_SEND_LIVE === '1';
}

/** A sender that only logs (DEMO), used whenever live sending is off or Twilio is not configured. */
export const dryRunSender: SmsSender = async () => ({ sent: false, sid: null });

export function twilioSender(config: TwilioSendConfig, fetchImpl: typeof fetch = fetch): SmsSender {
  if (!/^AC[0-9a-f]{32}$/i.test(config.accountSid)) throw new Error('Twilio account SID is not valid.');
  return async (to, body) => {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: config.from, Body: body }).toString(),
    });
    const j = await res.json().catch(() => ({})) as { sid?: string };
    if (!res.ok) throw new Error('Twilio did not accept the message.');
    return { sent: true, sid: typeof j.sid === 'string' ? j.sid : null };
  };
}

export function senderFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): SmsSender {
  const c = twilioSendConfigFromEnv(env);
  return c && liveSendingOn(env) ? twilioSender(c, fetchImpl) : dryRunSender;
}
