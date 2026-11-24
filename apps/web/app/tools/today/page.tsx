'use client';
import { useEffect, useState } from 'react';
import { TodayPanel } from '../../ui/today-view';
import { ConnectionBadges } from '../../ui/connection-badges';
import { restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the exact Today panel used on Home, over the real saved data in browser storage.
export default function TodayTest() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => { try { setProfile(restoreProfile(localStorage.getItem(storageKey))); } catch { setProfile(null); } }, []);
  return <main>
    <h1>Today view test</h1>
    <p><span className="v-status" data-testid="page-mode">{profile === undefined ? 'Checking…' : profile ? 'LIVE · Real items from saved browser data' : 'DEMO · No saved business in this browser, so nothing to show'}</span> Read-only. No invented items.</p>
    <ConnectionBadges />
    {profile ? <TodayPanel profile={profile} /> : profile === null ? <p role="status">Save your business setup first; there is nothing to work out yet.</p> : <p role="status">Loading…</p>}
  </main>;
}
