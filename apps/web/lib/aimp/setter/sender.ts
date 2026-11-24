// Instagram Send API adapter (Instagram Login path only: graph.instagram.com). Injected fetch, structured errors, no retries here
// (the pipeline owns retries so it can enforce idempotency and dead-lettering).
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export type SendResult = { ok: true; messageId: string } | { ok: false; retryable: boolean; code: string; message: string };
export interface DmSender { send(i: { igAccountId: string; igsid: string; text: string; accessToken: string }): Promise<SendResult> }

const RATE_CODES = new Set([4, 17, 32, 613, 80002, 80006]);

export function createInstagramSender(deps: { fetch: FetchLike; graphVersion?: string }): DmSender {
  const v = /^v\d{1,3}\.\d$/.test(deps.graphVersion ?? '') ? deps.graphVersion! : 'v25.0';
  return {
    async send({ igAccountId, igsid, text, accessToken }) {
      if (!/^\d{1,30}$/.test(igAccountId) || !/^\d{1,30}$/.test(igsid)) return { ok: false, retryable: false, code: 'bad_ids', message: 'Bad account or recipient id.' };
      let res;
      try {
        res = await deps.fetch(`https://graph.instagram.com/${v}/${igAccountId}/messages`, {
          method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
        });
      } catch { return { ok: false, retryable: true, code: 'network', message: 'Could not reach Instagram.' }; }
      const j = (await res.json().catch(() => ({}))) as { message_id?: unknown; error?: { code?: unknown; message?: unknown } };
      if (res.status >= 200 && res.status < 300 && typeof j.message_id === 'string') return { ok: true, messageId: j.message_id };
      const code = typeof j.error?.code === 'number' ? j.error.code : null;
      const retryable = res.status === 429 || res.status >= 500 || (code !== null && RATE_CODES.has(code));
      // Error text from Meta is kept short and never includes the token.
      return { ok: false, retryable, code: code === null ? `http_${res.status}` : `meta_${code}`, message: typeof j.error?.message === 'string' ? j.error.message.slice(0, 200) : 'Instagram refused the message.' };
    },
  };
}

/** Records sends instead of making them. Used by the simulator and whenever live sending is not switched on. */
export function createFakeSender(opts: { failTimes?: number; retryable?: boolean } = {}): DmSender & { sent: { igsid: string; text: string }[] } {
  let fails = opts.failTimes ?? 0;
  let n = 0;
  const sent: { igsid: string; text: string }[] = [];
  return {
    sent,
    async send({ igsid, text }) {
      if (fails > 0) { fails--; return { ok: false, retryable: opts.retryable ?? true, code: 'meta_4', message: 'Simulated rate limit.' }; }
      sent.push({ igsid, text });
      return { ok: true, messageId: `sim-out-${++n}` };
    },
  };
}
