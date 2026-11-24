'use client';
import { useEffect, useState } from 'react';
import BusinessProfileSummary from '../../ui/business-profile-summary';
import { ConnectionBadges } from '../../ui/connection-badges';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real summary component over the real saved data in browser storage.
export default function BusinessProfileTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setDemo(!p);
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Business profile summary test</h1>
    <p><span className="v-status" data-testid="page-mode">{profile === null ? 'Checking…' : demo ? 'DEMO · No saved business in this browser, showing a labelled sample profile' : 'LIVE · Real summary from saved browser data'}</span> Read-only. Nothing is estimated.</p>
    <ConnectionBadges />
    {profile ? <BusinessProfileSummary profile={profile} /> : <p role="status">Loading…</p>}
  </main>;
}
