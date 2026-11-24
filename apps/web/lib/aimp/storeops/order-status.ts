// First Store-team journey: order-status message -> verified order lookup -> reply -> activity entry.
// Pure. The caller supplies order facts it already read from the order and fulfilment stores; nothing here sends anything.

export interface OrderFacts {
  orderId: string;
  buyerEmail: string;
  title: string;
  /** Same values the orders module uses. */
  payment: 'pending' | 'paid' | 'refunded' | 'failed';
  delivery: 'not_started' | 'in_progress' | 'delivered' | 'failed' | 'needs_review' | 'revoking' | 'access_revoked';
  deliveredAt: string | null;
  /** Physical orders only. Digital orders leave this out. */
  parcels?: { carrier: string; trackingUrl: string | null; state: 'in_transit' | 'delivered' }[];
}

export interface OrderQuestion { fromEmail: string; /** Order reference quoted in the message, if any. */ orderRef?: string | null }

export type LookupResult =
  | { found: true; order: OrderFacts }
  | { found: false; reason: 'not_verified' | 'ambiguous' | 'none' };

const norm = (s: string): string => s.trim().toLowerCase();

/** Verified lookup: the sender's email must equal the order's. Several orders need a reference; a wrong reference never reveals another order. */
export function lookupOrder(orders: readonly OrderFacts[], q: OrderQuestion): LookupResult {
  const mine = orders.filter((o) => norm(o.buyerEmail) === norm(q.fromEmail));
  if (!mine.length) return { found: false, reason: orders.some((o) => q.orderRef && o.orderId === q.orderRef) ? 'not_verified' : 'none' };
  if (q.orderRef) {
    const hit = mine.find((o) => o.orderId === q.orderRef);
    return hit ? { found: true, order: hit } : { found: false, reason: 'none' };
  }
  return mine.length === 1 ? { found: true, order: mine[0]! } : { found: false, reason: 'ambiguous' };
}

export type ReplyKind = 'delivered' | 'on_its_way' | 'tracking' | 'payment_pending' | 'refunded' | 'needs_owner' | 'ask_for_details';

export interface ReplyDraft {
  kind: ReplyKind;
  subject: string;
  body: string;
  /** Resending the download link is an action the owner approves, not part of the draft. */
  suggestedAction: 'resend_download' | 'none';
  /** True when a person must decide before anything is said to the buyer. */
  handToOwner: boolean;
  /** Why, in plain words, for the owner. */
  note: string;
}

const hi = (): string => 'Hi,';

export function draftReply(result: LookupResult, brand = 'the shop'): ReplyDraft {
  if (!result.found) {
    const ask = result.reason === 'ambiguous' ? 'Could you tell me which order you mean? The order number is in your receipt email.' : 'Could you send me the email you ordered with and your order number?';
    return { kind: 'ask_for_details', subject: 'About your order', body: `${hi()}\n\nThanks for getting in touch. ${ask}\n\nThanks,\n${brand}`, suggestedAction: 'none', handToOwner: false,
      note: result.reason === 'not_verified' ? 'The email does not match that order, so no order details were used.' : 'No matching order for that email.' };
  }
  const o = result.order;
  const sign = `\n\nThanks,\n${brand}`;
  const subject = `Your order: ${o.title}`;
  if (o.payment === 'refunded') return { kind: 'refunded', subject, body: `${hi()}\n\nYour order for ${o.title} has been refunded, so the download is no longer available.${sign}`, suggestedAction: 'none', handToOwner: false, note: 'Refunded order.' };
  if (o.payment !== 'paid') return { kind: 'payment_pending', subject, body: `${hi()}\n\nWe have not received payment for ${o.title} yet, so nothing has been sent. If you completed checkout, give it a few minutes, and let me know if it still does not show.${sign}`, suggestedAction: 'none', handToOwner: o.payment === 'failed', note: o.payment === 'failed' ? 'Payment failed: check before replying.' : 'Payment pending.' };
  if (o.parcels?.length) {
    const lines = o.parcels.map((p, i) => `Parcel ${i + 1} (${p.carrier}): ${p.state === 'delivered' ? 'delivered' : 'on its way'}${p.trackingUrl ? ` - ${p.trackingUrl}` : ' (tracking link not available yet)'}`);
    const anyMissingLink = o.parcels.some((p) => !p.trackingUrl);
    return { kind: 'tracking', subject, body: `${hi()}\n\nHere is where your order is:\n${lines.join('\n')}${sign}`, suggestedAction: 'none', handToOwner: anyMissingLink && o.parcels.every((p) => !p.trackingUrl), note: anyMissingLink ? 'A tracking link is missing for at least one parcel.' : 'All parcels have tracking.' };
  }
  switch (o.delivery) {
    case 'delivered': return { kind: 'delivered', subject, body: `${hi()}\n\nYour download for ${o.title} was emailed to ${o.buyerEmail}${o.deliveredAt ? ` on ${o.deliveredAt.slice(0, 10)}` : ''}. Please check your spam folder. If you cannot find it, say so and I will send a fresh link.${sign}`, suggestedAction: 'resend_download', handToOwner: false, note: 'Delivered. Offer a resend if the buyer cannot find it.' };
    case 'in_progress': case 'not_started': return { kind: 'on_its_way', subject, body: `${hi()}\n\nYour payment for ${o.title} went through and your download is being prepared. It should reach ${o.buyerEmail} shortly.${sign}`, suggestedAction: 'none', handToOwner: false, note: 'Delivery in progress.' };
    default: return { kind: 'needs_owner', subject, body: `${hi()}\n\nThanks for your patience. I am checking your download for ${o.title} and will come back to you today.${sign}`, suggestedAction: 'resend_download', handToOwner: true, note: `Delivery is "${o.delivery}": the owner needs to look before anything firm is promised.` };
  }
}

export interface OpsLogEntry { workflow: string; result: string; status: 'done' | 'waiting_for_you'; orderId: string | null }

/** The one-line activity record the owner can open from a phone. A reply that reaches a buyer always waits for the owner. */
export function opsLogEntry(result: LookupResult, draft: ReplyDraft): OpsLogEntry {
  const orderId = result.found ? result.order.orderId : null;
  return { workflow: 'order-tracker', orderId, status: 'waiting_for_you', result: draft.handToOwner ? `Needs you: ${draft.note}` : `Drafted a reply (${draft.kind.replace(/_/g, ' ')}) for approval.` };
}
