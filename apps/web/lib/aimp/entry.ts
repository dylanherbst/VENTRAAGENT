// The one primary entry action for the mobile-first launch journey (rework brief 01). Pure data so the website, the /start
// welcome and the tests all read the same wording and route. Existing routes stay in place; only the default navigation changes.

export const primaryEntry = { label: 'Find my side hustle', href: '/start' } as const;

/** The three setup steps the customer sees before launch: Find an idea, build the product and shop, review and publish. */
export const setupSteps = [
  { id: 'find', label: 'Find my side hustle' },
  { id: 'build', label: 'Build it for me' },
  { id: 'review', label: 'Review my launch' },
] as const;
export type SetupStepId = (typeof setupSteps)[number]['id'];

/** Bottom tabs once the shop is launched (Settings sits behind the profile icon, not in the tab bar). Three tabs since the 20 Nov 2026 simplification; Inbox moved to Settings. */
export const appTabs = [
  { id: 'home', label: 'Home' },
  { id: 'shop', label: 'My Shop' },
  { id: 'growth', label: 'Growth' },
] as const;
