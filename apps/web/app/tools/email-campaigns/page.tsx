'use client';
import { useEffect, useState } from 'react';
import EmailCampaigns from '../../ui/email-campaigns';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { emailCampaignsStorageKey, restoreEmailCampaigns } from '../../../lib/local-email-campaigns';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real email campaigns editor and the real account sync panel.
export default function EmailCampaignsTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Email campaigns test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real campaign logic and browser storage</span> Manual drafts only. Nothing is sent.</p>
    <ConnectionBadges />
    {profile ? <>
      <EmailCampaigns profile={profile} />
      <LauncherAccountSync kind="email-campaigns" label="Email campaigns" array readLocal={() => localStorage.getItem(emailCampaignsStorageKey(profile.id))} validate={raw => { restoreEmailCampaigns(raw, profile.id); }} onApply={raw => { localStorage.setItem(emailCampaignsStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
