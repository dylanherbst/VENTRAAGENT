// View model for Domains and availability (screen 17, AMP-088). Pure: no Next, no runtime, no environment. It turns what the server
// read (the store name, its published state from the store registry, and the store web address this site is set up for) into the
// words the page shows. It never invents an address or a "connected" state: a link is offered only when the store is live AND this
// site really serves it at that address.

export type Tone = 'neutral' | 'success' | 'warn' | 'danger';
export type PublishedState = 'live' | 'paused' | 'none';

export interface DomainsInput {
  /** The store name (slug) this business saved, or null when it has none yet. */
  slug: string | null;
  /** True when the slug passes the store address rules (lib/aimp/hosts/slug.ts). */
  slugOk: boolean;
  /** From the store registry over this runtime's site versions. Drafts read as `none`. */
  published: PublishedState;
  /** The live version number, when live. */
  version: number | null;
  /** The built-in address on the store domain this site is set up with, or null when no store domain is set up. */
  host: { name: string; via: 'root' | 'test' } | null;
  /** True only when the public store pages of this site read the same store data this page reads. */
  served: boolean;
  /** True when the store is a demo store (it shows a demo banner and lives only in this demo server). Missing reads as demo: fail honest. */
  demo?: boolean;
  /** The pages every store has (from lib/aimp/hosts/paths.ts plus the fixed ones). */
  policyPages: readonly string[];
}

export interface Fact { label: string; tone: Tone; text: string }

export interface DomainsVM {
  /** Null when the business has no store name yet. */
  storeName: string | null;
  address: Fact & { value: string | null };
  published: Fact;
  reach: Fact & { href: string | null };
  pages: string[];
  ownDomain: { title: string; label: string; text: string };
}

export const DEMO_NOTE = 'This is the demo. What you see here is kept in memory on this computer and is lost when the app restarts.';
export const OWN_DOMAIN_TITLE = 'Your own domain: coming later';
export const OWN_DOMAIN_TEXT =
  'Using a web address you own (like yourshop.com) is not built yet. You cannot connect one today, and nothing here is connected. When it is ready, this is where you will set it up.';

const POLICY_NAMES: Record<string, string> = { refund: 'Refund policy', privacy: 'Privacy policy', terms: 'Terms' };

export const domainsHref = (businessId: string): string => `/app/${businessId}/domains`;

function addressFact(i: DomainsInput): DomainsVM['address'] {
  if (!i.slug) {
    return { value: null, label: 'No address yet', tone: 'neutral', text: 'Your store gets its address when you choose a store name while building your website.' };
  }
  if (!i.slugOk) {
    return { value: null, label: 'Needs a new name', tone: 'warn', text: `The store name "${i.slug}" cannot be used as a web address. Choose another name while building your website.` };
  }
  if (!i.host) {
    return {
      value: null, label: 'Not set up on this site', tone: 'neutral',
      text: `Your store name is "${i.slug}". This site has no store web address set up yet, so there is no link to share. Your name is saved and will become your address when that is switched on.`,
    };
  }
  if (i.host.via === 'test') {
    return { value: i.host.name, label: 'Testing address', tone: 'neutral', text: 'This address only works on this computer for testing. It is not on the internet.' };
  }
  return { value: i.host.name, label: 'Built-in address', tone: 'neutral', text: 'This address comes with your store. You do not need to buy anything to use it.' };
}

function publishedFact(i: DomainsInput): Fact {
  if (!i.slug) return { label: 'No store yet', tone: 'neutral', text: 'There is no store to publish yet.' };
  if (i.published === 'live') {
    return { label: 'Published', tone: 'success', text: i.version ? `Version ${i.version} of your store is the published one.` : 'Your store has a published version.' };
  }
  if (i.published === 'paused') return { label: 'Paused', tone: 'warn', text: 'Your store is paused. Visitors would see a "temporarily unavailable" page until you resume it.' };
  return { label: 'Not published', tone: 'neutral', text: 'Your store has not been published yet, so visitors cannot see it.' };
}

function reachFact(i: DomainsInput): DomainsVM['reach'] {
  const no = (label: string, tone: Tone, text: string): DomainsVM['reach'] => ({ label, tone, text, href: null });
  if (!i.slug || !i.slugOk) return no('Not reachable', 'neutral', 'Visitors cannot open your store because it has no usable address yet.');
  if (i.published === 'paused') return no('Not reachable', 'warn', 'Visitors cannot open your store while it is paused.');
  if (i.published !== 'live') return no('Not reachable', 'neutral', 'Visitors cannot open your store until you publish it.');
  if (!i.served) {
    return no('Not reachable in the demo', 'warn',
      'Your store is published inside this demo only. The public store pages of this site do not show stores made in the demo yet, so there is no link visitors can open.');
  }
  if (!i.host) return no('No public address yet', 'warn', 'Your store is published, but this site has no store web address set up yet, so there is no link to share.');
  // No check that the address really opens has run, so these say "Address ready", never "Reachable".
  if (i.host.via === 'test') return no('Address ready on this computer only', 'neutral', `Your store is published and is set up at ${i.host.name} on this computer for testing. Nothing has checked that it opens.`);
  const text = i.demo === false
    ? 'Your store is published and set up at your built-in address. Nothing has checked that visitors can open it yet.'
    : 'This is a demo store and it shows a demo banner. It can be opened only while this demo server is running.';
  return { label: 'Address ready', tone: 'success', text, href: `https://${i.host.name}` };
}

export function buildDomains(i: DomainsInput): DomainsVM {
  const policies = i.policyPages.map((p) => POLICY_NAMES[p] ?? p);
  return {
    storeName: i.slug,
    address: addressFact(i),
    published: publishedFact(i),
    reach: reachFact(i),
    pages: ['Home page', 'A page for each product', ...policies, 'Contact page'],
    ownDomain: { title: OWN_DOMAIN_TITLE, label: 'Coming', text: OWN_DOMAIN_TEXT },
  };
}
