'use client';
import { useEffect, useState } from 'react';
import Funnels from '../../ui/funnels';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { funnelsStorageKey, restoreFunnels } from '../../../lib/local-funnels';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real funnel drafts editor and the real account sync panel.
export default function FunnelsTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Funnel drafts test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real campaign logic and browser storage</span> Planning only. Nothing runs.</p>
    <ConnectionBadges />
    {profile ? <>
      <Funnels profile={profile} />
      <LauncherAccountSync kind="funnels" label="Funnels" array readLocal={() => localStorage.getItem(funnelsStorageKey(profile.id))} validate={raw => { restoreFunnels(raw, profile.id); }} onApply={raw => { localStorage.setItem(funnelsStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
