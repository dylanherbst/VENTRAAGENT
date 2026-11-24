// Marketing site honesty checks (owner brief: never present a demo as live, no invented testimonials or metrics,
// no checkout without real prices and approval).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutReady, demos, faqs, pillarById, pillars, plans } from '../lib/site/content.ts';

test('statuses match what is actually built', () => {
  assert.equal(pillarById('receptionist').status, 'soon', 'no voice agent is built yet');
  assert.ok(pillarById('receptionist').capabilities.every(c => c.status === 'soon'));
  const setter = pillarById('setter');
  assert.equal(setter.status, 'demo', 'built but not yet switched on for customers');
  for (const c of setter.capabilities.filter(c => /Instagram|Phone/.test(c.text))) assert.equal(c.status, 'soon', c.text);
  const live = pillars.flatMap(p => p.capabilities.filter(c => c.status === 'live').map(c => c.text));
  assert.deepEqual(live, ['Contacts, sales pipeline and lead scoring', 'Follow-up reminders and appointment availability'], 'only working CRM features are Live');
  assert.equal(demos.find(d => d.id === 'receptionist')?.status, 'soon');
  assert.equal(demos.find(d => d.id === 'social')?.status, 'soon');
});
test('pricing: no invented prices, checkout closed without a price and owner approval', () => {
  for (const p of plans) {
    assert.equal(p.priceMonthlyAud, null, 'owner sets real prices');
    assert.equal(checkoutReady(p, { NEXT_PUBLIC_SITE_CHECKOUT: '1' }), false);
  }
  assert.equal(checkoutReady({ ...plans[0], priceMonthlyAud: 99 }, {}), false, 'needs the approval flag too');
  assert.equal(checkoutReady({ ...plans[0], priceMonthlyAud: 99 }, { NEXT_PUBLIC_SITE_CHECKOUT: '1' }), true);
});
test('FAQ answers the brief questions and is honest about what is coming soon', () => {
  const qs = faqs.map(f => f.q);
  for (const q of ['What is VENTRA?', 'How does the AI Receptionist work?', 'Can I cancel?', 'What is available now versus coming soon?']) assert.ok(qs.includes(q), q);
  assert.match(faqs.find(f => f.q.startsWith('How does the AI Receptionist'))!.a, /coming soon/i);
  assert.match(faqs.find(f => f.q.startsWith('Can it contact customers over the phone'))!.a, /Not yet/);
});
test('page source: no testimonials, no invented metrics, every demo labelled as a preview', async () => {
  const page = await readFile('app/site/page.tsx', 'utf8'), demosSrc = await readFile('app/site/_ui/demos.tsx', 'utf8');
  assert.doesNotMatch(page + demosSrc, /testimonial|★|\d+%\s+(more|faster|higher|increase|of)|\d+x (more|faster)/i, 'no reviews or performance claims');
  for (const note of ['Simulated preview. The AI Receptionist is coming soon', 'Simulated preview. Instagram connection is coming soon', 'Simulated preview. Phone conversations are coming soon']) assert.ok(demosSrc.includes(note), note);
  assert.ok(page.includes('Illustration with sample data.'));
});
test('domain routing: aiventra.com.au serves the site at its root; other hosts are untouched', async () => {
  // @ts-expect-error plain JS config without types
  const cfg = (await import('../next.config.mjs')).default;
  const { beforeFiles } = await cfg.rewrites();
  const root = beforeFiles.filter((r: { source: string }) => r.source === '/');
  assert.deepEqual(root.map((r: { has: { value: string }[] }) => r.has[0].value).sort(), ['aiventra.com.au', 'www.aiventra.com.au']);
  assert.ok(beforeFiles.every((r: { has?: unknown[]; destination: string }) => r.has && r.destination.startsWith('/site')));
});
