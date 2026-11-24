// Second DEMO store: proves one renderer serves different brands, themes and catalogues.
// Labelled DEMO on every page, never indexed, can never take payment (enforced by validateStoreConfig).
import type { StoreConfig } from './schema.ts';

export const demoStoreB: StoreConfig = {
  version: 1,
  slug: 'iron-and-oak',
  status: 'published',
  demo: true,
  brand: { name: 'Iron & Oak Training', tagline: 'Strength programs you can follow without a gym coach', theme: 'ink', font: 'sans' },
  hero: {
    eyebrow: 'Digital training programs',
    heading: 'Get stronger. Follow the plan.',
    subheading: 'Straight-talking workout programs and tracking sheets. Download, load onto your phone or print, and train with a clear plan every session.',
    ctaLabel: 'See programs',
  },
  sections: ['featured', 'catalogue', 'trust', 'faq'],
  products: [
    {
      slug: 'strength-foundations-12-week', title: 'Strength Foundations: 12 Weeks', summary: 'Three sessions a week to build a base with the main lifts.',
      description: [
        'A twelve-week progression for people new to lifting or returning after a break. Each session lists exercises, sets, reps and rest.',
        'Includes a short guide to technique cues and how to choose your starting weights.',
      ],
      priceMinor: 3900, format: 'PDF', pages: 48, featured: true,
      includes: ['12-week program PDF', 'Technique cue cards', 'Starting weight guide'], tags: ['strength', 'beginner'], cover: { style: 'lines', label: 'Foundations' },
    },
    {
      slug: 'home-dumbbell-plan', title: 'Home Dumbbell Plan', summary: 'Four-day split using one pair of adjustable dumbbells.',
      description: ['Everything runs on a single pair of dumbbells and a bench or sturdy chair. Sessions take 40 minutes.'],
      priceMinor: 2900, compareAtMinor: 3500, format: 'PDF', pages: 30, featured: true,
      includes: ['Four-day program', 'Exercise swap list'], tags: ['home', 'dumbbell'], cover: { style: 'arch', label: 'Home Plan' },
    },
    {
      slug: 'lift-log-sheets', title: 'Lift Log Sheets', summary: 'Spreadsheet that records every set and charts your progress.',
      description: ['Log weight and reps once and the sheet shows personal bests and weekly volume for you.'],
      priceMinor: 1500, format: 'Google Sheets', featured: true,
      includes: ['Google Sheets template', 'Printable backup log'], tags: ['tracker', 'log'], cover: { style: 'grid', label: 'Lift Log' },
    },
    {
      slug: 'mobility-warmup-cards', title: 'Mobility Warm-up Cards', summary: 'Ten-minute warm-up routines for upper and lower body days.',
      description: ['Illustrated routine cards to get joints ready before you lift.'],
      priceMinor: 1200, format: 'PNG', featured: false,
      includes: ['High-resolution PNG cards'], tags: ['mobility', 'warm-up'], cover: { style: 'dots', label: 'Warm-up' },
    },
  ],
  bundles: [],
  trust: [
    { title: 'Clear structure', body: 'Every session shows exactly what to do, in order, with rest times.' },
    { title: 'Phone or paper', body: 'Files work on a phone screen or printed at home.' },
    { title: 'Real help', body: 'Questions about a program? Email us and a person replies.' },
  ],
  faq: [
    { question: 'Is this personal coaching?', answer: 'No. These are general digital programs and are not tailored to your health or injuries.' },
    { question: 'Should I check with a doctor first?', answer: 'If you have an injury or health condition, speak to a health professional before starting any exercise program.' },
    { question: 'How do I get my files?', answer: 'After payment you are taken to a secure download page and we email you the link.' },
  ],
  policies: {
    refund: [
      'Because these are digital downloads, we do not offer refunds for change of mind once a file has been downloaded.',
      'This does not limit your rights under the Australian Consumer Law. If a file is faulty or not as described, contact us and we will replace it or refund you.',
    ],
    privacy: [
      'We collect your name, email and order details to deliver your files and provide support. We never see your full card number.',
      'We only send marketing emails if you opt in.',
    ],
    terms: [
      'All programs are digital files licensed for personal use only.',
      'Prices are in Australian dollars and include GST where applicable.',
      'Programs are general information and not medical advice.',
    ],
  },
  contact: { email: 'train@example.com', responseTime: 'within 1 business day', businessName: 'Iron & Oak Training (demo)' },
  merchant: { chargesEnabled: false },
  seo: { title: 'Iron & Oak Training · Strength programs', description: 'Digital strength programs and tracking sheets. Instant download, train at home or in the gym.' },
};
