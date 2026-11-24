// The one-page shop: a pure view built only from the seller's approved product and their own words. No invented reviews, ratings,
// guarantees or numbers: "what you get" is the product's own claim list, the page count is the real page count, the sample is the
// real sample. Buy now stays honest: it is only live when payments really are.
import type { OfferState } from '../offers/store.ts';
import { pageCount, buyerGets } from '../offers/build.ts';

export interface ShopPage {
  title: string;
  /** One line under the title: who it is for. */
  forWho: string;
  /** The problem it helps with, in the seller's words. */
  problem: string;
  /** Short sales paragraph built from those words. */
  pitch: string;
  whatYouGet: string[];
  facts: string[];
  priceMinor: number;
  priceLabel: string;
  sampleHref: string;
  buy: { label: string; live: boolean; note: string };
  /** What happens after paying; only stated as fact once delivery is live. */
  afterBuying: string;
}

export const money = (minor: number): string => `$${(minor / 100).toFixed(minor % 100 === 0 ? 0 : 2)}`;

const lc = (s: string): string => s.trim().replace(/[.!?]+$/, '');

export function buildShopPage(state: OfferState, business: string, opts: { paymentsLive: boolean }): ShopPage | null {
  const p = state.approved;
  if (!p || !state.answers) return null;
  const spec = p.spec;
  const who = lc(state.answers.helps), problem = lc(state.answers.problem), knows = lc(state.answers.knows);
  const pages = pageCount(spec);
  return {
    title: spec.title,
    forWho: `For ${who}`,
    problem,
    pitch: `If you are ${who} and you want help with ${problem}, this is a ready-to-use ${spec.title.toLowerCase().includes('checklist') ? 'checklist' : 'workbook'} written by someone who knows ${knows}. Work through it at your own pace, on screen or printed.`,
    whatYouGet: buyerGets(spec),
    facts: [`${pages} pages`, 'PDF you can print or fill in on a tablet', 'A4 and US Letter sizes'],
    priceMinor: p.priceMinor,
    priceLabel: money(p.priceMinor),
    sampleHref: `/api/aimp/shop/${business}/sample`,
    buy: opts.paymentsLive
      ? { label: 'Buy now', live: true, note: 'Secure card payment.' }
      : { label: 'Buy now', live: false, note: 'Checkout is not switched on yet, so nothing can be bought here for now.' },
    afterBuying: opts.paymentsLive ? 'After you pay, a private download link is emailed to you.' : 'Once checkout is on, a private download link is emailed to the buyer after payment.',
  };
}
