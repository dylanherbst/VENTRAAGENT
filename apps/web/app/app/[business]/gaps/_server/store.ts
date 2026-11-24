// Per-business competitor list for the demo runtime. In memory like the rest of the demo (lost on restart); a database replaces it later.
import type { Competitor } from '../../../../../lib/aimp/gaps/analyse';

const MAX = 8;
const g = globalThis as unknown as { __aimpGaps?: Map<string, Competitor[]> };
const all = (): Map<string, Competitor[]> => (g.__aimpGaps ??= new Map());

export const listCompetitors = (business: string): Competitor[] => [...(all().get(business) ?? [])];
export function saveCompetitor(business: string, c: Competitor): { ok: true } | { ok: false; message: string } {
  const list = listCompetitors(business).filter((x) => x.id !== c.id);
  if (list.length >= MAX) return { ok: false, message: `You can compare up to ${MAX} competitors. Remove one first.` };
  list.push(c); all().set(business, list); return { ok: true };
}
export const removeCompetitor = (business: string, id: string): void => { all().set(business, listCompetitors(business).filter((x) => x.id !== id)); };
export const replaceCompetitors = (business: string, list: Competitor[]): void => { all().set(business, list.slice(0, MAX)); };
