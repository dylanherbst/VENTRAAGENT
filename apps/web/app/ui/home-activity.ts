'use client';
// Recent activity for Home. Read-only GET of what was saved to the account (/api/workspace/activity), only when the
// live summary already proved the person is signed in. Not signed in: just what this browser saved. Nothing invented.
import { useEffect, useState } from 'react';
import { describeEntry, parseActivityResponse } from '../../lib/account-activity';
export { relativeTime } from '../../lib/relative-time';
import { mergeActivity } from '../../lib/activity-merge';
import type { ActivityItem } from '../../lib/activity-merge';
import type { LiveState } from './live-summary';

export type { ActivityItem } from '../../lib/activity-merge';
export type ActivityState = { phase: 'loading' } | { phase: 'ready'; items: ActivityItem[]; failed: boolean };

export function useRecentActivity(live: LiveState, local: ActivityItem[]): ActivityState {
  const [remote, setRemote] = useState<{ items: ActivityItem[]; failed: boolean } | null>(null);
  const workspace = live.phase === 'live' ? live.workspace.id : null;
  useEffect(() => {
    setRemote(null);
    if (!workspace) return;
    let on = true;
    fetch('/api/workspace/activity?workspace=' + encodeURIComponent(workspace), { credentials: 'same-origin', cache: 'no-store' })
      .then(async r => { const entries = r.ok ? parseActivityResponse(await r.json().catch(() => null)) : null; return entries ? { items: entries.map(e => ({ key: e.kind, title: describeEntry(e), when: e.updatedAt, href: e.href })), failed: false } : { items: [], failed: true }; })
      .catch(() => ({ items: [] as ActivityItem[], failed: true }))
      .then(x => { if (on) setRemote(x); });
    return () => { on = false; };
  }, [workspace]);
  if (live.phase === 'loading' || (workspace && !remote)) return { phase: 'loading' };
  return { phase: 'ready', ...mergeActivity(local, remote) };
}
