import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassCard, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadHome } from './_server/load-home';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

// Home (rework brief 02): What's ready? What needs me? What happened? Then three preset actions. Same in-memory DEMO runtime as the rest
// of the workspace. Every line comes from real records (orders, delivery, approvals, Inbox); nothing is made up.
export default async function HomePage({ params }: { params: Promise<{ business: string }> }) {
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
  let r;
  try { r = await loadHome(business); } catch {
    return (
      <AppLayout width="regular">
        <AppIntro title="Home" />
        <GlassState kind="error" title="We could not load Home" action={<GlassButton href={`/app/${business}/home`}>Try again</GlassButton>}><p>Nothing was changed.</p></GlassState>
      </AppLayout>
    );
  }
  if (!r.found) return <UnknownBusiness />;
  const { home } = r;
  const row = (x: { text: string; href: string | null }, i: number) => <li key={i}>{x.href ? <a href={x.href}>{x.text}</a> : x.text}</li>;
  return (
    <AppLayout width="regular">
      <AppIntro title={home.headline}><p>Next: {home.next.title}</p></AppIntro>
      {home.next.href ? <GlassButton href={home.next.href}>{home.next.action}</GlassButton> : null}

      <GlassCard title={`Your launch: ${home.checklist.done} of ${home.checklist.total} done`} data-testid="home-checklist">
        <ol>
          {home.checklist.steps.map((st) => (
            <li key={st.label} data-done={st.done ? 'yes' : 'no'} data-current={st.current ? 'yes' : 'no'}>
              {st.done ? '✓ ' : st.current ? '→ ' : '○ '}
              {st.href && !st.done ? <a href={st.href}>{st.label}</a> : st.label}
              {st.current ? ' (do this next)' : ''}
            </li>
          ))}
        </ol>
      </GlassCard>
      {home.needsMe.length ? (
        <GlassCard title="Needs you" data-testid="home-needs"><ul>{home.needsMe.map(row)}</ul></GlassCard>
      ) : null}
      {home.happened.length ? (
        <GlassCard title="What happened" data-testid="home-happened"><ul>{home.happened.map(row)}</ul></GlassCard>
      ) : null}
    </AppLayout>
  );
}
