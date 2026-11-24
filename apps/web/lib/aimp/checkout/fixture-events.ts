// Fake Stripe provider events for fixtures and tests (AMP-041). Builds the same JSON shape Stripe sends for
// `checkout.session.completed`, signed with the given secret. No network. Real events only exist once Stripe test keys do (AMP-043-D).
import type { PaymentsAdapter } from '../providers/types.ts';
import { signPayload } from './signature.ts';

export interface SignedEvent { rawBody: string; signature: string; eventId: string }

export function buildSessionCompletedBody(input: { eventId: string; sessionId: string; amountMinor: number; currency?: string; paymentStatus?: string; createdSeconds: number }): string {
  return JSON.stringify({
    id: input.eventId, type: 'checkout.session.completed', created: input.createdSeconds,
    data: { object: { id: input.sessionId, amount_total: input.amountMinor, currency: (input.currency ?? 'aud').toLowerCase(), payment_status: input.paymentStatus ?? 'paid' } },
  });
}

/** The fixture provider "takes the payment" for a session and returns the signed event it would send. */
export async function paySessionWithFixture(adapter: PaymentsAdapter, sessionId: string, secret: string, now: Date): Promise<SignedEvent> {
  const ev = await adapter.completeSession(sessionId);
  const seconds = Math.floor(now.getTime() / 1000);
  const rawBody = buildSessionCompletedBody({ eventId: ev.id, sessionId, amountMinor: ev.amountCents, createdSeconds: seconds });
  return { rawBody, signature: signPayload(secret, rawBody, seconds), eventId: ev.id };
}
