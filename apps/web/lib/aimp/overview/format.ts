// Display helpers for the overview. Pure. Money stays integer minor units everywhere else; only text goes through here.
import type { Money } from './types.ts';

const SYMBOL: Readonly<Record<string, string>> = { AUD: 'A$', USD: 'US$', NZD: 'NZ$', GBP: '£', EUR: '€' };

/** A usable money amount: a whole number of minor units (never NaN, infinite or fractional) that is safe to add up. */
export const isMinorAmount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

const digitsCache = new Map<string, number>();
/**
 * Minor-unit digits of a currency (USD 2, JPY and KRW 0, KWD 3), read from `Intl.NumberFormat` rather than a hand-written table.
 * A code Intl does not accept falls back to 2.
 */
export function currencyDigits(currency: string): number {
  const hit = digitsCache.get(currency);
  if (hit !== undefined) return hit;
  let d: number;
  try { d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { d = 2; }
  digitsCache.set(currency, d);
  return d;
}

/** `A$12.50`, `A$12`, `-A$3`, `JPY 500` (JPY has no minor unit). Unknown currencies show their code. Decimals follow the currency. */
export function formatMoney(m: Money): string {
  if (!isMinorAmount(m.amountMinor)) return 'amount unavailable'; // never "NaN" or a rounded guess
  const abs = Math.abs(m.amountMinor);
  const sym = SYMBOL[m.currency];
  const d = currencyDigits(m.currency);
  const unit = 10 ** d;
  const num = abs % unit === 0 ? String(abs / unit) : (abs / unit).toFixed(d);
  const sign = m.amountMinor < 0 ? '-' : '';
  return sym ? `${sign}${sym}${num}` : `${sign}${m.currency} ${num}`;
}

export const formatMoneyList = (list: Money[]): string => list.map(formatMoney).join(' + ');

/** `2026-11-14 09:00 UTC` from an ISO string; the input unchanged when it is not a date. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
