import type { Metadata } from 'next';
import { ExistingFlow } from './existing-flow';

export const metadata: Metadata = { title: 'Your business' };

// Path 2 entry: for owners who already run a business. One screen, then straight into the full workspace.
export default function StartExisting() {
  return <ExistingFlow />;
}
