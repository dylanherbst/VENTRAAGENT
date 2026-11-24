'use client';
import { useEffect, useState } from 'react';
import NotificationsCentre from '../../ui/notifications-centre';
import { ConnectionBadges } from '../../ui/connection-badges';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real notifications logic over the real saved data in browser storage.
export default function NotificationsTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setDemo(!p);
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Notifications test</h1>
    <p><span className="v-status" data-testid="page-mode">{profile === null ? 'Checking…' : demo ? 'DEMO · No saved business in this browser, so nothing to show' : 'LIVE · Real notifications from saved browser data'}</span> Read-only. No email, no push, no invented items.</p>
    <ConnectionBadges />
    {profile ? <NotificationsCentre profile={profile} /> : <p role="status">Loading…</p>}
  </main>;
}
