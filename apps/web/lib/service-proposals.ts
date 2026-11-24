import { formatOfferPrice, offerCurrencies, offerPriceMinor } from './local-offers.ts';
import type { LocalOffer, OfferCurrency } from './local-offers.ts';

export type ProposalInput = { title: string; recipient: string; email: string; scope: string; terms: string; currency: OfferCurrency; items: { description: string; quantity: string; price: string }[] };
export type Proposal = { version: 1; id: string; profileId: string; packageId: string; packageName: string; title: string; recipient: string; email: string; scope: string; terms: string; currency: OfferCurrency; items: { description: string; quantity: number; amountMinor: number }[] };
export const proposalStorageKey = (profileId: string) => `launchpad.service-proposals.v1.${profileId}`;
const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  return value.trim();
};
export function proposalTotal(items: Proposal['items']): number {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error('Include between 1 and 20 line items.');
  let total = 0;
  for (const item of items) {
    text(item.description, 'Line description', 300);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || !Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) throw new Error('Use quantities from 1 to 1000 and a valid non-negative price.');
    const amount = item.quantity * item.amountMinor;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw new Error('Proposal total is too large.');
    total += amount;
  }
  return total;
}
export function proposalFromPackage(offer: LocalOffer): ProposalInput {
  if (offer.kind !== 'service') throw new Error('Choose a saved service package.');
  return { title: `${offer.name} proposal`.slice(0, 160), recipient: '', email: '', scope: `${offer.outcome}\n\n${offer.delivery}`.slice(0, 7000), terms: '', currency: offer.currency, items: [{ description: offer.name, quantity: '1', price: formatOfferPrice(offer.amountMinor) }] };
}
export function editProposal(proposal: Proposal): ProposalInput {
  return { title: proposal.title, recipient: proposal.recipient, email: proposal.email, scope: proposal.scope, terms: proposal.terms, currency: proposal.currency, items: proposal.items.map(item => ({ description: item.description, quantity: String(item.quantity), price: formatOfferPrice(item.amountMinor) })) };
}
export function saveProposal(input: ProposalInput, identity: Pick<Proposal, 'id' | 'profileId' | 'packageId' | 'packageName'>): Proposal {
  const email = text(input.email, 'Recipient email', 254, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid recipient email or leave it blank.');
  if (!(offerCurrencies as readonly unknown[]).includes(input.currency)) throw new Error('Choose a supported currency.');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) throw new Error('Include between 1 and 20 line items.');
  const items = input.items.map(item => {
    if (typeof item.quantity !== 'string' || !/^\d{1,4}$/.test(item.quantity)) throw new Error('Quantity must be a whole number from 1 to 1000.');
    if (typeof item.price !== 'string' || item.price.length > 18) throw new Error('Enter a bounded line-item price.');
    return { description: text(item.description, 'Line description', 300), quantity: Number(item.quantity), amountMinor: offerPriceMinor(item.price) };
  });
  proposalTotal(items);
  return { version: 1, id: text(identity.id, 'Draft ID', 160), profileId: text(identity.profileId, 'Profile ID', 160), packageId: text(identity.packageId, 'Package ID', 160), packageName: text(identity.packageName, 'Package name', 160), title: text(input.title, 'Title', 160), recipient: text(input.recipient, 'Recipient name', 160), email, scope: text(input.scope, 'Scope', 7000), terms: text(input.terms, 'Terms', 3000), currency: input.currency, items };
}
// Strict restore projects only known fields, validates stored prices before formatting, and never overwrites corrupt data.
export function restoreProposals(raw: string | null, profileId: string): Proposal[] {
  if (raw === null) return [];
  if (raw.length > 256000) throw new Error('Saved proposal data is too large. Nothing was overwritten.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 100) throw new Error('Invalid saved proposals. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const p = value as Proposal;
    if (!p || p.version !== 1 || p.profileId !== profileId) throw new Error('Invalid or mismatched saved proposals. Nothing was overwritten.');
    proposalTotal(p.items);
    const checked = saveProposal(editProposal(p), p);
    if (ids.has(checked.id)) throw new Error('Duplicate proposal IDs. Nothing was overwritten.');
    ids.add(checked.id);
    return checked;
  });
}
export function persistProposal(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, proposal: Proposal): string {
  const key = proposalStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Drafts changed in another tab. Your unsaved changes remain; copy them before reloading saved drafts.');
  const existing = restoreProposals(expectedRaw, profileId);
  const checked = restoreProposals(JSON.stringify([proposal]), profileId)[0];
  const next = existing.some(p => p.id === checked.id) ? existing.map(p => p.id === checked.id ? checked : p) : [...existing, checked];
  if (next.length > 100) throw new Error('This browser supports up to 100 proposal drafts.');
  const raw = JSON.stringify(next);
  if (raw.length > 256000) throw new Error('Proposal storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
