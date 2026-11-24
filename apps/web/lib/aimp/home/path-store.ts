// Where a business's entry path (new guided / existing full) is kept. In memory like the rest of the demo runtime; the database table
// replaces this later with the same two functions. The front end's cookie is only a fallback for a business with nothing saved here.
import { isBusinessPath, type BusinessPath } from './path.ts';

type G = typeof globalThis & { __aimpPaths?: Map<string, BusinessPath> };
const all = (): Map<string, BusinessPath> => ((globalThis as G).__aimpPaths ??= new Map());

export const MAX_PATHS = 500;

export function getStoredPath(business: string): BusinessPath | null { return all().get(business) ?? null; }

/** Save the choice. Refuses anything that is not exactly 'new' or 'existing', and refuses new businesses once the demo store is full. */
export function setStoredPath(business: string, path: unknown): { ok: true; path: BusinessPath } | { ok: false; message: string } {
  if (!isBusinessPath(path)) return { ok: false, message: 'Choose "Start from zero" or "I already have a business".' };
  const m = all();
  if (!m.has(business) && m.size >= MAX_PATHS) return { ok: false, message: 'The demo is full, so this choice was not saved.' };
  m.set(business, path);
  return { ok: true, path };
}
