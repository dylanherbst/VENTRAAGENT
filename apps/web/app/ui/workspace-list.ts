// One shared read of GET /api/workspace per short window, so a page with several panels (and a signed-out visitor)
// makes one request instead of many. Presentation-side cache only; the route and its rules are unchanged.
let cache: { at: number; res: Promise<Response> } | null = null;
const WINDOW_MS = 30_000;

export function fetchWorkspaces(): Promise<Response> {
  const now = Date.now();
  if (!cache || now - cache.at >= WINDOW_MS) {
    const res = fetch('/api/workspace', { credentials: 'same-origin', cache: 'no-store' });
    cache = { at: now, res };
    res.catch(() => { if (cache?.res === res) cache = null; });
  }
  return cache.res.then(r => r.clone());
}

/** Call after signing in or out, or after the workspace list may have changed. */
export function forgetWorkspaces(): void { cache = null; }
