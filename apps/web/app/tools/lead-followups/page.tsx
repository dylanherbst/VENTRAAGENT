'use client';
import { useEffect, useState } from 'react';
import LeadFollowUps from '../../ui/lead-followups';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { followupStorageKey, restoreFollowUps } from '../../../lib/local-lead-followups';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real follow-up list over the real saved contacts in browser storage, and the real account sync panel.
export default function LeadFollowUpsTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Lead follow-ups test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real follow-up logic and saved browser contacts</span> Manual tasks only. Nothing is sent.</p>
    <ConnectionBadges />
    {profile ? <>
      <LeadFollowUps profileId={profile.id} />
      <LauncherAccountSync kind="lead-followups" label="Lead follow-ups" readLocal={() => localStorage.getItem(followupStorageKey(profile.id))} validate={raw => { restoreFollowUps(raw, profile.id); }} onApply={raw => { localStorage.setItem(followupStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
