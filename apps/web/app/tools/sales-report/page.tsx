'use client';
import { useEffect, useState } from 'react';
import SalesReport from '../../ui/sales-report';
import { ConnectionBadges } from '../../ui/connection-badges';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real report component over the real saved deals in browser storage.
export default function SalesReportTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Sales report test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real report logic over saved browser deals</span> Read-only. No AI, no estimates.</p>
    <ConnectionBadges />
    {profile ? <SalesReport profileId={profile.id} /> : <p role="status">Loading…</p>}
  </main>;
}
