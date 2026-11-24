// Policy page keys used for routes and sitemaps. Mirrors `policyPages` in storefront/load.ts without importing it
// (load.ts imports the registry, so importing back would be circular). The tests assert the two lists match.
export const policyPagesList = ['refund', 'privacy', 'terms'] as const;
