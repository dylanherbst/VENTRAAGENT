// Human-like reply timing. A real person doesn't answer DMs in two seconds: replies wait a random time that leans short, plus a little
// "typing" time for longer messages, and NEVER more than 7 minutes (the owner's hard cap).
export const MAX_REPLY_DELAY_SECONDS = 7 * 60;
export interface ReplyDelay { enabled: boolean; minSeconds: number; maxSeconds: number }
export const DEFAULT_REPLY_DELAY: ReplyDelay = { enabled: true, minSeconds: 45, maxSeconds: MAX_REPLY_DELAY_SECONDS };

/** Clamp owner input to 0..420 seconds with min <= max. */
export function cleanDelay(d: Partial<ReplyDelay> | undefined): ReplyDelay {
  const n = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : f);
  const max = Math.min(MAX_REPLY_DELAY_SECONDS, Math.max(0, n(d?.maxSeconds, DEFAULT_REPLY_DELAY.maxSeconds)));
  const min = Math.min(max, Math.max(0, n(d?.minSeconds, DEFAULT_REPLY_DELAY.minSeconds)));
  return { enabled: d?.enabled !== false, minSeconds: min, maxSeconds: max };
}

/**
 * Random delay in milliseconds. Shape: most replies land in the first half of the range (people usually reply fairly soon, sometimes
 * later), plus ~1 second of "typing" per 25 characters (max 40 s), always clamped to [min, max] and never above 7 minutes.
 */
export function replyDelayMs(text: string, d: ReplyDelay, rand: () => number = Math.random): number {
  const c = cleanDelay(d);
  if (!c.enabled || c.maxSeconds === 0) return 0;
  const u = Math.min(Math.max(rand(), 0), 1);
  const base = c.minSeconds + (c.maxSeconds - c.minSeconds) * u * u; // skewed towards the short end
  const typing = Math.min(40, text.length / 25);
  const seconds = Math.min(c.maxSeconds, Math.max(c.minSeconds, base + typing));
  return Math.round(Math.min(seconds, MAX_REPLY_DELAY_SECONDS) * 1000);
}
