import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthRedirect, allows, tiers } from '../lib/aimp/growth/product.ts';
import { setterConfigFromProfile } from '../lib/aimp/growth/knowledge.ts';
import { checkPublicUrl, extractSite, isPrivateAddress } from '../lib/aimp/growth/site-reader.ts';
import { defaultConfig } from '../lib/aimp/setter/pipeline.ts';
import { createAgentTeam, newTeamStore, mockImages, mockRenderer, mockPublisher } from '../lib/aimp/agents/index.ts';
import { createEngine, newStore, demoWriter } from '../lib/aimp/marketing-engine/index.ts';

test('growth product: startup pages are parked, growth pages stay open', () => {
  for (const [p, to] of [['/', '/start'], ['/start/ideas', '/start/existing'], ['/start/ideas/x', '/start/existing'], ['/tools/opportunity-finder', '/start/existing'], ['/s/shop-a', '/start/existing'], ['/shop/biz-1', '/start/existing'],
    ['/app/biz-1/offers', '/app/biz-1/home'], ['/app/biz-1/products/p1/edit', '/app/biz-1/home'], ['/app/biz-1/website', '/app/biz-1/home'], ['/app/biz-1/payments', '/app/biz-1/home']] as const) assert.equal(growthRedirect(p), to, p);
  for (const p of ['/start', '/start/account', '/start/existing', '/app/biz-1', '/app/biz-1/home', '/app/biz-1/sales', '/app/biz-1/social', '/app/biz-1/marketing', '/app/biz-1/marketing/angles', '/app/biz-1/profile', '/app/biz-1/settings', '/app/biz-1/activate', '/site', '/api/health', '/test-lab']) assert.equal(growthRedirect(p), null, p);
  assert.ok(allows('growth', 'sales')); assert.equal(allows('starter', 'sales'), false); assert.ok(tiers.autopilot.aiRunsPerMonth > tiers.growth.aiRunsPerMonth);
});

test('shared knowledge: one profile feeds the Sales agent; partial saves keep earlier answers', () => {
  const store = newTeamStore();
  const t = createAgentTeam({ store, marketing: createEngine({ store: newStore(), writer: demoWriter }), text: null, images: mockImages, renderer: mockRenderer(), publisher: mockPublisher(), flags: { agentsEnabled: true, paidAdsEnabled: false, autoSendMessagesEnabled: false, publishingEnabled: false }, templates: { reel: null, static: null }, publicUrl: null, zernioWebhookSecret: null, assetUrl: () => null });
  assert.ok(t.saveProfile('w', { businessName: 'Lash Lab', industry: 'beauty', offer: 'Lash extensions', audience: 'Women in Joondalup', timezone: 'Australia/Perth', usps: 'Same artist every visit\nOpen till 8pm', bookingUrl: 'https://book.example.com' }, 'o').ok);
  assert.ok(t.saveProfile('w', { businessName: 'Lash Lab', industry: 'beauty', offer: 'Lash extensions', painPoints: 'Lashes that fall out in a week' }, 'o').ok);
  const p = t.profile('w')!;
  assert.deepEqual(p.usps, ['Same artist every visit', 'Open till 8pm'], 'second screen did not wipe the first');
  assert.equal(p.audience, 'Women in Joondalup'); assert.equal(p.revision, 2);
  assert.equal(t.saveProfile('w', { businessName: 'Lash Lab', industry: 'beauty', offer: 'x', bookingUrl: 'http://insecure' }, 'o').ok, false);
  const cfg = setterConfigFromProfile({ ...defaultConfig('w', new Date()), knowledge: [{ id: 'faq-1', question: 'Parking?', answer: 'Free out front.' }] }, { ...p, faqs: [{ q: 'Do you do lifts?', a: 'Yes.' }] });
  assert.equal(cfg.businessName, 'Lash Lab'); assert.equal(cfg.bookingUrl, 'https://book.example.com'); assert.deepEqual(cfg.sellingPoints, p.usps);
  assert.deepEqual(cfg.knowledge.map((k) => k.question), ['Do you do lifts?', 'Parking?'], 'profile FAQs first, owner setter FAQs kept');
});

test('website reader: public https only, private networks refused, text extracted', async () => {
  const pub = async () => ['93.184.216.34'];
  assert.ok(await checkPublicUrl('https://lashlab.com.au', pub));
  assert.equal(await checkPublicUrl('http://lashlab.com.au', pub), null);
  assert.equal(await checkPublicUrl('https://127.0.0.1', pub), null);
  assert.equal(await checkPublicUrl('https://intranet.local', pub), null);
  assert.equal(await checkPublicUrl('https://evil.example.com', async () => ['10.0.0.5']), null, 'DNS to a private address');
  assert.equal(await checkPublicUrl('https://user:pw@site.com', pub), null);
  assert.ok(isPrivateAddress('192.168.1.1') && isPrivateAddress('::1') && !isPrivateAddress('8.8.8.8'));
  const s = extractSite('https://x.com', '<html><head><title>Lash Lab &amp; Co</title><meta name="description" content="Lashes in Joondalup"><script>evil()</script></head><body><h1>Book lashes</h1><p>Hello <b>there</b></p></body></html>');
  assert.equal(s.title, 'Lash Lab & Co'); assert.equal(s.description, 'Lashes in Joondalup'); assert.deepEqual(s.headings, ['Book lashes']);
  assert.ok(!s.text.includes('evil'));
});
