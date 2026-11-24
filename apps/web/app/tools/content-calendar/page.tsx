'use client';
import { useEffect, useState } from 'react';
import ContentCalendar from '../../ui/content-calendar';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { contentCalendarStorageKey, restoreContentCalendar } from '../../../lib/local-content-calendar';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real content calendar editor and the real account sync panel.
export default function ContentCalendarTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Content calendar test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real calendar logic and browser storage</span> Manual drafts only. Nothing is published.</p>
    <ConnectionBadges />
    {profile ? <>
      <ContentCalendar profile={profile} />
      <LauncherAccountSync kind="content-calendar" label="Content calendar" array readLocal={() => localStorage.getItem(contentCalendarStorageKey(profile.id))} validate={raw => { restoreContentCalendar(raw, profile.id); }} onApply={raw => { localStorage.setItem(contentCalendarStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
