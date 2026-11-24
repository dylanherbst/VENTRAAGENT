import assert from 'node:assert/strict';
import test from 'node:test';
import { generateListing } from '../lib/aimp/branding/generate.ts';

test('listing copy reads naturally when the product type starts with an article or has a "with" phrase', () => {
  const l = generateListing({ niche: 'Budget tracker', audience: 'Young adults', productType: 'A printable savings and budget tracker with a deposit progress page', productTitle: 'First Home Saver' }, 'warm');
  assert.doesNotMatch(l.tagline, /Thoughtful A /);
  assert.match(l.tagline, /trackers with a deposit progress page/);
  assert.doesNotMatch(l.tagline, /pages$/);
  assert.doesNotMatch(l.shortDescription, /\ba a\b|\ba A\b/i);
  const e = generateListing({ niche: 'Meal plans', audience: 'parents', productType: 'easy meal planner', productTitle: 'Dinner Plan' }, 'warm');
  assert.match(e.shortDescription, /an easy meal planner/);
});
