'use client';
import { useEffect, useState } from 'react';
import WorkflowBuilder from '../../ui/workflow-builder';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { workflowsStorageKey, restoreWorkflows } from '../../../lib/local-workflow-builder';
import { blankProfile, restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real workflow builder and the real account sync panel.
export default function WorkflowBuilderTest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* fall back to the sample profile */ }
    setProfile(p ?? { ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services' });
  }, []);
  return <main>
    <h1>Workflow builder test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real workflow logic and browser storage</span> Design only. Nothing runs.</p>
    <ConnectionBadges />
    {profile ? <>
      <WorkflowBuilder profile={profile} />
      <LauncherAccountSync kind="workflow-builder" label="Workflow builder" array readLocal={() => localStorage.getItem(workflowsStorageKey(profile.id))} validate={raw => { restoreWorkflows(raw, profile.id); }} onApply={raw => { localStorage.setItem(workflowsStorageKey(profile.id), raw); window.location.reload(); }} />
    </> : <p role="status">Loading…</p>}
  </main>;
}
