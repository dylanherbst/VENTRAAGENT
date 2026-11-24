'use client';
// Home in the VENTRA glass kit (docs/design/UI_BIBLE.md). Answers "what happened?" and "what do I do next?".
// Read-only: live numbers come from the shared useLiveSummary hook (GET only); the setup steps are read from what this
// browser has saved. Numbers are never invented: no verified data means "—" and one notice. Markup lives in home-view.tsx.
import { useEffect, useState } from 'react';
import { offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import { auditKey, restoreAudit } from '../../lib/ventra-workspace';
import { opportunityKey, restoreSavedAudit } from '../../lib/growth-opportunity';
import { routeOf, routes } from '../../lib/onboarding';
import { nextStep } from '../../lib/home-steps';
import { useWorkspace } from './ventra-context';
import { useLiveSummary } from './live-summary';
import { useRecentActivity } from './home-activity';
import type { ActivityItem } from './home-activity';
import HomeView from './home-view';
import type { HomeModel } from './home-view';

export default function VentraHome() {
  const { profile, ready, error } = useWorkspace();
  const [offerReady, setOfferReady] = useState(false); const [auditDate, setAuditDate] = useState(''); const [localError, setLocalError] = useState(''); const [auditDone, setAuditDone] = useState(false);
  useEffect(() => {
    function read() { try { setOfferReady(profile ? !!restoreLocalOffers(localStorage.getItem(offerStorageKey(profile.id)), profile)?.length : false); setAuditDate(restoreAudit(localStorage.getItem(auditKey))?.updatedAt || ''); setAuditDone(restoreSavedAudit(localStorage.getItem(opportunityKey))?.step === 6); setLocalError(''); } catch { setOfferReady(false); setAuditDate(''); setLocalError('Some local drafts cannot be read.'); } }
    read(); window.addEventListener('storage', read); window.addEventListener('ventra:updated', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('ventra:updated', read); };
  }, [profile]);
  const live = useLiveSummary();
  const route = profile ? routeOf(profile) : null;
  const auditSaved = auditDone || !!auditDate;
  const steps = [
    { title: 'Set up your business', note: profile ? `${routes.find(r => r.id === route)?.title} · saved in this browser` : 'Tell us your goals and what you do.', href: '/onboarding', done: !!profile },
    { title: profile?.primary === 'education' ? 'Create your first course or offer' : 'Create your first offer', note: offerReady ? 'Offer saved · not published' : 'A service, product or course draft.', href: profile?.primary === 'education' ? '/business?tab=delivery' : '/business?tab=offers', done: offerReady },
    { title: 'Run your free Growth Audit', note: auditSaved ? 'Audit saved in this browser' : 'See where enquiries are slipping.', href: '/grow/audit', done: auditSaved },
    { title: 'Teach your AI team about you', note: 'Optional · FAQs, hours and booking rules.', href: '/customers/ai-team', done: false, optional: true },
  ];
  const local: ActivityItem[] = auditDate ? [{ key: 'local-audit', title: 'Manual audit saved in this browser', when: auditDate, href: '/insights?tab=audit' }] : [];
  const activity = useRecentActivity(live, local);
  const model: HomeModel = {
    name: profile?.name?.trim() ?? '', hasProfile: !!profile, ready, error: error || localError, live, steps, activity,
    next: nextStep(steps),
  };
  return <HomeView m={model} />;
}
