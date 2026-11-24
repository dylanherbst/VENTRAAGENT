// Next normalizes 127.0.0.1 to localhost in nextUrl; compare the actual Host unless
// a canonical deployment origin is explicitly configured. Never trust forwarded-host.
export function sameOrigin(origin: string | null, host: string | null, protocol: string, canonical?: string): boolean {
  if (!origin || !host) return false;
  try {
    const actual = new URL(origin);
    const expected = new URL(canonical ?? `${protocol}//${host}`);
    return ['http:', 'https:'].includes(actual.protocol) && actual.origin === expected.origin && origin === actual.origin;
  } catch { return false; }
}
