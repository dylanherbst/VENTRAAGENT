'use client';
import { useEffect, useState } from 'react';
import { GlassCard } from '../design-system/primitives';
import { GuidedSteps } from '../design-system/guided-steps';
import type { GuidedStep } from '../design-system/guided-steps';
import { buildPlan } from '../../lib/onboarding';
import { localDraftKeys } from '../../lib/draft-registry';
import { localDraftKinds } from '../../lib/today-view';
import { isUnreadable } from '../../lib/notifications';
import BusinessLauncher from './business-launcher';
import { HubHeading } from './ventra-hubs';
import { useWorkspace } from './ventra-context';

/** Start a Business flow on a customer route: guided progress from saved data, then the real launcher editors (unchanged). */
export default function StartBusiness() {
  const { profile } = useWorkspace();
  const [kinds, setKinds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!profile) { setKinds(null); return; }
    const run = () => { const k = localDraftKinds(key => localStorage.getItem(key), localDraftKeys(profile.id)); setKinds(isUnreadable(k) ? null : (k as string[])); };
    run();
    window.addEventListener('storage', run); window.addEventListener('ventra:updated', run);
    return () => { window.removeEventListener('storage', run); window.removeEventListener('ventra:updated', run); };
  }, [profile]);
  const has = (k: string) => !!kinds?.includes(k);
  const plan = profile ? buildPlan(profile) : [];
  const reviewed = profile ? plan.filter(s => profile.completed.includes(s.id)).length : 0;
  const steps: GuidedStep[] = [
    { id: 'skills', label: 'My skills', done: has('skill-assessment'), href: '#start-skills' },
    { id: 'idea', label: 'Business idea', done: !!profile?.goal && !!profile?.audience, href: '#launch-content', note: profile ? 'Set in your business profile' : 'Save your setup first' },
    { id: 'validate', label: 'Validate', done: has('offer-validation') || has('market-evidence'), href: '#start-evidence' },
    { id: 'pricing', label: 'Pricing', done: has('pricing-scenario'), href: '#start-pricing' },
    { id: 'branding', label: 'Branding', done: has('brand-direction'), href: '#start-branding' },
    { id: 'plan', label: 'Business plan', done: has('business-plan'), href: '#start-plan' },
    { id: 'checklist', label: 'Launch checklist', done: plan.length > 0 && reviewed === plan.length, href: '#start-checklist', note: plan.length ? `${reviewed} of ${plan.length} reviewed` : 'Save your setup first' },
  ];
  const done = steps.filter(s => s.done).length;
  return <div className="v-hub-page">
    <HubHeading title="Start a business" description="Seven steps, in your own time. Each one saves as a draft. Nothing is published or sent." />
    <GlassCard className="v-start-progress">
      <div className="v-section-heading"><h2>Your progress</h2><span className="v-status">{done} of {steps.length} steps with saved work</span></div>
      <GuidedSteps label="Start a business steps" steps={steps} />
      <p className="v-sub">The AI business idea helper is not available yet (coming soon). The steps above are written by you.</p>
    </GlassCard>
    <div className="v-editor v-legacy-route"><BusinessLauncher embedded /></div>
  </div>;
}
