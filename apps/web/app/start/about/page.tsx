import type { Metadata } from 'next';
import { AboutFlow } from './about-flow';

export const metadata: Metadata = { title: 'A few more details' };

// Country, preferred language and one optional "who do you already know" question, between the goals and the ideas.
export default function StartAbout() {
  return <AboutFlow />;
}
