'use client';
import { useId, useState } from 'react';
import { money } from '../../../lib/aimp/preview/generate';
import { profit } from '../../../lib/aimp/preview/profit';
import { site } from '../../../lib/aimp/site-config';

/** You enter the sales; it shows exactly what you'd keep. No forecasts. */
export function ProfitCalculator({ launchPriceMinor }: { launchPriceMinor: number }) {
  const id = useId();
  const paid = site.plans.filter((p) => p.priceAud > 0);
  const [price, setPrice] = useState(launchPriceMinor / 100);
  const [sales, setSales] = useState(20);
  const [plan, setPlan] = useState<string>('launch');
  const [gst, setGst] = useState(false);
  const planAud = paid.find((p) => p.id === plan)?.priceAud ?? 79;
  const r = profit({ priceMinor: Math.round(price * 100), salesPerMonth: sales, planMinor: planAud * 100, gstRegistered: gst });
  const signed = (m: number) => (m < 0 ? `−${money(-m)}` : money(m));
  return (
    <div className="bp-calc">
      <div className="bp-calc-inputs">
        <label htmlFor={`${id}-price`}>Price per sale (A$)
          <input id={`${id}-price`} type="number" inputMode="decimal" min={1} max={500} step={0.5} value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label htmlFor={`${id}-sales`}>Sales per month (your estimate): <strong>{sales}</strong>
          <input id={`${id}-sales`} type="range" min={0} max={300} step={1} value={sales} onChange={(e) => setSales(Number(e.target.value))} />
        </label>
        <label htmlFor={`${id}-plan`}>Plan
          <select id={`${id}-plan`} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {paid.map((p) => <option key={p.id} value={p.id}>{p.name} · A${p.priceAud}/month</option>)}
          </select>
        </label>
        <label className="bp-calc-check"><input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} /> I’m registered for GST</label>
      </div>
      <dl className="bp-calc-out" aria-live="polite">
        <div><dt>Sales</dt><dd>{money(r.grossMinor)}</dd></div>
        <div><dt>Stripe card fees</dt><dd>−{money(r.cardFeesMinor)}</dd></div>
        {gst ? <div><dt>GST to the ATO</dt><dd>−{money(r.gstMinor)}</dd></div> : null}
        <div><dt>{site.name} plan</dt><dd>−{money(r.planMinor)}</dd></div>
        <div className="bp-calc-total"><dt>You keep (before income tax)</dt><dd className={r.profitMinor < 0 ? 'is-neg' : undefined}>{signed(r.profitMinor)}<span>/month</span></dd></div>
      </dl>
      <p className="bp-small bp-muted">
        {r.breakEvenSales === null ? 'At this price a sale doesn’t cover its fees.' : `You cover the plan from ${r.breakEvenSales} sales a month.`} The sales figure is yours to set; we don’t predict it.
      </p>
    </div>
  );
}
