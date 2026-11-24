// Calendar-day helpers for the launch window (AMP-050). Pure: dates are YYYY-MM-DD strings in UTC and no clock is read here.
import type { CampaignContentItem, CampaignSchedule } from './types.ts';

export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch milliseconds of UTC midnight for a real YYYY-MM-DD date, otherwise null (so 2026-02-30 is refused). */
export function parseDay(day: unknown): number | null {
  if (typeof day !== 'string') return null;
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

/** The UTC calendar day of an instant. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `start` plus `n` whole days. `start` must already be a valid day. */
export function addDays(start: string, n: number): string {
  const ms = parseDay(start);
  if (ms === null) throw new RangeError('start must be a YYYY-MM-DD date');
  return new Date(ms + n * DAY_MS).toISOString().slice(0, 10);
}

export const isWindow = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_WINDOW_DAYS;

/** The dated schedule for a list of items: one entry per day of the window, quiet days included. */
export function scheduleFor(startDate: string, windowDays: number, items: readonly Pick<CampaignContentItem, 'id' | 'day'>[]): CampaignSchedule {
  return {
    startDate,
    endDate: addDays(startDate, windowDays - 1),
    windowDays,
    days: Array.from({ length: windowDays }, (_, i) => ({
      day: i + 1,
      date: addDays(startDate, i),
      itemIds: items.filter((it) => it.day === i + 1).map((it) => it.id),
    })),
  };
}
