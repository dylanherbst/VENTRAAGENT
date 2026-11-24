import type { Metadata } from 'next';
import { IdeasView } from './ideas-view';

export const metadata: Metadata = { title: 'Your business ideas' };

// Five ideas ranked for the customer's goal answers: the real Opportunity Finder (the same call as
// /tools/opportunity-finder), on the glass library. Answers come from the saved goals first, the link second.
export default function StartIdeas() {
  return <IdeasView />;
}
