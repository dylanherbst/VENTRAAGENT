'use client';
import { useEffect, useState } from 'react';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { applyChecklistToProfile, checklistFromProfile, restoreChecklist } from '../../../lib/launch-checklist';
import { restoreProfile, storageKey } from '../../../lib/onboarding';

// Isolated test page: the real checklist sync against the real saved business profile.
export default function LaunchChecklistTest() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { setCount(restoreProfile(localStorage.getItem(storageKey))?.completed.length ?? -1); }, []);
  return <main>
    <h1>Launch checklist test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real checklist logic and browser storage</span> The checklist lives in your saved business setup.</p>
    <ConnectionBadges />
    <p role="status" data-testid="checklist-count">{count === null ? 'Loading…' : count < 0 ? 'No saved business setup in this browser yet. Complete setup on the launcher first.' : `${count} step(s) marked reviewed in this browser.`}</p>
    <LauncherAccountSync kind="launch-checklist" label="Launch checklist" readLocal={() => checklistFromProfile(localStorage.getItem(storageKey))} validate={raw => { restoreChecklist(raw); }} onApply={raw => { localStorage.setItem(storageKey, applyChecklistToProfile(localStorage.getItem(storageKey), raw)); window.location.reload(); }} />
  </main>;
}
