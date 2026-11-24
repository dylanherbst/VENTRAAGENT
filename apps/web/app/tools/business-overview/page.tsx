'use client';
import { useEffect, useState } from 'react';
import BusinessOverview from '../../ui/business-overview';
import { ConnectionBadges } from '../../ui/connection-badges';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real overview component over the real saved data in browser storage.
export default function BusinessOverviewTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Business overview test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real overview logic over saved browser data</span> Read-only. No AI, no estimates.</p>
    <ConnectionBadges />
    {profile ? <BusinessOverview profile={profile} /> : <p role="status">Loading…</p>}
  </main>;
}
