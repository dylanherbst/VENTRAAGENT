import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRedirect, LEGACY_PREFIXES } from '../lib/aimp/hosts/legacy.ts';

test('the old VENTRA root and its sections go to the guided start', () => {
  for (const p of ['/', '/app', '/app/', ...LEGACY_PREFIXES, '/customers/ai-team', '/grow/audit', '/services/growth-audit', '/create/start', '/money/']) {
    assert.equal(legacyRedirect(p, 'localhost:3050'), '/start', p);
  }
});

test('AiMoneyPrinter pages, shops, the API and test pages are never redirected', () => {
  for (const p of ['/start', '/start/store', '/app/biz_1', '/app/biz_1/settings', '/app/biz_1/inbox', '/s/my-shop', '/s/my-shop/products/x', '/api/health', '/test-lab', '/test-lab/templates', '/site', '/site/privacy', '/workspace', '/tools', '/design-system', '/settingsx', '/inboxes']) {
    assert.equal(legacyRedirect(p, 'localhost:3050'), null, p);
  }
});

test('the marketing domain keeps its own home, and the switch brings the old pages back', () => {
  assert.equal(legacyRedirect('/', 'www.aiventra.com.au'), null);
  assert.equal(legacyRedirect('/', 'aiventra.com.au:443'), null);
  assert.equal(legacyRedirect('/', 'localhost', { AIMP_SHOW_LEGACY: '1' }), null);
  assert.equal(legacyRedirect('/', undefined), '/start');
});
