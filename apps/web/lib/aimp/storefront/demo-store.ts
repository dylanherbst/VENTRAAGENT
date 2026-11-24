// DEMO store used to build and test the renderer before real stores exist in the database.
// It is labelled DEMO on every page, is never indexed and can never take payment (enforced by validateStoreConfig).
import type { StoreConfig } from './schema.ts';

export const demoStore: StoreConfig = {
  version: 1,
  slug: 'slow-morning',
  status: 'published',
  demo: true,
  brand: { name: 'Slow Morning Studio', tagline: 'Printable planners for calmer weeks', theme: 'pearl', font: 'serif' },
  hero: {
    eyebrow: 'Printable planners & trackers',
    heading: 'Plan a calmer week in ten minutes.',
    subheading: 'Minimal, undated printables for busy people. Download instantly, print at home on A4 or US Letter, and reuse every week.',
    ctaLabel: 'Browse planners',
  },
  sections: ['featured', 'catalogue', 'bundles', 'trust', 'faq', 'newsletter'],
  products: [
    {
      slug: 'weekly-reset-planner', title: 'Weekly Reset Planner', summary: 'A one-page Sunday ritual: priorities, meals, habits and a brain dump.',
      description: [
        'The Weekly Reset Planner turns a scattered Sunday into a ten-minute plan. One page holds your top three priorities, a seven-day overview, a meal plan and a habit row.',
        'Undated, so you can start any week. Print one page per week or slip it into a sheet protector and use a whiteboard marker.',
      ],
      priceMinor: 900, format: 'PDF', pages: 4, featured: true,
      includes: ['A4 and US Letter versions', 'Light and minimal ink-saving versions', 'Printing guide'],
      tags: ['planner', 'weekly'], cover: { style: 'grid', label: 'Weekly Reset' },
    },
    {
      slug: 'habit-tracker-90-day', title: '90-Day Habit Tracker', summary: 'Track up to eight habits for a full quarter on a single sheet.',
      description: [
        'Ninety small squares per habit make progress visible at a glance. A monthly reflection box helps you adjust instead of quitting.',
      ],
      priceMinor: 700, format: 'PDF', pages: 3, featured: true,
      includes: ['A4 and US Letter versions', 'Monthly reflection page'], tags: ['habits', 'tracker'], cover: { style: 'dots', label: '90 Days' },
    },
    {
      slug: 'budget-snapshot', title: 'Monthly Budget Snapshot', summary: 'Income, bills, savings goals and a spending log on two pages.',
      description: [
        'A simple paper budget for people who avoid spreadsheets. Fill in fixed bills once, then log spending through the month.',
        'Includes a spreadsheet version that adds up totals for you.',
      ],
      priceMinor: 1200, compareAtMinor: 1500, format: 'ZIP', pages: 6, featured: true,
      includes: ['Printable PDF', 'Excel spreadsheet with formulas', 'Savings goal tracker'], tags: ['budget', 'money'], cover: { style: 'lines', label: 'Budget' },
    },
    {
      slug: 'meal-plan-grocery-list', title: 'Meal Plan & Grocery List', summary: 'Plan seven dinners and build the shopping list as you go.',
      description: ['Plan the week’s meals on the left and the grocery list fills naturally on the right, grouped by aisle.'],
      priceMinor: 600, format: 'PDF', pages: 2, featured: false,
      includes: ['A4 and US Letter versions'], tags: ['meals', 'home'], cover: { style: 'arch', label: 'Meal Plan' },
    },
    {
      slug: 'daily-focus-sheet', title: 'Daily Focus Sheet', summary: 'Time-blocked day page with one most-important task.',
      description: ['Half-hour time blocks from 6am to 10pm, one most-important task, and space for notes. Designed for desk use.'],
      priceMinor: 800, format: 'PDF', pages: 2, featured: false,
      includes: ['A4 and US Letter versions', 'Undated, reusable'], tags: ['daily', 'focus'], cover: { style: 'grid', label: 'Daily Focus' },
    },
    {
      slug: 'year-at-a-glance', title: 'Year at a Glance', summary: 'Twelve months on one page for birthdays, trips and big goals.',
      description: ['A one-page wall planner with blank month grids, so it works for any year.'],
      priceMinor: 500, format: 'PNG', featured: false,
      includes: ['High-resolution PNG', 'A3, A4 and US Letter sizes'], tags: ['yearly', 'wall planner'], cover: { style: 'dots', label: 'Year' },
    },
  ],
  bundles: [
    {
      slug: 'calm-week-bundle', title: 'Calm Week Bundle', summary: 'Weekly Reset, Daily Focus and Meal Plan together.',
      productSlugs: ['weekly-reset-planner', 'daily-focus-sheet', 'meal-plan-grocery-list'], priceMinor: 1700,
    },
  ],
  trust: [
    { title: 'Instant download', body: 'Your files arrive by email and on the receipt page as soon as payment is confirmed.' },
    { title: 'Print at home', body: 'Every planner is tested on A4 and US Letter paper with standard printers.' },
    { title: 'Real help', body: 'Questions about a file? Email us and a person replies within two business days.' },
  ],
  faq: [
    { question: 'Will I receive a physical product?', answer: 'No. These are digital files. You download and print them yourself or at a print shop.' },
    { question: 'How do I get my files?', answer: 'After payment you are taken to a secure download page and we email you the link. Links expire, but you can request a new one.' },
    { question: 'Can I share or resell the files?', answer: 'Files are for your personal use only. Please do not share, resell or redistribute them.' },
    { question: 'What if a file does not work?', answer: 'Email us. If a file is faulty or not as described, we will fix it or refund you.' },
  ],
  policies: {
    refund: [
      'Because these are digital downloads, we do not offer refunds for change of mind once a file has been downloaded.',
      'This does not limit your rights under the Australian Consumer Law. If a file is faulty, significantly different from its description or unusable, contact us and we will replace it or refund you.',
      'Email us within 30 days of purchase with your order number.',
    ],
    privacy: [
      'We collect your name, email and order details to deliver your files and provide support. Payments are processed by our payment provider; we never see your full card number.',
      'We only send marketing emails if you opt in, and every email has an unsubscribe link.',
      'You can ask us to access, correct or delete your personal information at any time.',
    ],
    terms: [
      'All products are digital files licensed for personal, non-commercial use.',
      'Prices are in Australian dollars and include GST where applicable.',
      'Colours may vary depending on your screen and printer.',
    ],
  },
  contact: { email: 'hello@example.com', responseTime: 'within 2 business days', businessName: 'Slow Morning Studio (demo)' },
  merchant: { chargesEnabled: false },
  seo: { title: 'Slow Morning Studio · Printable planners', description: 'Minimal printable planners, habit trackers and budget sheets. Instant digital download, print at home.' },
};
