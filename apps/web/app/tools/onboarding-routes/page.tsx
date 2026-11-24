'use client';
import { useState } from 'react';
import { GlassCard } from '../../design-system/primitives';
import { applyRoute, blankProfile, buildPlan, routeOf, routes } from '../../../lib/onboarding';
import type { RouteId } from '../../../lib/onboarding';

// Isolated test page: uses the same applyRoute/routeOf/buildPlan logic as /onboarding.
// Nothing here is saved; it only shows what each route changes in the shared profile model.
const sample = { ...blankProfile(), name: 'Test Studio', audience: 'Local customers', goal: 'Get the first customers', expertise: 'Coaching', industry: 'Services' };

export default function OnboardingRoutesTest() {
  const [profile, setProfile] = useState(sample);
  const route = routeOf(profile);
  const plan = buildPlan(profile);
  return <main className="v-onboarding-test">
    <h1>Onboarding routes test</h1>
    <p><span className="v-status" data-testid="mode">DEMO · browser memory only, no account sync</span></p>
    <GlassCard>
      <fieldset><legend>Route</legend>
        {routes.map(r => <label className="v-radio" key={r.id}>
          <input type="radio" name="route" value={r.id} checked={route === r.id} onChange={() => setProfile(p => applyRoute(p, r.id as RouteId))} />
          <span><strong>{r.title}</strong><small>{r.summary}</small></span>
        </label>)}
      </fieldset>
    </GlassCard>
    <GlassCard>
      <h2>Resulting profile fields</h2>
      <dl data-testid="result">
        <dt>route</dt><dd data-testid="route">{route}</dd>
        <dt>stage</dt><dd data-testid="stage">{profile.stage}</dd>
        <dt>primary</dt><dd data-testid="primary">{profile.primary}</dd>
        <dt>pathways</dt><dd data-testid="pathways">{profile.pathways.join(',')}</dd>
        <dt>plan steps</dt><dd data-testid="plan-count">{plan.length}</dd>
      </dl>
      <ol>{plan.map(s => <li key={s.id}>{s.title}</li>)}</ol>
    </GlassCard>
  </main>;
}
