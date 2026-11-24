'use client';
import { useEffect, useState } from 'react';
import MembershipPlansEditor from '../../ui/membership-plans';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { membershipStorageKey, restorePlans } from '../../../lib/local-membership-plans';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real membership plans editor, and the real account sync panel.
export default function MembershipPlansTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Membership plans test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real membership plan logic and browser storage</span> Planning only. No billing, no sign-ups, no locked content.</p>
    <ConnectionBadges />
    {profile ? <>
      <MembershipPlansEditor profileId={profile.id} />
      <LauncherAccountSync kind="membership-plans" label="Membership plans" readLocal={() => localStorage.getItem(membershipStorageKey(profile.id))} validate={raw => { restorePlans(raw, profile.id); }} onApply={raw => { localStorage.setItem(membershipStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
