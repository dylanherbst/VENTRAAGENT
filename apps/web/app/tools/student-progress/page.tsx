'use client';
import { useEffect, useState } from 'react';
import StudentProgress from '../../ui/student-progress';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { studentProgressStorageKey, restoreTracker } from '../../../lib/local-student-progress';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real booking page draft editor and the real account sync panel.
export default function StudentProgressTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Student progress test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real tracker logic and browser storage</span> Recorded by you. Students have no access.</p>
    <ConnectionBadges />
    {profile ? <>
      <StudentProgress profile={profile} />
      <LauncherAccountSync kind="student-progress" label="Student progress" readLocal={() => localStorage.getItem(studentProgressStorageKey(profile.id))} validate={raw => { restoreTracker(raw, profile.id); }} onApply={raw => { localStorage.setItem(studentProgressStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
