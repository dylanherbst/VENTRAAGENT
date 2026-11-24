// The buyer's order confirmation + delivery email (AMP-042). Plain text. It carries the signed download link from the files
// grant service and nothing about where the file is stored. No markup, no line breaks from stored text in the subject.
import type { Grant } from '../files/types.ts';
import type { Order } from '../orders/types.ts';
import { currencyDigits } from '../overview/format.ts';

/** Control characters (line breaks included) become spaces, so stored text can never add a header or a fake line. */
export const oneLine = (s: string, max: number): string => s.replace(/\p{Cc}+/gu, ' ').trim().slice(0, max);
// Decimals follow the currency (AMP-099) via the shared currencyDigits (overview/format.ts): JPY 0, USD 2, KWD 3. AUD/USD text is unchanged.
export const formatMoney = (amountMinor: number, currency: string): string => {
  const d = currencyDigits(currency);
  return `${currency === 'AUD' ? 'A$' : ''}${(amountMinor / 10 ** d).toFixed(d)} ${currency}`;
};

export interface DeliveryEmailInput {
  order: Pick<Order, 'id' | 'title' | 'amountMinor' | 'currency' | 'buyerEmail' | 'productVersion'>;
  storeName: string;
  /** Full download URL built from the grant token. */
  downloadUrl: string;
  grant: Pick<Grant, 'expiresAt' | 'maxDownloads'>;
  /** True when support sent a fresh link for an order that was already delivered. */
  reissue: boolean;
}

export function composeDeliveryEmail(i: DeliveryEmailInput): { to: string; subject: string; text: string } {
  const store = oneLine(i.storeName, 80) || 'the store';
  const title = oneLine(i.order.title, 120) || 'your download';
  const until = new Date(i.grant.expiresAt).toUTCString();
  const lines = i.reissue
    ? [`Hi,`, ``, `Here is a fresh download link for your order from ${store}. Any earlier link for this order no longer works.`]
    : [`Hi,`, ``, `Thanks for your order from ${store}. Your payment was received and your download is ready.`];
  lines.push(
    ``,
    `Order reference: ${i.order.id}`,
    `Item: ${title}`,
    `Paid: ${formatMoney(i.order.amountMinor, i.order.currency)}`,
    ``,
    `Download your file:`,
    i.downloadUrl,
    ``,
    `This link is for you only. It works until ${until} and for up to ${i.grant.maxDownloads} downloads.`,
    `If it stops working, contact ${store} with your order reference and a new link can be sent.`,
  );
  return {
    to: i.order.buyerEmail,
    subject: i.reissue ? `Your new download link from ${store}: ${title}` : `Your order from ${store}: ${title}`,
    text: lines.join('\n'),
  };
}
