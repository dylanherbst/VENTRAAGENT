import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassCard, GlassNotice } from '../design-system/aimp-glass';
import { availability } from '../start/_server/runtime';
import { BUYERS, currentMockCustomer } from './lab-state';
import { SeedButton } from './seed-button';

export const metadata: Metadata = { title: 'Test Lab' };
export const dynamic = 'force-dynamic';

const pages = (b: string, shop: string | null): { name: string; href: string; test: string }[] => [
  { name: 'Template gallery', href: '/test-lab/templates', test: 'All 15 store templates side by side. Then Website, Pick a template, to apply one to the mock shop.' },
  { name: 'AI Setter (new)', href: `/app/${b}/setter`, test: 'Inbox and test tab: type "how much is the dinner plan?" as a customer and get a draft; approve it. Try "stop", "can I talk to a real person", and "Stop all sending". Setup tab: switch to automatic replies (needs the tick box). Results tab: counts. All simulated: nothing reaches Instagram.' },
  { name: 'AI Team (new)', href: `/app/${b}/ai-team`, test: 'Agent settings: describe the business (pick Fitness). AI Team: press "Five ads + 7 days of posts". Social & calendar: open a post, Make image, edit, connect a mock Instagram in Connections, approve, Schedule. Everything says mock until keys are set.' },
  { name: 'Ad angles (new)', href: `/app/${b}/marketing/angles`, test: 'Fill the brief and press Write 5 angles. Each card is a different approach. Edit one, approve it. Add a number like "5,000 happy customers" and see it flagged before you can approve.' },
  { name: 'Marketing studio (yours)', href: '/studio/marketing', test: 'Your own AiMoneyPrinter ads: load any of the 20 playbook niches, edit and approve.' },
  { name: 'Offer builder (new)', href: `/app/${b}/offers`, test: 'Answer the three questions, pick an offer, edit the steps, preview the sample PDF, set a price and approve. The message says whether it went into your shop.' },
  { name: 'One-page shop (new)', href: `/shop/${b}`, test: 'Appears after you approve an offer. Sales copy, free sample PDF, what buyers get, Buy now bar on a phone (checkout is still off and says so).' },
  { name: 'Home', href: `/app/${b}/home`, test: 'Needs-me, ready and happened lists. Press "Send my weekly brief" with any email (test outbox only).' },
  { name: 'Inbox', href: `/app/${b}/inbox`, test: 'Three waiting drafts. Approve and send one, press "I will handle it" on another, add your own test message.' },
  { name: 'Orders', href: `/app/${b}/orders`, test: 'Two paid, delivered orders. Open one and check the delivery shows once.' },
  { name: 'Products', href: `/app/${b}/products`, test: 'The product file and listing. Open the file.' },
  { name: 'Marketing', href: `/app/${b}/marketing`, test: 'The launch plan. Check every post names the right product, price and shop link.' },
  { name: 'Competitor gaps', href: `/app/${b}/gaps`, test: 'Ranked gaps from the worked example. Add a competitor of your own and watch the ranking change.' },
  { name: 'Website', href: `/app/${b}/website`, test: 'Edit the heading and publish a change.' },
  { name: 'Brand, Domains, Payments', href: `/app/${b}/payments`, test: 'Payments shows "not connected" honestly: no real Stripe yet.' },
  { name: 'Approvals and Operator', href: `/app/${b}/approvals`, test: 'What the AI helpers did and may do.' },
  { name: 'Dashboard', href: `/app/${b}/dashboard`, test: 'Sales and activity at a glance. Visits show "not measured yet", never zero.' },
  ...(shop ? [{ name: 'Public shop (what a buyer sees)', href: `/s/${shop}`, test: 'Product page, policies and contact form. The buy button stays off until payments are connected.' }] : []),
  { name: 'Guided setup from scratch', href: '/start', test: 'Run as a brand new user on your phone: idea, file, publish, test payment, replay, launch kit.' },
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
      <AppIntro title="AIMoneyPrinter Test Lab"><p>A filled-in mock customer so you can try every feature without typing. Everything here is demo data: payments and email are fixtures and nothing leaves this server. It resets when the server restarts.</p></AppIntro>
      <GlassCard title="The mock customer" data-testid="lab-customer">
        <p>A side hustler with a day job, five hours a week, no audience. Their shop is published, with two paid orders ({BUYERS.join(' and ')}), three Inbox messages waiting, and competitor gaps loaded.</p>
        <SeedButton again={!!c} />
      </GlassCard>
      {c ? (
        <>
          <GlassCard title="What was built" data-testid="lab-steps">
            <ul>{c.steps.map((s, i) => <li key={i}>{s.ok ? 'Done' : 'Problem'}: {s.label}. {s.note}</li>)}</ul>
          </GlassCard>
          <GlassCard title="Pages to try, and what to check" data-testid="lab-pages">
            <ul>{pages(c.businessId, c.shopSlug).map((p) => <li key={p.href}><a href={p.href}>{p.name}</a>: {p.test}</li>)}</ul>
          </GlassCard>
        </>
      ) : null}
    </AppLayout>
  );
}
