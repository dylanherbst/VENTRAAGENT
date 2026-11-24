'use client';
// Three-panel frame for every workspace page (Desktop Carousel UI Bible 1.1): the page you are on sits in the centre and keeps working
// exactly as before; two related pages sit beside it as glass components showing their live data (not links). The Overview page has its own full carousel and is not wrapped. At 690px and below only the
// centre shows and the dock handles navigation.
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChildCard } from './carousel/child-card';
import type { SidePanel } from './carousel/side-data';
import { currentSegment } from './workspace-nav-items';
import './page-stage.css';

interface Related { segment: string; title: string; text: string }
const INFO: Record<string, Related> = {
  '': { segment: '', title: 'Overview', text: 'Launch progress, the next step and your checklist.' },
  home: { segment: 'home', title: 'Home', text: 'What is ready, what needs you and what happened.' },
  offers: { segment: 'offers', title: 'Offer', text: 'Turn what you know into a product people will buy.' },
  products: { segment: 'products', title: 'Products', text: 'Your product files, listings and prices.' },
  brand: { segment: 'brand', title: 'Brand', text: 'Your name, look and wording.' },
  website: { segment: 'website', title: 'Website', text: 'Preview your shop, edit it and publish.' },
  domains: { segment: 'domains', title: 'Domains', text: 'Your shop address.' },
  payments: { segment: 'payments', title: 'Payments', text: 'Get paid by card with Stripe.' },
  marketing: { segment: 'marketing', title: 'Marketing', text: 'Your launch plan, posts and shop link.' },
  orders: { segment: 'orders', title: 'Orders', text: 'Who bought, whether it was paid and delivered.' },
  inbox: { segment: 'inbox', title: 'Inbox', text: 'Messages from customers and suggested replies.' },
  settings: { segment: 'settings', title: 'Settings', text: 'Account, connections and everything else.' },
  integrations: { segment: 'integrations', title: 'Integrations', text: 'Connected accounts and tools.' },
  approvals: { segment: 'approvals', title: 'Approvals', text: 'Things waiting for your yes.' },
  operator: { segment: 'operator', title: 'Operator', text: 'What your AI helpers did and may do.' },
  gaps: { segment: 'gaps', title: 'Competitor gaps', text: 'What other tools miss.' },
  dashboard: { segment: 'dashboard', title: 'Dashboard', text: 'Sales and activity at a glance.' },
};
// [left, right] neighbours for each page, following the shop journey: build, publish, get paid, sell.
const AROUND: Record<string, [string, string]> = {
  home: ['', 'orders'], offers: ['home', 'products'], products: ['offers', 'website'], brand: ['products', 'website'], website: ['products', 'payments'], domains: ['website', 'payments'],
  payments: ['website', 'orders'], marketing: ['products', 'orders'], orders: ['payments', 'marketing'], inbox: ['orders', 'marketing'],
  settings: ['home', 'integrations'], integrations: ['settings', 'approvals'], approvals: ['integrations', 'operator'], operator: ['approvals', 'dashboard'],
  gaps: ['marketing', 'inbox'], dashboard: ['operator', 'orders'],
};

export function PageStage({ business, sides, children }: { business: string; sides: Record<string, SidePanel>; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const first = useRef(true);
  // A layout is not re-rendered when you move between its pages, so ask the server for fresh numbers after each move.
  useEffect(() => { if (first.current) { first.current = false; return; } router.refresh(); }, [pathname, router]);
  const segment = currentSegment(pathname, business);
  if (segment === '') return <>{children}</>;
  const [l, r] = AROUND[segment] ?? ['', 'orders'];
  const side = (key: string, slot: 'left' | 'right') => {
    const d = sides[key];
    const i = INFO[key];
    return (
      <div className="ps-side" data-slot={slot}>
      <aside className="ps-panel" data-slot={slot} aria-label={`${i.title}, at a glance`}>
        <h2>{i.title}</h2>
        {d ? (
          <>
            <ChildCard tint={d.tint}><div className="ps-metric"><p>{d.metric.label}</p><strong>{d.metric.value}</strong>{d.metric.note ? <p>{d.metric.note}</p> : null}</div></ChildCard>
            <ChildCard tint="neutral"><div className="ps-feature"><h3>{d.feature.title}</h3><p>{d.feature.text}</p></div></ChildCard>
            {d.rows.length ? (
              <ul className="ps-rows">
                {d.rows.map((row, n) => (
                  <li key={n} data-done={row.done === null ? undefined : String(row.done)}>
                    <span aria-hidden="true">{row.done === null ? '•' : row.done ? '✓' : '○'}</span>
                    <span>{row.label}</span>
                    {row.done === null ? null : <span className="ps-sr">{row.done ? ' (done)' : ' (to do)'}</span>}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : <p className="ps-none">{i.text}</p>}
      </aside>
      </div>
    );
  };
  return (
    <div className="amg ps-wrap">
      <div className="ps">
        {side(l, 'left')}
        <div className="ps-centre" data-slot="center">{children}</div>
        {side(r, 'right')}
      </div>
    </div>
  );
}
