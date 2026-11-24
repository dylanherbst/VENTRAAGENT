// Single place for the public website's brand. The app is AIMoneyPrinter (owner decision, 19 Nov 2026); Ventra is the company
// behind it. Rename here and every page follows. Legal and Stripe review of the name are still open.
export const site = {
  name: 'AIMoneyPrinter',
  company: 'Ventra',
  workingName: false,
  domain: 'aiventra.com.au',
  supportEmail: 'hello@aiventra.com.au',
  // Draft pricing hypotheses from the business plan §13.1, to be validated with pilot users. Never shown as final.
  plans: [
    { id: 'discover', name: 'Discover', priceAud: 0, blurb: 'Five researched business ideas and a sample preview.', includes: ['5 opportunity suggestions', 'Sample business preview', 'No card needed'] },
    { id: 'launch', name: 'Launch', priceAud: 79, blurb: 'One business, store, products, payments and automatic delivery. In pilot testing; payments are test mode only.', includes: ['1 business and storefront (in pilot)', 'Product creation within monthly limits', 'Payments to your own Stripe account (test mode only)', 'Automatic file delivery (in pilot)'] },
    { id: 'autopilot', name: 'Autopilot', priceAud: 149, blurb: 'Launch plus approved social publishing and daily checks, both planned and not available yet.', includes: ['Everything in Launch', 'Approved Pinterest publishing (planned)', 'Daily health checks and summaries (planned)'] },
    { id: 'scale', name: 'Scale', priceAud: 249, blurb: 'Higher limits, and room for more than one business (planned).', includes: ['Everything in Autopilot', 'Higher generation limits', 'Multiple businesses (planned)'] },
  ],
} as const;
