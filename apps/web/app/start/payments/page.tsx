import type { Metadata } from 'next';
import { PaymentsView } from './payments-view';

export const metadata: Metadata = { title: 'Payments and a test purchase' };

// Last guided step: where payments stand, and one test purchase through the real checkout and delivery path (fixtures only).
export default function StartPayments() {
  return <PaymentsView />;
}
