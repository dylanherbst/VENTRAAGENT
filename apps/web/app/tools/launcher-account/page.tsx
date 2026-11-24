'use client';
import { useEffect, useState } from 'react';
import PricingScenarioWorksheetEditor from '../../ui/pricing-scenario-worksheet';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real pricing scenario editor with its account sync panel. Uses the saved business profile, or a sample one.
export default function LauncherAccountTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Business Launcher account sync test</h1>
    <p>Real pricing scenario editor. Saved in this browser; the panel below it keeps a revisioned copy in your account.</p>
    {profile ? <PricingScenarioWorksheetEditor profile={profile} /> : <p role="status">Loading…</p>}
  </main>;
}
