// Integrations (screen 39) on the Peach & Lavender glass library. A server component: it only draws what the view model says.
// Read-only on purpose: there is no button here that connects or disconnects anything, because nothing can be connected yet.
import Link from 'next/link';
import { AppIntro, AppLayout, GlassBadge, GlassCard, GlassNotice } from '../../../design-system/aimp-glass';
import { DEMO_NOTE, paymentsHref } from './view-model';
import type { Fact, IntegrationsVM, ServiceVM } from './view-model';

function FactRow({ name, fact, testId, extra }: { name: string; fact: Fact; testId: string; extra?: string }) {
  return (
    <div className="ain-fact">
      <dt>{name}</dt>
      <dd>
        <span className="ain-badges">
          <GlassBadge tone={fact.tone} data-testid={testId}>{fact.label}</GlassBadge>
          {extra ? <GlassBadge tone="neutral" data-testid={`${testId}-timing`}>{extra}</GlassBadge> : null}
        </span>
        <span>{fact.text}</span>
      </dd>
    </div>
  );
}

function Service({ s }: { s: ServiceVM }) {
  return (
    <li className="ain-service" data-testid={`service-${s.id}`}>
      <h3>{s.name}</h3>
      <p>{s.what}</p>
      <dl className="ain-facts">
        <FactRow name="Your account" fact={s.account} testId={`service-${s.id}-account`} extra={s.timing} />
        <FactRow name="On this site today" fact={s.site} testId={`service-${s.id}-site`} />
      </dl>
    </li>
  );
}

export function IntegrationsView({ businessId, vm }: { businessId: string; vm: IntegrationsVM }) {
  const { stripe } = vm;
  return (
    <AppLayout width="wide">
      <AppIntro title="Integrations" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>The outside services your business can use, and whether each one is connected.</p>
        <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
        <Link href={`/app/${businessId}`} className="plg-link ain-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      <GlassNotice tone="info" title="Nothing to connect yet" live="none" data-testid="connect-note"><p>{stripe.connectNote}</p></GlassNotice>

      <GlassCard heading="h2" title={stripe.name} data-testid="stripe">
        <p>{stripe.what}</p>
        {stripe.sampleNote ? <p className="plg-note" data-testid="stripe-sample-note">{stripe.sampleNote}</p> : null}
        <dl className="ain-facts" data-can-pay={stripe.canTakePayments ? 'yes' : 'no'}>
          <FactRow name="Your Stripe account" fact={stripe.account} testId="stripe-account" extra={stripe.timing ?? undefined} />
          <FactRow name="Stripe on this site" fact={stripe.site} testId="stripe-site" />
        </dl>
        {stripe.outstanding.length ? (
          <>
            <p>Stripe still needs:</p>
            <ul className="ain-list" data-testid="stripe-outstanding">{stripe.outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
          </>
        ) : null}
        <Link href={paymentsHref(businessId)} className="plg-link ain-link" data-target="large" data-testid="to-payments">See payments and payouts</Link>
      </GlassCard>

      <GlassCard heading="h2" title="Other services" data-testid="services">
        <p>You cannot connect your own account to any of these yet. We show what this site does today, so nothing is a surprise.</p>
        <ul className="ain-services">{vm.services.map((s) => <Service key={s.id} s={s} />)}</ul>
      </GlassCard>
    </AppLayout>
  );
}
