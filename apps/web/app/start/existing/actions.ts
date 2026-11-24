'use server';
// Path 2 entry: creates the business straight from the owner's own details. No idea quiz, no generated name. The brand starts as a
// draft under THEIR name (they approve it later), the AI Team gets the business profile, and the path is saved as "existing".
import { cookies } from 'next/headers';
import { brandAction } from '../actions';
import { availability } from '../_server/runtime';
import { agentTeam } from '../_server/agent-team-runtime';
import { syncKnowledge } from '../_server/knowledge-sync';
import { setStoredPath } from '../../../lib/aimp/home/path-store';
import { slugFor, validateExisting, type ExistingErrors } from '../../../lib/aimp/onboarding/existing';

export type ExistingReply = { ok: true; businessId: string; notes: string[] } | { ok: false; message: string; errors: ExistingErrors };

export async function startExistingBusinessAction(raw: unknown): Promise<ExistingReply> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason, errors: {} };
  const v = validateExisting(raw);
  if (!v.ok) return { ok: false, message: 'A few details need fixing.', errors: v.errors };
  const b = v.value;
  const businessId = `biz-${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
  const notes: string[] = [];

  // Brand draft from their real details, then their real name. The generator's colours pass the readability checks.
  let r = await brandAction(businessId, { kind: 'start', input: { niche: b.offer, audience: b.audience, productType: b.offer }, nameIndex: 0 });
  if (!r.ok) return { ok: false, message: r.message || 'We could not start your business. Nothing was saved.', errors: {} };
  for (const suffix of ['', Math.floor(Math.random() * 36 ** 3).toString(36), Math.floor(Math.random() * 36 ** 4).toString(36)]) {
    r = await brandAction(businessId, { kind: 'save', edits: { name: b.businessName, slug: slugFor(b.businessName, suffix) } });
    if (r.ok) break;
  }
  if (!r.ok) notes.push('We kept a suggested name on your brand draft. Change it to yours on the Brand page.');

  setStoredPath(businessId, 'existing');
  // The front end's path cookie: existing owners see the full workspace (no "Where are you starting from?" question for them).
  (await cookies()).set('aimp_path', 'existing', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true });

  const p = agentTeam().saveProfile(businessId, { businessName: b.businessName, industry: b.industry, offer: b.offer, description: b.offer, audience: b.audience, timezone: b.timezone, website: b.website, bookingUrl: b.website, region: 'Australia', facts: [] }, 'owner');
  if (!p.ok) notes.push('Your AI Team needs a couple more details. You can add them on the AI Team page.');
  else syncKnowledge(businessId);

  return { ok: true, businessId, notes };
}
