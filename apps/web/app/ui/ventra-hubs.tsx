'use client';
import type { ReactNode } from 'react';
import { featureById, pathwayNeeded } from '../../lib/feature-registry';
import type { Feature } from '../../lib/feature-registry';
import { FeatureTile, PlainTile } from '../design-system/feature-tile';
import { useWorkspace } from './ventra-context';
import { ExportLink } from '../design-system/export-link';

type Group = { id: string; title: string; intro: string; ids: readonly string[]; extra?: ReactNode };
const pick = (ids: readonly string[]) => ids.map(featureById).filter((x): x is Feature => !!x);

function Groups({ groups, openFirst = 1 }: { groups: readonly Group[]; openFirst?: number }) {
  const { profile } = useWorkspace();
  const needs = (x: Feature) => { const w = pathwayNeeded[x.id]; return profile && w && !profile.pathways.includes(w) ? { label: w === 'education' ? 'Turn on Courses' : 'Turn on Services', href: '/onboarding' } : undefined; };
  return <div className="v-hub">{groups.map((g, i) => {
    const items = pick(g.ids);
    const ready = items.filter(x => x.status === 'working' && !needs(x)).length;
    const draft = items.filter(x => x.status === 'local-draft').length;
    const setup = items.filter(x => x.status === 'blocked' || ((x.status === 'working' || x.status === 'local-draft') && needs(x))).length;
    const soon = items.filter(x => x.status === 'not-started').length;
    const counts = [ready && `${ready} ready`, draft && `${draft} draft`, setup && `${setup} needs setup`, soon && `${soon} coming soon`].filter(Boolean).join(' · ');
    return <details className="v-hub-group v-glass" key={g.id} open={i < openFirst}>
      <summary><span><strong>{g.title}</strong><small>{g.intro}</small></span><span className="v-hub-count">{counts}</span></summary>
      <div className="v-tiles">{items.map(x => <FeatureTile key={x.id} feature={x} needs={needs(x)} />)}{g.extra}</div>
    </details>;
  })}</div>;
}

export function HubHeading({ title, description }: { title: string; description: string }) {
  return <div className="v-page-heading"><div><span className="v-eyebrow">YOUR WORKSPACE</span><h1>{title}</h1><p>{description}</p></div><ExportLink /></div>;
}

const create: Record<string, Group> = {
  courses: { id: 'courses', title: 'Courses & Coaching', intro: 'Course details, lessons, quizzes, preview and sales page.', ids: ['course-editor', 'lesson-quizzes', 'learner-preview', 'course-sales-page', 'coaching-programs', 'certificates', 'student-progress', 'ai-course', 'video-lessons', 'student-portal'] },
  start: { id: 'start', title: 'Start a Business', intro: 'Skills, idea, validation, pricing, branding, plan and launch checklist.', ids: ['skills', 'evidence', 'validate', 'pricing', 'branding', 'business-plan', 'launch-checklist', 'ai-idea'] },
  services: { id: 'services', title: 'Services & Offers', intro: 'Offers, proposals, agreements, invoice drafts, client portal and projects.', ids: ['offers', 'proposals', 'agreements', 'invoices', 'client-portal', 'project-board', 'membership-plans', 'public-booking', 'live-memberships'] },
  website: { id: 'website', title: 'Website & Store', intro: 'Page drafts, storefront and link in bio. Nothing is published.', ids: ['website-pages', 'storefront', 'link-in-bio', 'ai-website', 'checkout', 'orders'] },
};

/** The group for the user's onboarding route comes first and is open. */
export function CreateHub() {
  const { profile } = useWorkspace();
  const order = !profile ? ['services', 'courses', 'start', 'website']
    : profile.primary === 'education' ? ['courses', 'services', 'website', 'start']
    : profile.stage === 'idea' ? ['start', 'services', 'website', 'courses']
    : ['services', 'website', 'start', 'courses'];
  return <div className="v-hub-page">
    <HubHeading title="What do you want to create?" description="Everything here is a draft you can save. Nothing is published, sent or charged." />
    {!profile && <p className="v-hub-note">Finish setup so we can put the right area first.</p>}
    <Groups groups={order.map(k => create[k])} />
  </div>;
}

const grow: Group[] = [
  { id: 'marketing', title: 'Marketing', intro: 'Campaigns, funnels and email drafts.', ids: ['email-drafts', 'funnel-drafts', 'email-sending'] },
  { id: 'content', title: 'Content Studio', intro: 'Create Post, Create Ad, Create Image, Create Video, Plan Content.', ids: ['create-post', 'ad-concepts', 'create-image', 'create-video', 'content-calendar'] },
  { id: 'leads', title: 'Lead Generation', intro: 'Find Customers and Follow Up.', ids: ['lead-forms', 'follow-ups', 'growth-plan', 'lead-discovery'] },
  { id: 'automation', title: 'Automations', intro: 'A saved workflow is a plan. It is not running.', ids: ['workflow-drafts', 'workflow-run'] },
  { id: 'receptionist', title: 'AI Receptionist', intro: 'Not available yet. No calls are answered.', ids: ['ai-receptionist'] },
];
export function GrowHub() {
  return <div className="v-hub-page">
    <HubHeading title="Let’s grow your business" description="Plan and draft by hand. Nothing is sent, posted or run for you." />
    <Groups groups={grow} />
  </div>;
}

const customers: Group[] = [
  { id: 'people', title: 'Your customers', intro: 'Contacts, deals, follow-ups.', ids: ['contacts', 'deals', 'follow-ups', 'lead-scoring'] },
  { id: 'work', title: 'Appointments & projects', intro: 'Availability drafts and client work.', ids: ['appointments', 'client-projects', 'sales-reports'] },
  { id: 'later', title: 'Coming later', intro: 'Needs a connection that is not set up.', ids: ['inbox', 'calendar', 'auto-assign'] },
];
export function CustomersHub() {
  return <div className="v-hub-page">
    <HubHeading title="Customers" description="Keep relationships simple. Nothing is sent to anyone from here." />
    <Groups groups={customers} openFirst={2} />
  </div>;
}

const more: Group[] = [
  { id: 'insights', title: 'Insights & Reports', intro: 'Drafts worked out from what you saved.', ids: ['business-overview', 'sales-reports', 'revenue-insights'], extra: <PlainTile icon="trend" title="Growth audit" text="A manual review you write yourself." href="/insights?tab=audit" /> },
  { id: 'connections', title: 'Integrations & Team', intro: 'What is connected and who is in your workspace.', ids: ['integrations', 'team', 'notifications'] },
  { id: 'account', title: 'Account, Billing, Settings & Help', intro: 'Your saved data, plan and support.', ids: ['account-save', 'billing'], extra: <><PlainTile icon="settings" title="Settings" text="Profile, notifications and connections." href="/settings" /><PlainTile icon="help" title="Help" text="Plain answers and how to get support." href="/settings?section=help" /></> },
];
export function MoreHub() {
  return <div className="v-hub-page">
    <HubHeading title="More" description="Reports, connections, your account and help." />
    <Groups groups={more} openFirst={3} />
  </div>;
}
