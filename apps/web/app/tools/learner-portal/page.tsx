'use client';
import { useEffect, useState } from 'react';
import LearnerPortalPreview from '../../ui/learner-portal-preview';
import { ConnectionBadges } from '../../ui/connection-badges';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real preview component over the real saved course and student progress in browser storage.
export default function LearnerPortalTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setDemo(!p);
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Learner portal preview test</h1>
    <p><span className="v-status" data-testid="page-mode">{profile === null ? 'Checking…' : demo ? 'DEMO · No saved business in this browser, using a labelled sample profile (no course or students unless saved)' : 'LIVE · Real preview from saved browser data'}</span> Read-only. There is no learner login.</p>
    <ConnectionBadges />
    {profile ? <LearnerPortalPreview profileId={profile.id} /> : <p role="status">Loading…</p>}
  </main>;
}
