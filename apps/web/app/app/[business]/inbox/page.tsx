import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassBadge, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { inboxFor } from '../../../start/_server/inbox-runtime';
import type { InboxRuntime } from '../../../start/_server/inbox-runtime';
import { teamSummary } from '../../../../lib/aimp/storeops';
import { UnknownBusiness } from '../overview-view';
import { InboxView } from './inbox-view';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

// The Inbox tab (rework brief 02-04): a buyer's message, a drafted reply, and your decision. Order questions are answered from the real order
// and delivery state of this shop, and only when the sender's email matches the order. Replies go to a test outbox until real email is
// connected. Nothing is sent without your approval. Enquiries use a standard hand-off reply until an AI key is connected.
export default async function InboxPage({ params }: { params: Promise<{ business: string }> }) {
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
  const threads = inboxFor(runtime() as unknown as InboxRuntime).list(business);
  const team = teamSummary({ digitalOnly: true });
  return (
    <AppLayout width="regular">
      <AppIntro title="Inbox" badges={<GlassBadge tone="demo" dot>Test outbox</GlassBadge>}>
        <p>Questions from buyers land here with a suggested reply for you to approve.</p>
      </AppIntro>
      <InboxView business={business} initial={threads} />
      <section aria-label="Your store team" data-testid="store-team">
        <h2>Your store team</h2>
        <p>The jobs a live shop needs covered. Anything that reaches a buyer or moves money waits for your approval.</p>
        <ul>
          {team.map((t) => (
            <li key={t.department}>{t.label}: {t.built ? `${t.built} ready` : 'none ready yet'}{t.next ? `, ${t.next} next` : ''}{t.later ? `, ${t.later} later` : ''}</li>
          ))}
        </ul>
      </section>
    </AppLayout>
  );
}
