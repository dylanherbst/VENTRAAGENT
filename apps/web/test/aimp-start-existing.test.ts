import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFor, validateExisting, EXISTING_INDUSTRIES } from '../lib/aimp/onboarding/existing.ts';
import { completePalette, deepenUntil } from '../lib/aimp/branding/generate.ts';
import { contrastRatio } from '../lib/aimp/branding/contrast.ts';
import { findPreset } from '../lib/aimp/agents/presets.ts';

test('existing business: validation, website tidy-up, and every industry maps to an agent preset', () => {
  const ok = validateExisting({ businessName: ' Lash Lab  Joondalup ', industry: 'beauty', offer: 'Lash extensions and lifts', audience: 'Women in Joondalup', website: 'lashlab.com.au', timezone: 'Australia/Perth' });
  assert.ok(ok.ok);
  assert.equal(ok.value.businessName, 'Lash Lab Joondalup');
  assert.equal(ok.value.website, 'https://lashlab.com.au/');
  const bad = validateExisting({ businessName: 'x', industry: 'casino', offer: '', audience: '', website: 'not a site', timezone: 'Mars/Base' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['audience', 'businessName', 'industry', 'offer', 'timezone', 'website']);
  assert.ok(validateExisting({ businessName: 'Ab', industry: 'trades', offer: 'Roofing', audience: 'Homeowners', website: '' }).ok, 'website optional, zone defaults');
  for (const i of EXISTING_INDUSTRIES) assert.ok(findPreset(i.id), i.id);
});

test('store address from the real name', () => {
  assert.equal(slugFor('Lash Lab & Co. Joondalup!'), 'lash-lab-and-co-joondalup');
  assert.equal(slugFor('Café Noël'), 'cafe-noel');
  assert.equal(slugFor('A'), 'shop-a');
  assert.ok(slugFor('x'.repeat(80), 'ab12').endsWith('-ab12') && slugFor('x'.repeat(80), 'ab12').length <= 40);
});

test('generated accent colours always pass the 3:1 check (it blocked brand approval in the 23 Nov run)', () => {
  const p = completePalette({ primary: '#a63d55', accent: '#d9822b', background: '#fdf8f6', text: '#2b1f22' });
  assert.ok(contrastRatio(p.accent, p.background) >= 3, p.accent);
  assert.equal(deepenUntil('#1f4e79', '#ffffff', 3), '#1f4e79', 'already fine: unchanged');
  assert.ok(contrastRatio(deepenUntil('#f2b705', '#ffffff', 3), '#ffffff') >= 3);
});
