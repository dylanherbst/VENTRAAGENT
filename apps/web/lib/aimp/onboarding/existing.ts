// Path 2 entry: "I already have a business". A short form that creates the business record directly, with no idea quiz.
// Pure validation, shared by the page (instant feedback) and the server action (the check that counts).
export const EXISTING_INDUSTRIES = [
  { id: 'beauty', name: 'Beauty, lashes, brows or nails' },
  { id: 'fitness', name: 'Gym, personal training or coaching' },
  { id: 'trades', name: 'Trades or home services' },
  { id: 'ecommerce', name: 'Online shop or physical products' },
  { id: 'digital-products', name: 'Digital products or content' },
  { id: 'ai-services', name: 'AI services or automation' },
  { id: 'software', name: 'Software or an app' },
  { id: 'local-services', name: 'Another local or online service' },
] as const;
export type ExistingIndustry = (typeof EXISTING_INDUSTRIES)[number]['id'];

export interface ExistingBusinessInput { businessName: string; industry: ExistingIndustry; offer: string; audience: string; website: string; timezone: string }
export type ExistingErrors = Partial<Record<keyof ExistingBusinessInput, string>>;

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const validZone = (tz: string) => { try { new Intl.DateTimeFormat('en-AU', { timeZone: tz }); return true; } catch { return false; } };

export function validateExisting(raw: unknown): { ok: true; value: ExistingBusinessInput } | { ok: false; errors: ExistingErrors } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const errors: ExistingErrors = {};
  const businessName = txt(r.businessName, 80);
  const offer = txt(r.offer, 300);
  const audience = txt(r.audience, 200);
  let website = txt(r.website, 300);
  const timezone = txt(r.timezone, 60) || 'Australia/Perth';
  const industry = EXISTING_INDUSTRIES.find((i) => i.id === r.industry)?.id;
  if (businessName.length < 2) errors.businessName = 'Add your business name.';
  if (!industry) errors.industry = 'Choose the closest match.';
  if (offer.length < 3) errors.offer = 'Say what you sell, for example "lash extensions and lifts".';
  if (audience.length < 3) errors.audience = 'Say who your customers are, for example "women in Joondalup aged 25 to 45".';
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    try { const u = new URL(website); if (u.protocol !== 'https:' || !u.hostname.includes('.')) throw new Error('bad'); website = u.toString(); }
    catch { errors.website = 'That does not look like a website address. Leave it blank if you do not have one.'; }
  }
  if (!validZone(timezone)) errors.timezone = 'Time zone not recognised.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { businessName, industry: industry!, offer, audience, website, timezone } };
}

/** Store address from the real business name: lowercase, hyphens, 3 to 40 characters. */
export function slugFor(name: string, suffix = ''): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40 - (suffix ? suffix.length + 1 : 0)).replace(/-+$/, '');
  const s = suffix ? `${base}-${suffix}` : base;
  return s.length >= 3 ? s : `shop-${s || 'new'}`.slice(0, 40);
}
