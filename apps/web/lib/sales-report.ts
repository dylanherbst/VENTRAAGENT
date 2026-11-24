import { dealStages } from './local-crm-pipeline.ts';
import type { Deal, DealStage } from './local-crm-pipeline.ts';
import { formatOfferPrice } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';

// Pure, read-only report over saved deals. Every figure comes from the deals passed in.
// Deals only carry `updatedAt` (UTC ISO), so months are the UTC calendar month of the last update.
// Money is never summed across currencies; each currency is reported separately.

export type MoneyByCurrency = Partial<Record<OfferCurrency, number>>;
export type StageTotals = { stage: DealStage; count: number; value: MoneyByCurrency; withoutValue: number };
export type MonthRow = { month: string; count: number; value: MoneyByCurrency; won: number; lost: number };

const openStages: readonly DealStage[] = dealStages.filter(s => s !== 'won' && s !== 'lost');

function add(into: MoneyByCurrency, deal: Deal) {
  if (deal.valueMinor === null) return;
  into[deal.currency] = (into[deal.currency] ?? 0) + deal.valueMinor;
}

export function totalsByStage(deals: readonly Deal[]): StageTotals[] {
  return dealStages.map(stage => {
    const row: StageTotals = { stage, count: 0, value: {}, withoutValue: 0 };
    for (const d of deals) {
      if (d.stage !== stage) continue;
      row.count += 1;
      if (d.valueMinor === null) row.withoutValue += 1; else add(row.value, d);
    }
    return row;
  });
}

function sumStages(deals: readonly Deal[], stages: readonly DealStage[]): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const d of deals) if (stages.includes(d.stage)) add(out, d);
  return out;
}

export const openPipelineValue = (deals: readonly Deal[]) => sumStages(deals, openStages);
export const wonValue = (deals: readonly Deal[]) => sumStages(deals, ['won']);
export const lostValue = (deals: readonly Deal[]) => sumStages(deals, ['lost']);

/** Won / (Won + Lost) by deal count, 0..1. Null when no deal is closed. */
export function winRate(deals: readonly Deal[]): number | null {
  const won = deals.filter(d => d.stage === 'won').length;
  const lost = deals.filter(d => d.stage === 'lost').length;
  return won + lost === 0 ? null : won / (won + lost);
}

export const dealsWithoutValue = (deals: readonly Deal[]) => deals.filter(d => d.valueMinor === null).length;

/** UTC month key (YYYY-MM) of the deal's updatedAt. */
export const dealMonth = (deal: Deal) => deal.updatedAt.slice(0, 7);

export function monthlyBreakdown(deals: readonly Deal[]): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  for (const d of deals) {
    const month = dealMonth(d);
    const row = rows.get(month) ?? { month, count: 0, value: {}, won: 0, lost: 0 };
    row.count += 1;
    add(row.value, d);
    if (d.stage === 'won') row.won += 1;
    if (d.stage === 'lost') row.lost += 1;
    rows.set(month, row);
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function formatMoney(value: MoneyByCurrency): string {
  const parts = Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => `${c} ${formatOfferPrice(v as number)}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function formatRate(rate: number | null): string {
  return rate === null ? 'No closed deals yet' : `${Math.round(rate * 100)}%`;
}

export function describeReport(deals: readonly Deal[]): string[] {
  if (!deals.length) return ['No deals saved yet.'];
  const out: string[] = [];
  const n = (c: number) => `${c} deal${c === 1 ? '' : 's'}`;
  out.push(`You have ${n(deals.length)} saved.`);
  const open = deals.filter(d => openStages.includes(d.stage)).length;
  const openValue = openPipelineValue(deals);
  out.push(`${n(open)} ${open === 1 ? 'is' : 'are'} still open${Object.keys(openValue).length ? `, worth ${formatMoney(openValue)}` : ''}.`);
  const won = deals.filter(d => d.stage === 'won').length;
  const lost = deals.filter(d => d.stage === 'lost').length;
  const rate = winRate(deals);
  out.push(rate === null ? 'No deals are closed yet, so there is no win rate.' : `${won} won and ${lost} lost, a ${formatRate(rate)} win rate by deal count.`);
  const wv = wonValue(deals);
  if (Object.keys(wv).length) out.push(`Won value: ${formatMoney(wv)}.`);
  const lv = lostValue(deals);
  if (Object.keys(lv).length) out.push(`Lost value: ${formatMoney(lv)}.`);
  const nv = dealsWithoutValue(deals);
  if (nv) out.push(`${n(nv)} ${nv === 1 ? 'has' : 'have'} no value and ${nv === 1 ? 'is' : 'are'} not counted in any money total.`);
  return out;
}
