'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buildPlan, routeOf } from '../../lib/onboarding';
import type { Profile, RouteId } from '../../lib/onboarding';
import { educationCourseStorageKey, restoreEducationCourseDraft } from '../../lib/local-education-course';
import { followUpCounts, followupStorageKey, restoreFollowUps } from '../../lib/local-lead-followups';
import type { Overview } from '../../lib/business-overview';
import { EmptyNote, Panel, ProgressList } from '../design-system/charts';
import { OutlineIcon } from '../design-system/primitives';

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const primaryAction = (route: RouteId | null): { label: string; href: string; note: string } =>
  route === 'education' ? { label: 'Continue My Course', href: '/business?tab=delivery', note: 'Pick up your course where you left it.' }
  : route === 'independent' ? { label: 'Continue Building My Business', href: '/create', note: 'Your launch steps are in Create.' }
  : route === 'grow' ? { label: 'Grow My Business', href: '/grow', note: 'Marketing, content and follow-ups.' }
  : { label: 'Set Up My Business', href: '/onboarding', note: 'Two minutes, then Home is personal to you.' };

/** One personalised primary action. No banner. */
export function PrimaryAction({ profile }: { profile: Profile | null }) {
  const a = primaryAction(profile ? routeOf(profile) : null);
  return <section className="v-primary-action v-glass" aria-label="Your next step">
    <div><span className="v-eyebrow">NEXT STEP</span><p>{a.note}</p></div>
    <Link className="v-button v-button-primary v-action-btn" href={a.href}>{a.label} <OutlineIcon name="arrow" /></Link>
  </section>;
}

type Saved = { lessons: number | null; courseTitle: string; followups: { open: number; overdue: number; total: number } | null; unreadable: boolean };

/** Route-specific progress, from saved data only. */
export function RouteProgress({ profile, overview }: { profile: Profile | null; overview: Overview | null }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    if (!profile) { setSaved(null); return; }
    const run = () => {
      try {
        const course = restoreEducationCourseDraft(localStorage.getItem(educationCourseStorageKey(profile.id)), profile.id);
        const list = restoreFollowUps(localStorage.getItem(followupStorageKey(profile.id)), profile.id);
        const c = list ? followUpCounts(list, todayLocal()) : null;
        setSaved({ lessons: course ? course.lessons.length : null, courseTitle: course?.title ?? '', followups: list && c ? { open: c.overdue + c['due-today'] + c.upcoming + c['no-date'], overdue: c.overdue, total: list.tasks.length } : null, unreadable: false });
      } catch { setSaved({ lessons: null, courseTitle: '', followups: null, unreadable: true }); }
    };
    run();
    window.addEventListener('storage', run); window.addEventListener('ventra:updated', run);
    return () => { window.removeEventListener('storage', run); window.removeEventListener('ventra:updated', run); };
  }, [profile]);
  if (!profile) return <Panel title="Your progress"><EmptyNote href="/onboarding" cta="Set up my business">Your progress appears here once you set up your business.</EmptyNote></Panel>;
  const route = routeOf(profile);
  if (saved?.unreadable) return <Panel title="Your progress"><p role="alert">Some saved work could not be read, so progress is not shown. Nothing was changed.</p></Panel>;
  if (route === 'education') {
    return <Panel title="Course progress" sub="From the course saved in this browser" action={<Link href="/business?tab=delivery">Open</Link>}>
      {saved?.lessons ? <ProgressList rows={[{ label: saved.courseTitle || 'Untitled course', value: saved.lessons, of: saved.lessons, display: `${saved.lessons} lesson${saved.lessons === 1 ? '' : 's'} written` }]} />
        : <EmptyNote href="/business?tab=delivery" cta="Start a course">No course saved yet.</EmptyNote>}
    </Panel>;
  }
  if (route === 'independent') {
    const plan = buildPlan(profile);
    const done = plan.filter(s => profile.completed.includes(s.id)).length;
    return <Panel title="Launch checklist" sub="Steps you marked as reviewed" action={<Link href="/create">Open</Link>}>
      <ProgressList rows={[{ label: 'Launch plan steps reviewed', value: done, of: plan.length }]} />
    </Panel>;
  }
  const camp = overview?.campaigns.status === 'ok' ? overview.campaigns.value : null;
  return <Panel title="Follow-ups and campaigns" sub="From what you saved" action={<Link href="/grow">Open</Link>}>
    {saved?.followups || camp ? <ProgressList rows={[
      ...(saved?.followups ? [{ label: 'Follow-ups still to do', value: saved.followups.open, of: Math.max(saved.followups.total, 1), display: `${saved.followups.open} of ${saved.followups.total}${saved.followups.overdue ? ` (${saved.followups.overdue} overdue)` : ''}` }] : []),
      ...(camp ? [{ label: 'Email campaign drafts', value: camp.byStatus.draft + camp.byStatus.ready, of: Math.max(camp.total, 1), display: `${camp.total} saved (${camp.byStatus.draft} draft, ${camp.byStatus.ready} ready)` }] : []),
    ]} /> : <EmptyNote href="/grow" cta="Open Grow">No follow-ups or campaigns saved yet.</EmptyNote>}
  </Panel>;
}
