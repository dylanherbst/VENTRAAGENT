'use client';
import { fetchWorkspaces } from './workspace-list';
import { useState } from 'react';
import Link from 'next/link';
import { mergeHits, parseQuery, parseSearchResponse, searchDrafts } from '../../lib/draft-search';
import type { SearchHit } from '../../lib/draft-search';
import { localDraftKeys } from '../../lib/draft-registry';

export type SearchMode = 'LIVE' | 'DEMO';
type Result = { hits: SearchHit[]; account: 'searched' | 'not-searched'; reason: string; unreadable: number };

function searchBrowser(profileId: string, terms: string[]): { hits: SearchHit[]; unreadable: number } {
  const drafts: { kind: string; data: unknown }[] = [];
  let unreadable = 0;
  for (const k of localDraftKeys(profileId)) {
    try {
      const raw = localStorage.getItem(k.key);
      if (raw) drafts.push({ kind: k.kind, data: JSON.parse(raw) });
    } catch { unreadable += 1; }
  }
  return { hits: searchDrafts(drafts, terms, 'browser'), unreadable };
}
async function searchAccount(q: string): Promise<{ hits: SearchHit[] | null; reason: string }> {
  try {
    const w = await fetchWorkspaces();
    const wb = await w.json().catch(() => null);
    if (!w.ok || !Array.isArray(wb?.workspaces) || !wb.workspaces.length) return { hits: null, reason: w.status === 401 ? 'Sign in to search your account too.' : w.ok ? 'No workspace yet, so only this browser was searched.' : 'Account storage is not available here.' };
    const r = await fetch(`/api/workspace/search?workspace=${encodeURIComponent(wb.workspaces[0].id)}&q=${encodeURIComponent(q)}`, { credentials: 'same-origin', cache: 'no-store' });
    const hits = r.ok ? parseSearchResponse(await r.json().catch(() => null)) : null;
    return hits ? { hits, reason: '' } : { hits: null, reason: `The account search failed (status ${r.status}); only this browser was searched.` };
  } catch { return { hits: null, reason: 'Could not reach the account service; only this browser was searched.' }; }
}

// Shared by Home and /tools/search. Searches saved drafts in this browser and, when signed in, in the account (RLS). Read-only.
export function DraftSearch({ profileId, onMode }: { profileId: string; onMode?: (m: SearchMode) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault(); setError(''); setResult(null);
    let terms: string[];
    try { terms = parseQuery(q); } catch (err) { setError(err instanceof Error ? err.message : 'Invalid search.'); return; }
    setBusy(true);
    const local = searchBrowser(profileId, terms);
    const account = await searchAccount(q.trim());
    setBusy(false);
    onMode?.(account.hits ? 'LIVE' : 'DEMO');
    setResult({ hits: mergeHits(local.hits, account.hits ?? []), account: account.hits ? 'searched' : 'not-searched', reason: account.reason, unreadable: local.unreadable });
  }
  return <section aria-label="Search saved items" data-testid="draft-search">
    <h2>Search my saved items</h2>
    <form onSubmit={run}>
      <label>Search your saved drafts <input type="search" value={q} maxLength={80} onChange={e => setQ(e.target.value)} placeholder="For example: spring offer" /></label>
      <button type="submit" className="v-button" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
    </form>
    {error && <p role="alert" data-testid="search-error">{error}</p>}
    {result && <div data-testid="search-results">
      <p role="status" data-testid="search-scope">{result.account === 'searched' ? 'Searched this browser and your account.' : `Searched this browser only. ${result.reason}`}</p>
      {result.unreadable > 0 && <p role="alert">{result.unreadable} saved draft{result.unreadable === 1 ? '' : 's'} in this browser could not be read, so {result.unreadable === 1 ? 'it was' : 'they were'} not searched.</p>}
      {result.hits.length === 0 ? <p data-testid="search-empty">Nothing matches.</p> : <ul>{result.hits.map(h => <li key={h.kind} data-testid="search-hit"><strong>{h.label}</strong> <span className="v-status">{h.sources.map(s => s === 'account' ? 'Account' : 'This browser').join(' + ')}</span><br />{h.snippet} <Link href={h.href}>Open</Link></li>)}</ul>}
    </div>}
  </section>;
}
