'use server';
// Save and read the entry path for a business. The first-screen choice calls savePathAction; Home reads loadPath (saved value first, the
// older cookie second, then 'existing' so nobody is locked out of the full workspace by mistake).
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { getStoredPath, setStoredPath } from '../../../../lib/aimp/home/path-store';
import type { BusinessPath } from '../../../../lib/aimp/home/path';

export async function savePathAction(business: string, path: unknown): Promise<{ ok: boolean; message: string; path: BusinessPath | null }> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason, path: null };
  if (!checkBusiness(business)) return { ok: false, message: 'We could not find that business.', path: null };
  const r = setStoredPath(business, path);
  return r.ok ? { ok: true, message: 'Saved.', path: r.path } : { ok: false, message: r.message, path: null };
}

export async function loadPath(business: string): Promise<BusinessPath | null> {
  return checkBusiness(business) ? getStoredPath(business) : null;
}
