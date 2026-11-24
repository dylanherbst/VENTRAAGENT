import Link from 'next/link';
import type { ReactNode } from 'react';
import { OutlineIcon } from './primitives';
import { isOpenable, statusLabel } from '../../lib/feature-registry';
import type { Feature, FeatureStatus } from '../../lib/feature-registry';

const ICONS: Record<string, string> = {
  'course-editor': 'book', 'lesson-quizzes': 'edit', 'learner-preview': 'search', 'course-sales-page': 'sales', 'coaching-programs': 'people', certificates: 'check', 'student-progress': 'chart', 'ai-course': 'bolt', 'video-lessons': 'video', 'student-portal': 'account',
  skills: 'check', evidence: 'search', validate: 'check', pricing: 'sales', branding: 'edit', 'business-plan': 'book', 'launch-checklist': 'rocket', 'ai-idea': 'bolt',
  offers: 'box', proposals: 'edit', agreements: 'edit', invoices: 'receipt', 'client-portal': 'account', 'project-board': 'grid', 'membership-plans': 'people', 'public-booking': 'calendar', 'live-memberships': 'people',
  'website-pages': 'grid', storefront: 'box', 'link-in-bio': 'share', 'ai-website': 'bolt', checkout: 'lock', orders: 'receipt',
  'email-drafts': 'mail', 'funnel-drafts': 'trend', 'email-sending': 'mail', 'content-calendar': 'calendar', 'create-post': 'edit', 'ad-concepts': 'chart', 'create-image': 'image', 'create-video': 'video',
  'lead-forms': 'people', 'growth-plan': 'trend', 'lead-discovery': 'search', 'workflow-drafts': 'bolt', 'workflow-run': 'bolt', 'ai-receptionist': 'phone',
  contacts: 'people', deals: 'sales', 'lead-scoring': 'chart', 'follow-ups': 'bell', appointments: 'calendar', 'client-projects': 'grid', 'sales-reports': 'chart', inbox: 'mail', calendar: 'calendar', 'auto-assign': 'bolt',
  'business-overview': 'chart', 'revenue-insights': 'trend', integrations: 'settings', team: 'people', notifications: 'bell', 'account-save': 'account', billing: 'receipt',
};

export function AvailabilityLabel({ status }: { status: FeatureStatus }) {
  return <span className="v-avail" data-status={status}>{statusLabel(status)}</span>;
}

/** One feature, one look. Working: opens. Local draft: opens, subdued label. Blocked and not started: greyed, no action, reason printed. */
export function FeatureTile({ feature, needs }: { feature: Feature; needs?: { label: string; href: string } }) {
  if (needs) return <div className="v-feature v-glass is-disabled" data-status="not-started" role="group" aria-disabled="true" aria-label={`${feature.name}. ${needs.label} first.`} aria-describedby={`note-${feature.id}`}>
    <span className="v-icon-tile" aria-hidden="true"><OutlineIcon name={ICONS[feature.id] ?? 'grid'} /></span>
    <span className="v-feature-copy"><strong>{feature.name}</strong><span className="v-feature-desc">{feature.description}</span><span className="v-feature-note" id={`note-${feature.id}`}>Not on for your business yet. {needs.label} in your setup to use this.</span><Link className="v-avail" data-status="not-started" href={needs.href}>{needs.label}</Link></span>
  </div>;
  const open = isOpenable(feature);
  const body: ReactNode = <>
    <span className="v-icon-tile" aria-hidden="true"><OutlineIcon name={ICONS[feature.id] ?? 'grid'} /></span>
    <span className="v-feature-copy">
      <strong>{feature.name}</strong>
      <span className="v-feature-desc">{feature.description}</span>
      <span className={feature.availability.startsWith('Saves on this device') ? 'v-sr-only' : 'v-feature-note'} id={`note-${feature.id}`}>{feature.availability}</span>
      <AvailabilityLabel status={feature.status} />
    </span>
    {open && <span className="v-arrow" aria-hidden="true"><OutlineIcon name="arrow" /></span>}
  </>;
  if (open) return <Link className="v-feature v-glass" data-status={feature.status} href={feature.route!} aria-describedby={`note-${feature.id}`}>{body}</Link>;
  return <div className="v-feature v-glass is-disabled" data-status={feature.status} role="group" aria-disabled="true" aria-label={`${feature.name}. ${statusLabel(feature.status)}.`} aria-describedby={`note-${feature.id}`}>{body}</div>;
}

export function PlainTile({ icon, title, text, href }: { icon: string; title: string; text: string; href: string }) {
  return <Link className="v-feature v-glass" data-status="working" href={href}><span className="v-icon-tile" aria-hidden="true"><OutlineIcon name={icon} /></span><span className="v-feature-copy"><strong>{title}</strong><span className="v-feature-desc">{text}</span></span><span className="v-arrow" aria-hidden="true"><OutlineIcon name="arrow" /></span></Link>;
}
