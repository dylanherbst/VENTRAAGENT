// Outcome metrics from stored records only. Purchases and bookings come only from verified provider events.
import type { SetterStore } from './store.ts';

export function setterMetrics(s: SetterStore, ws: string) {
  const convs = s.conversations(ws);
  const leads = s.leads(ws);
  const conv = s.conversions(ws);
  const attempts = s.attempts(ws);
  let latencies: number[] = [];
  for (const c of convs) {
    const ms = s.messages(ws, c.id);
    for (let i = 0; i < ms.length; i++) {
      if (ms[i]!.direction !== 'in') continue;
      const reply = ms.slice(i + 1).find((m) => m.direction === 'out' && m.status === 'sent');
      if (reply) latencies.push(Date.parse(reply.createdAt) - Date.parse(ms[i]!.createdAt));
    }
  }
  latencies = latencies.filter((x) => x >= 0).sort((a, b) => a - b);
  const inbound = convs.filter((c) => c.lastInboundAt).length;
  const purchases = conv.filter((e) => e.kind === 'purchase' && e.source === 'stripe_verified').length;
  const bookings = conv.filter((e) => e.kind === 'booking' && e.source === 'booking_verified').length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    conversations: inbound,
    medianReplyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
    qualified: leads.filter((l) => ['interested', 'booking_ready', 'purchase_ready'].includes(l.stage)).length,
    handoffs: convs.filter((c) => c.humanTakeover).length,
    optOuts: leads.filter((l) => l.optedOut).length,
    checkoutClicks: conv.filter((e) => e.kind === 'checkout_click').length,
    verifiedPurchases: purchases,
    verifiedBookings: bookings,
    purchaseRatePct: pct(purchases, inbound),
    deadLetters: attempts.filter((a) => a.status === 'dead_letter').length,
    blockedSends: attempts.filter((a) => a.status === 'blocked').length,
  };
}
