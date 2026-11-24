/** One constrained browser-local page. No HTML, URLs, backend or publication. */
export const websitePageStorageKey = (profileId: string) => `launchpad.website-page-draft.v1.${profileId}`;
export const websitePageLimits = { title: 100, intro: 1000, heading: 100, body: 3000, sections: 4, ctaLabel: 60, storage: 40000 } as const;
export type WebsitePageInput = { title: string; intro: string; sections: { heading: string; body: string }[]; ctaLabel: string; ctaTarget: string };
export type WebsitePageDraft = WebsitePageInput & { version: 1; profileId: string };
export const blankWebsitePage = (): WebsitePageInput => ({ title: '', intro: '', sections: [{ heading: '', body: '' }], ctaLabel: '', ctaTarget: '' });
/** Swap adjacent sections without changing which section the optional button describes. */
export function moveWebsitePageSection(input: WebsitePageInput, index: number, direction: -1 | 1): WebsitePageInput {
  const nextIndex = index + direction;
  if (!Number.isInteger(index) || nextIndex < 0 || nextIndex >= input.sections.length) return input;
  const sections = [...input.sections];
  [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
  const from = `section-${index + 1}`;
  const to = `section-${nextIndex + 1}`;
  const ctaTarget = input.ctaTarget === from ? to : input.ctaTarget === to ? from : input.ctaTarget;
  return { ...input, sections, ctaTarget };
}
/** Remove one section, retaining the optional button's intended destination. No storage writes. */
export function removeWebsitePageSection(input: WebsitePageInput, index: number): WebsitePageInput {
  if (!Number.isInteger(index) || index < 0 || index >= input.sections.length || input.sections.length <= 1) return input;
  const removedTarget = `section-${index + 1}`;
  const targetOrdinal = /^section-[1-4]$/.test(input.ctaTarget) ? Number(input.ctaTarget.slice(8)) : 0;
  return {
    ...input,
    sections: input.sections.filter((_, position) => position !== index),
    ctaLabel: input.ctaTarget === removedTarget ? '' : input.ctaLabel,
    ctaTarget: input.ctaTarget === removedTarget ? '' : targetOrdinal > index + 1 ? `section-${targetOrdinal - 1}` : input.ctaTarget,
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid page draft. Nothing was overwritten.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, limit: number, required = true): string {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`${label}${required ? ' is required and' : ''} must be ${limit} characters or fewer.`);
  return value.trim();
}
/** Explicit allowlist: never project owner metadata or unexpected stored fields. */
export function projectWebsitePage(value: unknown): WebsitePageInput {
  const data = record(value);
  if (!Array.isArray(data.sections) || data.sections.length < 1 || data.sections.length > websitePageLimits.sections) throw new Error('Use 1–4 text sections.');
  const sections = Array.from(data.sections, (section, index) => {
    const row = record(section);
    return { heading: text(row.heading, `Section ${index + 1} heading`, websitePageLimits.heading), body: text(row.body, `Section ${index + 1} text`, websitePageLimits.body) };
  });
  // Early v1 drafts without a CTA remain readable without a destructive migration.
  const ctaLabel = text(data.ctaLabel === undefined ? '' : data.ctaLabel, 'Button label', websitePageLimits.ctaLabel, false);
  const ctaTarget = text(data.ctaTarget === undefined ? '' : data.ctaTarget, 'Button destination', 12, false);
  if (!!ctaLabel !== !!ctaTarget || (ctaTarget && !sections.some((_, index) => ctaTarget === `section-${index + 1}`))) throw new Error('Choose a button label and an existing page section, or leave both empty.');
  return { title: text(data.title, 'Page title', websitePageLimits.title), intro: text(data.intro, 'Introduction', websitePageLimits.intro), sections, ctaLabel, ctaTarget };
}
export function saveWebsitePage(input: unknown, profileId: string): WebsitePageDraft {
  text(profileId, 'Profile identity', 160);
  return { version: 1, profileId, ...projectWebsitePage(input) };
}
export function restoreWebsitePage(raw: string | null, profileId: string): WebsitePageDraft | null {
  if (raw === null) return null;
  if (raw.length > websitePageLimits.storage) throw new Error('Saved page is too large. Nothing was overwritten.');
  const data = record(JSON.parse(raw));
  if (data.version !== 1 || data.profileId !== profileId) throw new Error('Saved page version or owner does not match. Nothing was overwritten.');
  return saveWebsitePage(data, profileId);
}
export function persistWebsitePage(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, input: unknown): { raw: string; draft: WebsitePageDraft } {
  const key = websitePageStorageKey(profileId);
  const actual = storage.getItem(key);
  if (actual !== expectedRaw) throw new Error('Saved page changed in another tab. Your edits are kept; cancel and reload before saving.');
  restoreWebsitePage(actual, profileId); // Never overwrite malformed or future-version records.
  const draft = saveWebsitePage(input, profileId);
  const raw = JSON.stringify(draft);
  if (raw.length > websitePageLimits.storage) throw new Error('Page exceeds local storage limit.');
  storage.setItem(key, raw); // Quota/unavailable errors propagate; no session-only success claim.
  return { raw, draft };
}
