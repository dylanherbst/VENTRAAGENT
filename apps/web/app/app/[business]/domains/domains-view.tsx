// Domains and availability (screen 17) on the Peach & Lavender glass library. A server component: it only draws what the view model says.
import Link from 'next/link';
import { AppIntro, AppLayout, GlassBadge, GlassCard, GlassNotice } from '../../../design-system/aimp-glass';
import { DEMO_NOTE } from './view-model';
import type { DomainsVM } from './view-model';

export function DomainsView({ businessId, vm }: { businessId: string; vm: DomainsVM }) {
  return (
    <AppLayout width="wide">
      <AppIntro title="Domains" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>Where your store lives on the web, and whether visitors can open it right now.</p>
        <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
        <Link href={`/app/${businessId}`} className="plg-link apd-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      <GlassCard heading="h2" title="Your store address" data-testid="address">
        <dl className="apd-facts">
          <div className="apd-fact">
            <dt>Built-in address</dt>
            <dd>
              {vm.address.value ? <span className="apd-value" data-testid="address-value">{vm.address.value}</span> : null}
              <span><GlassBadge tone={vm.address.tone} data-testid="address-state">{vm.address.label}</GlassBadge></span>
              <span>{vm.address.text}</span>
            </dd>
          </div>
          <div className="apd-fact">
            <dt>Published</dt>
            <dd>
              <span><GlassBadge tone={vm.published.tone} data-testid="published-state">{vm.published.label}</GlassBadge></span>
              <span>{vm.published.text}</span>
            </dd>
          </div>
          <div className="apd-fact">
            <dt>Can visitors open it?</dt>
            <dd>
              <span><GlassBadge tone={vm.reach.tone} data-testid="reach-state">{vm.reach.label}</GlassBadge></span>
              <span>{vm.reach.text}</span>
              {vm.reach.href ? (
                <a href={vm.reach.href} className="plg-link apd-link" data-target="large" data-testid="open-store">Open your store<span className="plg-sr"> at {vm.address.value}</span></a>
              ) : null}
            </dd>
          </div>
        </dl>
      </GlassCard>

      {vm.storeName ? (
        <GlassCard heading="h2" title="Pages at this address" data-testid="pages">
          <p>Every store has these pages. They show up at your address once the store is published.</p>
          <ul className="apd-pages">{vm.pages.map((p) => <li key={p}>{p}</li>)}</ul>
        </GlassCard>
      ) : null}

      <GlassNotice tone="info" title={vm.ownDomain.title} live="none" data-testid="own-domain">
        <p><GlassBadge tone="neutral">{vm.ownDomain.label}</GlassBadge></p>
        <p>{vm.ownDomain.text}</p>
      </GlassNotice>
    </AppLayout>
  );
}
