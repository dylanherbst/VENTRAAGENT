// Legacy VENTRA pages are hidden (owner approval, 20 Nov 2026). AiMoneyPrinter is the only product, so the old VENTRA home and its
// sections send visitors to the guided start instead. Nothing is deleted: set AIMP_SHOW_LEGACY=1 to see the old pages again.
// The marketing domain keeps its own home (rewritten to /site), and everything under /app/<business>, /start, /s, /api and the
// test pages is untouched. Pure, so the node tests can run it.
export const LEGACY_EXACT: readonly string[] = ['/', '/app'];
export const LEGACY_PREFIXES: readonly string[] = ['/customers', '/insights', '/settings', '/inbox', '/sales', '/business', '/grow', '/money', '/more', '/create', '/services', '/onboarding'];
export const LEGACY_TARGET = '/start';
const MARKETING_HOSTS: readonly string[] = ['aiventra.com.au', 'www.aiventra.com.au'];

export function legacyRedirect(pathname: string, host: unknown, env: { AIMP_SHOW_LEGACY?: string | undefined } = {}): string | null {
  if (env.AIMP_SHOW_LEGACY === '1') return null;
  const h = typeof host === 'string' ? host.toLowerCase().split(':')[0]! : '';
  if (MARKETING_HOSTS.includes(h)) return null;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (LEGACY_EXACT.includes(p)) return LEGACY_TARGET;
  return LEGACY_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`)) ? LEGACY_TARGET : null;
}
