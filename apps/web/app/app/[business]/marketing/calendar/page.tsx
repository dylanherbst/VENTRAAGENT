import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../../start/_server/runtime';
import { UnknownBusiness } from '../../overview-view';
import { marketingContexts } from '../contexts';
import { loadCalendar } from './_server/calendar';
import { CalendarView } from './calendar-view';
import { NOTHING_POSTED, NOT_IN_DEMO } from './view-model';
import './calendar.css';

export const metadata: Metadata = { title: 'Campaign calendar' };
export const dynamic = 'force-dynamic';

// Screen 27, draft and export only: the suggested day for each piece of the marketing plan, and a ZIP file of the approved text. Same
// in-memory DEMO runtime as /start and the other workspace pages (lost on restart), and off in production unless the demo tools are
// enabled. Publishing is not connected.
export default async function CalendarPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) {
    return (
      <AppLayout width="regular">
        <AppIntro title="This page is not switched on here" />
        <GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  if (!checkBusiness(business)) return <UnknownBusiness />;

  let found;
  try {
    found = await loadCalendar(runtime(), marketingContexts(), business);
  } catch (e) {
    console.error('[app calendar] could not load the campaign calendar:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Campaign calendar">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your calendar" action={<GlassButton href={`/app/${business}/marketing/calendar`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your marketing plan. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <CalendarView businessId={business} model={found.model} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Campaign calendar">
        <p>The suggested day for each piece of your marketing plan.</p>
      </AppIntro>
      <GlassState kind="empty" title={NOT_IN_DEMO} data-testid="calendar-unavailable">
        <p>This demo does not keep marketing plans or the text written from them, so there is no calendar to show here. No sample calendar is shown in its place.</p>
        <p>{NOTHING_POSTED}</p>
      </GlassState>
      <GlassButton variant="secondary" href={`/app/${business}/marketing`}>Back to Marketing</GlassButton>
    </AppLayout>
  );
}
