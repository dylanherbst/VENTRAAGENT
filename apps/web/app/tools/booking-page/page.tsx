'use client';
import { useEffect, useState } from 'react';
import BookingPageDraft from '../../ui/booking-page';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { bookingPageStorageKey, restoreBookingPage } from '../../../lib/local-booking-page';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real booking page draft editor and the real account sync panel.
export default function BookingPageTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Booking page draft test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real availability logic and browser storage</span> Preview only. No real bookings.</p>
    <ConnectionBadges />
    {profile ? <>
      <BookingPageDraft profile={profile} />
      <LauncherAccountSync kind="booking-page" label="Booking page" readLocal={() => localStorage.getItem(bookingPageStorageKey(profile.id))} validate={raw => { restoreBookingPage(raw, profile.id); }} onApply={raw => { localStorage.setItem(bookingPageStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
