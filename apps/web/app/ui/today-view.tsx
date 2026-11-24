'use client';
import { fetchWorkspaces } from './workspace-list';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { computeToday, localDraftKinds, UNREADABLE } from '../../lib/today-view';
import type { TodayInput, TodayView } from '../../lib/today-view';
import { localDraftKeys } from '../../lib/draft-registry';
import { followupStorageKey, restoreFollowUps, blankFollowUps } from '../../lib/local-lead-followups';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import { parseActivityResponse } from '../../lib/account-activity';
import type { Profile } from '../../lib/onboarding';

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Which draft kinds exist in the account, or null when that could not be checked. Read-only. */
export async function fetchAccountKinds(): Promise<string[] | null> {
  try {
    const w = await fetchWorkspaces();
    const wb = await w.json().catch(() => null);
    if (!w.ok || !Array.isArray(wb?.workspaces) || !wb.workspaces.length) return null;
    const r = await fetch('/api/workspace/activity?workspace=' + encodeURIComponent(wb.workspaces[0].id), { credentials: 'same-origin', cache: 'no-store' });
    const entries = r.ok ? parseActivityResponse(await r.json().catch(() => null)) : null;
    return entries ? entries.map(e => e.kind) : null;
  } catch { return null; }
}

function readLocal(profile: Profile): Omit<TodayInput, 'accountKinds'> {
  const id = profile.id;
  const part = <T,>(load: () => T) => { try { return load(); } catch { return UNREADABLE; } };
  return {
    todayIso: todayLocal(), profile,
    followups: part(() => restoreFollowUps(localStorage.getItem(followupStorageKey(id)), id) ?? blankFollowUps(id)),
    contacts: part(() => restoreContacts(localStorage.getItem(contactStorageKey(id)), id)),
    localKinds: localDraftKinds(k => localStorage.getItem(k), localDraftKeys(id)),
  };
}

// In-app only. Worked out from saved data each time; nothing is sent, scheduled or changed.
export function TodayPanel({ profile, limit }: { profile: Profile; limit?: number }) {
  const [view, setView] = useState<TodayView | null>(null);
  useEffect(() => {
    let live = true;
    const local = readLocal(profile);
    setView(computeToday({ ...local, accountKinds: null }));
    fetchAccountKinds().then(kinds => { if (live && kinds) setView(computeToday({ ...local, accountKinds: kinds })); });
    return () => { live = false; };
  }, [profile]);
  if (!view) return <p role="status">Loading…</p>;
  return <section aria-label="Today" data-testid="today-view">
    <h2>Today</h2>
    <p>Worked out from your saved data. Nothing is sent or changed. {view.accountChecked ? 'Your account copy was checked.' : 'Your account copy was not checked (sign in to compare).'}</p>
    {view.items.length === 0 ? <p role="status" data-testid="today-empty">Nothing needs doing right now.</p> : <>
      <ul data-testid="today-list">{(limit ? view.items.slice(0, limit) : view.items).map(i => <li key={i.id} data-kind={i.kind}>{i.text} <Link href={i.href}>Open</Link></li>)}</ul>
      {limit && view.items.length > limit && <details className="v-more-items"><summary>Show {view.items.length - limit} more</summary><ul>{view.items.slice(limit).map(i => <li key={i.id} data-kind={i.kind}>{i.text} <Link href={i.href}>Open</Link></li>)}</ul></details>}
    </>}
  </section>;
}
