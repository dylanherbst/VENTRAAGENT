// Display helpers for the Setter Lab (client-safe: no server imports, types only). All costs shown are estimates.
import type { LabTurn } from '../../../lib/front-office/setter/lab';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';

/** A$ with cents, or with 4 decimals below one cent so tiny live turns do not read as free. */
export function formatAud(n: number): string {
  if (!Number.isFinite(n)) return 'A$?';
  const v = Math.max(0, n);
  return v > 0 && v < 0.01 ? `A$${v.toFixed(4)}` : `A$${v.toFixed(2)}`;
}

/** The badge on every turn: LIVE only for a turn the engine marked live with usage attached. Anything else is DEMO. */
export const turnBadge = (t: Pick<LabTurn, 'model' | 'usage'>): 'LIVE' | 'DEMO' => (t.model === 'live' && !!t.usage ? 'LIVE' : 'DEMO');

/** One line of per-turn usage for a live turn, or null for a demo turn. */
export function turnUsageLine(t: Pick<LabTurn, 'model' | 'usage'>): string | null {
  if (turnBadge(t) !== 'LIVE' || !t.usage) return null;
  const u = t.usage;
  const parts = [
    `Tokens in ${u.inputTokens} / out ${u.outputTokens}`,
    `latency ${Math.round(u.latencyMs)} ms`,
    `${u.calls} model call${u.calls === 1 ? '' : 's'}`,
    `estimated cost ${formatAud(u.costAud)}`,
    `model ${u.model}`,
  ];
  if (!u.priceKnown) parts.push('PRICE UNKNOWN: priced at the highest rate');
  if (!u.usageReported) parts.push('some calls reported no usage: worst case counted');
  return parts.join('; ');
}

/** Today's usage line for the Live AI panel. */
export function usageTodayLine(u: LabUsageToday): string {
  return `Today (${u.day}, ${u.timeZone}): spent ${formatAud(u.spentAud)} of ${formatAud(u.capAud)} cap, ${formatAud(u.remainingAud)} remaining (estimate)`;
}
