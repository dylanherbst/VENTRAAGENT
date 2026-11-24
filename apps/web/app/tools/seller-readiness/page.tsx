import { parseFlags } from '../../../lib/aimp/flags';
import { resolveStatus } from '../../../lib/aimp/providers/status';
import { DISCONNECTED_REASON } from '../../../lib/aimp/sellers/connect';
import { FIXTURE_SELLERS } from '../../../lib/aimp/sellers/fixtures';
import { checkoutGate } from '../../../lib/aimp/sellers/gate';
import { deriveReadiness } from '../../../lib/aimp/sellers/readiness';
import { createInMemorySellerStore } from '../../../lib/aimp/sellers/store';

export const dynamic = 'force-dynamic';

const WORKSPACE = 'ws-demo';
const BUSINESS = 'biz-demo';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Isolated test page for seller readiness: real readiness and checkout-gate logic over DEMO fixture Stripe accounts.
export default async function SellerReadinessTest({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const picked = FIXTURE_SELLERS.find((s) => s.key === one(q.seller)) ?? FIXTURE_SELLERS[0];
  const paymentsOff = one(q.payments) === 'off';

  const flags = parseFlags({ ...process.env, ...(paymentsOff ? { AIMP_PAYMENTS_ENABLED: 'off' } : {}) });
  const provider = resolveStatus('payments', process.env, flags);

  const accounts = createInMemorySellerStore();
  if (picked.snapshot) {
    accounts.register({ workspaceId: WORKSPACE, businessId: BUSINESS, stripeAccountId: picked.snapshot.id, snapshot: picked.snapshot, lastEventCreated: 0 });
  }
  const readiness = deriveReadiness(accounts.get(WORKSPACE, BUSINESS)?.snapshot ?? null);
  const gate = checkoutGate({ workspaceId: WORKSPACE, businessId: BUSINESS, accounts, payments: provider });
  const mode = provider.status === 'live' ? 'LIVE' : 'DEMO';
  const keep = (extra: Record<string, string>) => `?${new URLSearchParams(extra).toString()}`;

  return (
    <main>
      <h1>Seller readiness test</h1>
      <p>
        <strong data-testid="page-mode">{mode}</strong> · Real readiness and checkout rules over sample Stripe accounts. No Stripe contact is made.
      </p>
      <p>
        Stripe connection: <strong data-testid="stripe-state">{provider.label}</strong>
        <br />
        Live Stripe adapter: <strong>{DISCONNECTED_REASON}</strong>
      </p>
      <h2>Sample account</h2>
      <ul>
        {FIXTURE_SELLERS.map((s) => (
          <li key={s.key}>
            {s.key === picked.key ? <strong>{s.label} (selected)</strong> : <a href={keep({ seller: s.key, ...(paymentsOff ? { payments: 'off' } : {}) })}>{s.label}</a>}
          </li>
        ))}
      </ul>
      <p>
        {paymentsOff ? <a href={keep({ seller: picked.key })}>Switch payments back on</a> : <a href={keep({ seller: picked.key, payments: 'off' })}>Pretend payments are switched off</a>}
      </p>
      <h2>Result</h2>
      <ul>
        <li>State: <strong data-testid="seller-state">{readiness.state}</strong></li>
        <li>Can accept payments: <strong>{readiness.canAcceptPayments ? 'yes' : 'no'}</strong></li>
        <li>Next step: <strong data-testid="next-action">{readiness.nextAction.label}</strong> ({readiness.nextAction.kind})</li>
        <li>Why: {readiness.nextAction.why}</li>
        <li>Checkout: <strong data-testid="checkout">{gate.enabled ? 'enabled' : `disabled: ${gate.reason}`}</strong></li>
      </ul>
    </main>
  );
}
