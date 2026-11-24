'use client';
import { useState } from 'react';
import HomeView from '../../ui/home-view';
import type { HomeModel } from '../../ui/home-view';
import { useLiveSummary } from '../../ui/live-summary';
import type { LiveState } from '../../ui/live-summary';
import type { FrontOfficeSummary } from '../../../lib/front-office/summary';

// Isolated test page for the rebuilt Home (docs/design/UI_BIBLE.md). The real screen is /app; this page renders the same
// HomeView with fixed DEMO data so every state can be seen without an account: loading, empty, error, signed out, live.
// This path is listed in the shell's glassScreens so the old top bar and tab bar are not drawn around the preview
// (that would stack two bottom navs and nest two <main> landmarks).
// The line at the top says whether the real account service is reachable from here (LIVE or not connected).
const emptySummary: FrontOfficeSummary = { generatedAt: '2026-11-12T00:00:00Z', leads: { total: 0, byState: {}, newThisWeek: 0 }, conversations: { active: 0 }, bookings: { today: 0, upcoming: 0, next7Days: 0, attended30d: 0, noShow30d: 0 }, calls: { last7Days: 0, needsOwner: 0 }, approvals: { queued: 0 }, handoffsToYou: { last7Days: 0 }, enquiriesByDay: [] };
const liveDemo: FrontOfficeSummary = { ...emptySummary, leads: { total: 12, byState: { new: 5 }, newThisWeek: 5 }, bookings: { today: 3, upcoming: 11, next7Days: 11, attended30d: 20, noShow30d: 2 }, conversations: { active: 7 }, calls: { last7Days: 9, needsOwner: 2 }, approvals: { queued: 2 } };
const steps = [
  { title: 'Set up your business', note: 'Start an independent business · saved in this browser', href: '/onboarding', done: true },
  { title: 'Create your first offer', note: 'A service, product or course draft.', href: '/business?tab=offers', done: false },
  { title: 'Run your free Growth Audit', note: 'See where enquiries are slipping.', href: '/grow/audit', done: false },
  { title: 'Teach your AI team about you', note: 'Optional · FAQs, hours and booking rules.', href: '/customers/ai-team', done: false, optional: true },
];
const base: HomeModel = {
  name: 'Dylan', hasProfile: true, ready: true, error: '', steps, next: { label: 'Create your first offer', href: '/business?tab=offers', note: 'Your launch steps are in Create.' },
  live: { phase: 'signed-out', reason: 'Sign in to see live leads, bookings and calls.' },
  activity: { phase: 'ready', items: [], failed: false },
};
const liveState: LiveState = { phase: 'live', summary: liveDemo, workspace: { id: 'demo', name: 'Demo business' }, partial: false };
const states: Record<string, HomeModel> = {
  Loading: { ...base, ready: false, live: { phase: 'loading' }, activity: { phase: 'loading' } },
  'Signed out': base,
  'Live data': { ...base, live: liveState, activity: { phase: 'ready', failed: false, items: [
    { key: 'a', title: 'Business profile: updated (save number 3)', when: new Date(Date.now() - 12 * 60_000).toISOString(), href: '/settings' },
    { key: 'b', title: 'Offer: first saved', when: new Date(Date.now() - 26 * 3_600_000).toISOString(), href: '/business' }] } },
  'Live, nothing yet': { ...base, live: { phase: 'live', summary: emptySummary, workspace: { id: 'demo', name: 'Demo business' }, partial: false } },
  'First visit': { ...base, name: '', hasProfile: false },
  Error: { ...base, error: 'Saved business details could not be read.', activity: { phase: 'ready', items: [], failed: true } },
};

export default function HomeGlassTest() {
  const [pick, setPick] = useState('Signed out');
  const real = useLiveSummary();
  const mode = real.phase === 'live' ? 'LIVE' : real.phase === 'loading' ? 'CHECKING' : 'DEMO';
  return <div>
    <h1>Home screen test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode} · {real.phase === 'live' ? `connected to ${real.workspace.name}` : real.phase === 'loading' ? 'checking the account service' : `account not connected (${real.phase})`}</span> The preview below is always DEMO data. The real screen is <a href="/app">/app</a>.</p>
    <div role="group" aria-label="Preview state">{Object.keys(states).map(k => <button key={k} type="button" className="v-button" aria-pressed={pick === k} onClick={() => setPick(k)}>{k}</button>)}</div>
    <div data-testid="home-preview"><HomeView m={states[pick]} /></div>
  </div>;
}
