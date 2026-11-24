// Fixed-size sliding window per key, held in this server process only. It bounds accidental or abusive cost per user
// on one instance; it is not a substitute for a provider-side spending cap, and it resets when the server restarts.
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return function check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const t = now();
    const recent = (hits.get(key) ?? []).filter(x => t - x < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

type Check = ReturnType<typeof createRateLimiter>;
/** Per-user limiters for the workspace routes. Generous for normal use (a person clicking around, autosave); they only stop loops and abuse. Per server instance, reset on restart. */
export const workspaceLimits: Record<'team' | 'export' | 'search' | 'activity' | 'launcher' | 'outbox' | 'settings' | 'summary', Check> = {
  team: createRateLimiter(60, 60_000),
  export: createRateLimiter(10, 10 * 60_000),
  search: createRateLimiter(60, 60_000),
  activity: createRateLimiter(60, 60_000),
  launcher: createRateLimiter(240, 60_000),
  outbox: createRateLimiter(120, 60_000),
  settings: createRateLimiter(60, 60_000),
  summary: createRateLimiter(60, 60_000),
};
/** Key for callers we cannot identify (signed-out routes such as checkout). The forwarded address is only a hint; pair it with a global ceiling. */
export function clientKey(forwardedFor: string | null | undefined): string {
  const ip = (forwardedFor ?? '').split(',')[0].trim().slice(0, 64);
  return 'ip:' + (ip || 'unknown');
}

/** Limiters for the remaining routes. Same rules: generous for people, tight for loops. */
export const routeLimits = {
  courses: createRateLimiter(240, 60_000),            // per user, account course reads/saves (autosave friendly)
  workspaceRequests: createRateLimiter(300, 60_000),  // per user, all /api/workspace calls after sign-in
  signInByClient: createRateLimiter(20, 10 * 60_000), // per client address hint, login and signup attempts
  signInByEmail: createRateLimiter(10, 10 * 60_000),  // per email, so one account can not be hammered from many addresses
  webhookGlobal: createRateLimiter(600, 60_000),
  smsWebhookGlobal: createRateLimiter(600, 60_000),
  metaWebhookGlobal: createRateLimiter(1200, 60_000),
  voiceGlobal: createRateLimiter(3000, 60_000),        // all Vapi calls (custom LLM turns + server events), before the key check
};
