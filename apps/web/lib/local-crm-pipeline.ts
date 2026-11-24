import { formatOfferPrice, offerCurrencies, offerPriceMinor } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';
import type { Contact } from './local-crm-contacts.ts';

export const dealStages = ['new', 'qualified', 'proposal', 'won', 'lost'] as const;
export type DealStage = typeof dealStages[number];

export type DealInput = {
  title: string;
  contactId: string;
  stage: DealStage;
  value: string;
  currency: OfferCurrency;
};

export type Deal = {
  version: 1;
  id: string;
  profileId: string;
  contactId: string;
  title: string;
  stage: DealStage;
  valueMinor: number | null;
  currency: OfferCurrency;
  updatedAt: string;
};

export const dealStorageKey = (profileId: string) => `launchpad.crm-pipeline.v1.${profileId}`;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved deals. Nothing was overwritten.');
  }
  return value;
}

export function blankDealInput(contactId = ''): DealInput {
  return { title: '', contactId, stage: 'new', value: '', currency: 'AUD' };
}

export function editDeal(deal: Deal): DealInput {
  return {
    title: deal.title,
    contactId: deal.contactId,
    stage: deal.stage,
    value: deal.valueMinor === null ? '' : formatOfferPrice(deal.valueMinor),
    currency: deal.currency,
  };
}

function parseValueMinor(value: string, currency: OfferCurrency): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!(offerCurrencies as readonly unknown[]).includes(currency)) throw new Error('Choose a supported currency.');
  return offerPriceMinor(trimmed);
}

function buildDeal(
  input: DealInput,
  identity: Pick<Deal, 'id' | 'profileId'>,
  updatedAt: string,
): Deal {
  if (!(dealStages as readonly unknown[]).includes(input.stage)) throw new Error('Choose a pipeline stage.');
  const valueMinor = parseValueMinor(input.value, input.currency);
  const currency = valueMinor === null ? input.currency : input.currency;
  if (!(offerCurrencies as readonly unknown[]).includes(currency)) throw new Error('Choose a supported currency.');
  return {
    version: 1,
    id: text(identity.id, 'Deal ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    contactId: text(input.contactId, 'Contact', 160),
    title: text(input.title, 'Deal title', 160),
    stage: input.stage,
    valueMinor,
    currency,
    updatedAt: parseUpdatedAt(updatedAt),
  };
}

export function saveDeal(input: DealInput, identity: Pick<Deal, 'id' | 'profileId'>): Deal {
  return buildDeal(input, identity, new Date().toISOString());
}

export function contactNameForDeal(contacts: readonly Contact[], contactId: string): string | null {
  const match = contacts.find(item => item.id === contactId);
  return match ? match.name : null;
}

export function contactExistsInList(contacts: readonly Contact[], contactId: string): boolean {
  return contacts.some(item => item.id === contactId);
}

/** Label for the editor-only select option that preserves an orphan deal's stored contact ID. */
export function missingContactSelectLabel(contactId: string): string {
  const id = contactId.trim();
  const shown = id.length > 28 ? `${id.slice(0, 25)}…` : id;
  return `Missing contact (${shown}) — keep saved ID`;
}

export function filterDeals(
  deals: readonly Deal[],
  contacts: readonly Contact[],
  query: string,
): Deal[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...deals];
  return deals.filter(deal => {
    const contactName = contactNameForDeal(contacts, deal.contactId) ?? '';
    const haystack = `${deal.title} ${contactName} ${deal.stage}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function dealsByStage(deals: readonly Deal[]): Record<DealStage, Deal[]> {
  const grouped = Object.fromEntries(dealStages.map(stage => [stage, [] as Deal[]])) as Record<DealStage, Deal[]>;
  for (const deal of deals) grouped[deal.stage].push(deal);
  return grouped;
}

export function restoreDeals(raw: string | null, profileId: string): Deal[] {
  if (raw === null) return [];
  if (raw.length > 256000) throw new Error('Saved deal data is too large. Nothing was overwritten.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 500) throw new Error('Invalid saved deals. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const record = value as Deal;
    if (!record || record.version !== 1 || record.profileId !== profileId) {
      throw new Error('Invalid or mismatched saved deals. Nothing was overwritten.');
    }
    const checked = buildDeal(editDeal(record), record, parseUpdatedAt(record.updatedAt));
    if (ids.has(checked.id)) throw new Error('Duplicate deal IDs. Nothing was overwritten.');
    ids.add(checked.id);
    return checked;
  });
}

export function persistDeal(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  deal: Deal,
): string {
  const key = dealStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Deals changed in another tab. Your unsaved changes remain; copy them before reloading saved deals.');
  }
  const existing = restoreDeals(expectedRaw, profileId);
  const checked = restoreDeals(JSON.stringify([deal]), profileId)[0];
  const next = existing.some(item => item.id === checked.id)
    ? existing.map(item => (item.id === checked.id ? checked : item))
    : [...existing, checked];
  if (next.length > 500) throw new Error('This browser supports up to 500 deal drafts.');
  const raw = JSON.stringify(next);
  if (raw.length > 256000) throw new Error('Deal storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
