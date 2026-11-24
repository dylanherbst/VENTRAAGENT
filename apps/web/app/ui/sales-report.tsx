'use client';
import { useEffect, useState } from 'react';
import { dealStorageKey, restoreDeals } from '../../lib/local-crm-pipeline';
import type { Deal } from '../../lib/local-crm-pipeline';
import { describeReport, dealsWithoutValue, formatMoney, formatRate, lostValue, monthlyBreakdown, openPipelineValue, totalsByStage, winRate, wonValue } from '../../lib/sales-report';

const stageLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function SalesReport({ profileId }: { profileId: string }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    try { setDeals(restoreDeals(localStorage.getItem(dealStorageKey(profileId)), profileId)); setError(''); }
    catch { setDeals([]); setError('Saved deals cannot be read. Nothing was changed.'); }
  }, [profileId]);
  if (deals === null) return <p role="status">Loading…</p>;
  if (error) return <section className="v-glass"><h2>Sales report</h2><p role="alert">{error}</p></section>;
  if (!deals.length) return <section className="v-glass"><h2>Sales report</h2><p>No deals saved yet. Add deals under Opportunities and this report fills in from them.</p></section>;
  const tiles: [string, string][] = [
    ['Open pipeline', formatMoney(openPipelineValue(deals))],
    ['Won value', formatMoney(wonValue(deals))],
    ['Lost value', formatMoney(lostValue(deals))],
    ['Win rate', formatRate(winRate(deals))],
    ['Deals without a value', String(dealsWithoutValue(deals))],
  ];
  return <section className="v-glass" aria-label="Sales report">
    <h2>Sales report</h2>
    <p><span className="v-status">Computed from your saved deals · browser data · no estimates</span></p>
    <ul>{describeReport(deals).map(s => <li key={s}>{s}</li>)}</ul>
    <div className="v-sales-metrics">{tiles.map(([label, value]) => <div className="v-glass" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <h3>By stage</h3>
    <table><thead><tr><th>Stage</th><th>Deals</th><th>Value</th><th>No value</th></tr></thead>
      <tbody>{totalsByStage(deals).map(r => <tr key={r.stage}><td>{stageLabel(r.stage)}</td><td>{r.count}</td><td>{formatMoney(r.value)}</td><td>{r.withoutValue}</td></tr>)}</tbody></table>
    <h3>By month</h3>
    <p><small>Deals are grouped by the month they were last updated (UTC), because saved deals record no created date.</small></p>
    <table><thead><tr><th>Month</th><th>Deals</th><th>Won</th><th>Lost</th><th>Value</th></tr></thead>
      <tbody>{monthlyBreakdown(deals).map(r => <tr key={r.month}><td>{r.month}</td><td>{r.count}</td><td>{r.won}</td><td>{r.lost}</td><td>{formatMoney(r.value)}</td></tr>)}</tbody></table>
  </section>;
}
