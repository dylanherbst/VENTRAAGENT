import { blankWebsitePage } from './local-website-page.ts';
import type { WebsitePageInput } from './local-website-page.ts';

/** Original text starters only. Choice is never persisted as owner metadata. */
export const websitePageStarters = [
  { id: 'blank', label: 'Blank page', description: 'Start with empty fields and one text section.' },
  { id: 'service', label: 'Service introduction', description: 'Explain your work, your approach and the next conversation.' },
  { id: 'creator', label: 'Creator notebook', description: 'Introduce your perspective, current work and what comes next.' },
  { id: 'landing', label: 'Simple idea landing', description: 'Describe one idea, who it helps and a first step.' },
] as const;
export type WebsitePageStarterId = typeof websitePageStarters[number]['id'];

/** A fresh object on every call; cannot mutate another editor or starter. */
export function createWebsitePageStarter(id: WebsitePageStarterId): WebsitePageInput {
  switch (id) {
    case 'blank': return blankWebsitePage();
    case 'service': return {
      title: 'Useful work, shaped around you',
      intro: 'Introduce the service you offer and the people you want to help. Replace this starter text with your own experience and details.',
      sections: [
        { heading: 'What we can work on', body: 'Describe one practical problem you help solve. Explain what is included without promising results you cannot support.' },
        { heading: 'A considered approach', body: 'Outline how you listen, plan and deliver. Add the steps that genuinely reflect how you work.' },
        { heading: 'Start with a conversation', body: 'Explain what someone should prepare before discussing a project. Add your preferred next step in your own words.' },
      ], ctaLabel: 'Explore the approach', ctaTarget: 'section-2',
    };
    case 'creator': return {
      title: 'Notes from a work in progress',
      intro: 'Introduce yourself and the ideas you return to. This notebook is a starting point for your own voice, not a finished biography.',
      sections: [
        { heading: 'The questions I follow', body: 'Share the themes that shape your creative practice and why they matter to you.' },
        { heading: 'On my desk now', body: 'Describe a current piece or experiment. Be clear about what is finished and what you are still exploring.' },
        { heading: 'The next chapter', body: 'Tell readers what you hope to explore next. Replace this prompt with an invitation that fits your work.' },
      ], ctaLabel: 'See what is taking shape', ctaTarget: 'section-2',
    };
    case 'landing': return {
      title: 'Make room for one useful idea',
      intro: 'Describe your idea in a sentence: what it is, who it is for and why it deserves a closer look. Edit every detail before sharing elsewhere.',
      sections: [
        { heading: 'A smaller, clearer starting point', body: 'Explain the need behind your idea. Use what you know rather than invented demand, testimonials or results.' },
        { heading: 'Try a first step', body: 'Describe one manageable action someone could take. Keep availability and expectations accurate.' },
      ], ctaLabel: 'Find a first step', ctaTarget: 'section-2',
    };
    default: throw new Error('Choose an available page starter.');
  }
}
