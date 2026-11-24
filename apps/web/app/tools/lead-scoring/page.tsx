'use client';
import { useEffect, useState } from 'react';
import LeadScoring from '../../ui/lead-scoring';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { leadScoringStorageKey, restoreRuleset } from '../../../lib/local-lead-scoring';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real lead scoring editor, the real saved contacts from browser storage, and the real account sync panel.
export default function LeadScoringTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Lead scoring test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real scoring logic and saved browser contacts</span> Rules are written by you. No AI.</p>
    <ConnectionBadges />
    {profile ? <>
      <LeadScoring profileId={profile.id} />
      <LauncherAccountSync kind="lead-scoring" label="Lead scoring rules" readLocal={() => localStorage.getItem(leadScoringStorageKey(profile.id))} validate={raw => { restoreRuleset(raw, profile.id); }} onApply={raw => { localStorage.setItem(leadScoringStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
