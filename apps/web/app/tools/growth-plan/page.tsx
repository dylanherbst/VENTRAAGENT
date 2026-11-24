'use client';
import { useEffect, useState } from 'react';
import GrowthPlanner from '../../ui/ventra-grow';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { checkGrowthPlanRaw } from '../../../lib/growth-plan-sync';
import { growthPlanKey } from '../../../lib/local-growth-plan';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real growth planner and the real account sync panel.
export default function GrowthPlanTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Growth plan test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real planner logic and browser storage</span> Planning only. Nothing is published, scheduled or sent.</p>
    <ConnectionBadges />
    {profile ? <>
      <GrowthPlanner profile={profile} />
      <LauncherAccountSync kind="growth-plan" label="Growth plan" readLocal={() => localStorage.getItem(growthPlanKey(profile.id))} validate={raw => { checkGrowthPlanRaw(raw, profile.id); }} onApply={raw => { localStorage.setItem(growthPlanKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
