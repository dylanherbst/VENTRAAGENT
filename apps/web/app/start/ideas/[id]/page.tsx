import type { Metadata } from 'next';
import { decodeIdeaParam } from '../../journey';
import { IdeaPreview } from './idea-preview';

export const metadata: Metadata = { title: 'Preview this business' };

// Preview one idea and choose it: the real preview and selection logic (the same calls as /tools/opportunity-select),
// on the glass library. The idea itself is looked up in the browser from the customer's own finder results.
export default async function StartIdeaPreview({ params }: { params: Promise<{ id: string }> }) {
  return <IdeaPreview ideaId={decodeIdeaParam((await params).id)} />;
}
