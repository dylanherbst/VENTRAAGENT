// Reads a business's PUBLIC website to pre-fill onboarding. Server only. Safety: https only, no IP-literal or private/loopback hosts
// (checked after DNS), at most 3 redirects (each re-checked), 6 s timeout, 600 KB cap, HTML only. Nothing is stored except the
// short text the owner then reviews.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SiteText { url: string; title: string; description: string; headings: string[]; text: string }

const PRIVATE = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|192\.168|169\.254)\./i];
export const isPrivateAddress = (ip: string): boolean => PRIVATE.some((r) => r.test(ip));

export async function checkPublicUrl(raw: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<URL | null> {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) return null;
  try { const ips = await resolve(host); if (!ips.length || ips.some(isPrivateAddress)) return null; } catch { return null; }
  return u;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
export function extractSite(url: string, html: string): SiteText {
  const h = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' ');
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? '').replace(/\s+/g, ' ').trim()).slice(0, 200);
  const description = decode(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(h)?.[1] ?? /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(h)?.[1] ?? '').trim().slice(0, 400);
  const headings = [...h.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => decode(m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())).filter((x) => x.length > 2).slice(0, 25);
  const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 6000);
  return { url, title, description, headings, text };
}

export async function readPublicSite(raw: string, fetchFn: typeof fetch = fetch): Promise<{ ok: true; site: SiteText } | { ok: false; reason: string }> {
  let url = raw.trim(); if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkPublicUrl(url);
    if (!u) return { ok: false, reason: 'That address is not a public https website.' };
    let res: Response;
    try { res = await fetchFn(u, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'AiMoneyPrinterBot/1.0 (+onboarding; reads one page the owner asked us to read)', accept: 'text/html' } }); }
    catch { return { ok: false, reason: 'The website did not answer in time.' }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, u).toString(); continue; }
    if (!res.ok) return { ok: false, reason: `The website answered with an error (${res.status}).` };
    if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) return { ok: false, reason: 'That address is not a web page.' };
    const reader = res.body?.getReader(); if (!reader) return { ok: false, reason: 'The page was empty.' };
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 600_000) { await reader.cancel(); break; } chunks.push(value); }
    return { ok: true, site: extractSite(u.toString(), new TextDecoder().decode(Buffer.concat(chunks))) };
  }
  return { ok: false, reason: 'The website redirected too many times.' };
}
