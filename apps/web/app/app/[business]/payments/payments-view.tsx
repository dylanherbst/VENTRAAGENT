// Seller payments and payouts (screen 18) on the Peach & Lavender glass library. A server component: it only draws what the view
// model says. Read-only on purpose: there is no button here that connects, pays or pays out anything.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppIntro, AppLayout, GlassBadge, GlassCard, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { DEMO_NOTE } from './view-model';
import type { Fact, PaymentsVM, UnavailableVM } from './view-model';

function Intro({ businessId }: { businessId: string }) {
  return (
    <AppIntro title="Payments" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
      <p>Whether your store can take payments, and whether the money can reach your bank.</p>
      <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
      <Link href={`/app/${businessId}`} className="plg-link apy-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
    </AppIntro>
  );
}

function FactRow({ name, fact, testId, children }: { name: string; fact: Fact; testId: string; children?: ReactNode }) {
  return (
    <div className="apy-fact">
      <dt>{name}</dt>
      <dd>
        <span><GlassBadge tone={fact.tone} data-testid={testId}>{fact.label}</GlassBadge></span>
        <span>{fact.text}</span>
        {children}
      </dd>
    </div>
  );
}

function ProviderCard({ fact }: { fact: Fact }) {
  return (
    <GlassCard heading="h2" title="Payments on this site" data-testid="provider">
      <dl className="apy-facts"><FactRow name="Payment provider (Stripe)" fact={fact} testId="provider-state" /></dl>
    </GlassCard>
  );
}

/** A runtime with no seller source to read: say exactly that, and do not show a pretend account. */
export function PaymentsUnavailable({ businessId, vm }: { businessId: string; vm: UnavailableVM }) {
  return (
    <AppLayout width="wide">
      <Intro businessId={businessId} />
      <GlassState kind="empty" title={vm.title} data-testid="payments-unavailable"><p>{vm.text}</p></GlassState>
      <ProviderCard fact={vm.provider} />
    </AppLayout>
  );
}

export function PaymentsView({ businessId, vm }: { businessId: string; vm: PaymentsVM }) {
  return (
    <AppLayout width="wide">
      <Intro businessId={businessId} />
      {vm.sampleNote ? <GlassNotice tone="info" title="Sample data" live="none" data-testid="sample-note"><p>{vm.sampleNote}</p></GlassNotice> : null}

      <GlassCard heading="h2" title="Taking payments" data-testid="payments">
        <dl className="apy-facts" data-can-pay={vm.canTakePayments ? 'yes' : 'no'}>
          <FactRow name="Your payment account" fact={vm.state} testId="seller-state" />
          <FactRow name="Checkout on your store" fact={vm.checkout} testId="checkout-state" />
        </dl>
      </GlassCard>

      {vm.outstanding.length || vm.next ? (
        <GlassCard heading="h2" title="What is still needed" data-testid="needed">
          {vm.outstanding.length ? (
            <>
              <p>Stripe still needs:</p>
              <ul className="apy-list" data-testid="outstanding">{vm.outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
            </>
          ) : null}
          {vm.next ? (
            <div className="apy-next" data-testid="next-step">
              <h3>Next step: {vm.next.label}</h3>
              <p>{vm.next.why}</p>
              <p className="plg-note">{vm.next.note}</p>
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      <GlassCard heading="h2" title="Payouts" data-testid="payouts">
        <dl className="apy-facts"><FactRow name="Money to your bank" fact={vm.payouts} testId="payout-state" /></dl>
        <p className="plg-note" data-testid="amounts-note">{vm.amountsNote}</p>
      </GlassCard>

      <ProviderCard fact={vm.provider} />
    </AppLayout>
  );
}
