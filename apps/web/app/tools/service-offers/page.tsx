'use client';
import { useEffect, useState } from 'react';
import OfferBuilder from '../../ui/offer-builder';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { offerStorageKey } from '../../../lib/local-offers';
import { checkOffersRaw } from '../../../lib/offers-sync';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real offer editor and the real account sync panel.
export default function ServiceOffersTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Service offers test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real offer logic and browser storage</span> Prices are planning figures. Nothing is charged or published.</p>
    <ConnectionBadges />
    {profile ? <>
      <OfferBuilder profile={profile} offersOnly />
      <LauncherAccountSync kind="service-offers" label="Service offers and pricing" array readLocal={() => localStorage.getItem(offerStorageKey(profile.id))} validate={raw => { checkOffersRaw(raw, profile); }} onApply={raw => { localStorage.setItem(offerStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
