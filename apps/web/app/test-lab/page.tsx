import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassCard, GlassNotice } from '../design-system/aimp-glass';
import { availability } from '../start/_server/runtime';
import { currentMockCustomer } from './lab-state';
import { SeedButton } from './seed-button';

export const metadata: Metadata = { title: 'Test Lab' };
export const dynamic = 'force-dynamic';

const pages = (b: string): { name: string; href: string; test: string }[] => [
  { name: 'Welcome', href: '/start', test: 'New positioning: "Hire your own AI growth team". Activate your AI team goes to onboarding.' },
  { name: 'Onboarding from scratch', href: '/start/existing', test: 'Step 1, then steps 2 to 6: read the website or suggest from answers, connect a test account, goals, automation, Activate (about a minute with a live AI key).' },
  { name: 'Home', href: `/app/${b}/home`, test: 'Agent lights (purple working, green done, red needs you), today\'s plan, results. Press "Do it now" on "Plan the next 7 days".' },
  { name: 'AI Sales', href: `/app/${b}/sales`, test: 'Three DMs waiting: approve the price reply (it should quote A$140 from the profile), see the "real person" chat handed to you.' },
  { name: 'Social Media', href: `/app/${b}/social`, test: 'Plan posts, open one, make an image, edit (new version), approve to the test account, schedule (mock).' },
  { name: 'Marketing', href: `/app/${b}/marketing`, test: 'Write five ad angles; open the Ad angle studio and Competitor research from the links underneath.' },
  { name: 'Business Profile', href: `/app/${b}/profile`, test: 'The one profile: change the booking link and check AI Sales uses the new one.' },
  { name: 'Settings', href: `/app/${b}/settings`, test: 'Profile menu destinations. Startup pages (Products, Website, Payments, Orders) are parked and redirect to Home.' },
];

export default function TestLab() {
  const a = availability();
  if (!a.available) {
    return (
      <AppLayout width="regular">
        <AppIntro title="Test Lab is not switched on here" />
        <GlassNotice tone="warn" title="Demo storage is off"><p>{a.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  const c = currentMockCustomer();
  return (
    <AppLayout width="regular">
      <AppIntro title="Growth Test Lab"><p>A filled-in mock existing business so you can try the AI growth team without typing. Demo data only: nothing reaches Instagram and nothing is charged. It resets when the server restarts.</p></AppIntro>
      <GlassCard title="The mock customer" data-testid="lab-customer">
        <p>Lash Lab Joondalup: a lash and brow studio with a full business profile, a test Instagram account, three customer DMs waiting and competitor research loaded.</p>
        <SeedButton again={!!c} />
      </GlassCard>
      {c ? (
        <>
          <GlassCard title="What was built" data-testid="lab-steps">
            <ul>{c.steps.map((s, i) => <li key={i}>{s.ok ? 'Done' : 'Problem'}: {s.label}. {s.note}</li>)}</ul>
          </GlassCard>
          <GlassCard title="Pages to try, and what to check" data-testid="lab-pages">
            <ul>{pages(c.businessId).map((p) => <li key={p.href}><a href={p.href}>{p.name}</a>: {p.test}</li>)}</ul>
          </GlassCard>
        </>
      ) : null}
    </AppLayout>
  );
}
