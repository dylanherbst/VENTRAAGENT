/** Shared loopback-only URL gate for local Supabase and disposable API runners. */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

export function assertLoopbackHttpUrl(raw: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https.`);
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${label} must target a loopback host (127.0.0.1, localhost, or [::1]). Refusing non-local endpoint.`);
  }
  return parsed;
}
