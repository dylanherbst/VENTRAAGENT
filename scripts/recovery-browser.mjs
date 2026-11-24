// Fresh, ephemeral Chromium context; writes only synthetic QA browser records.
// Usage: ./scripts/project node --experimental-strip-types scripts/recovery-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { blankProfile, storageKey } from '../apps/web/lib/onboarding.ts';
import { blankContactInput, saveContact, contactStorageKey } from '../apps/web/lib/local-crm-contacts.ts';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const base = 'http://127.0.0.1:3100';
const evidence = new URL('../docs/recovery/verification/', import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [], expectedDisconnectedErrors = [], failures = [], external = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (message.location().url === base + '/api/workspace' && message.text().includes('503')) expectedDisconnectedErrors.push(message.text());
  else errors.push(message.text());
});
page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/api/workspace')) failures.push({ url: response.url(), status: response.status() }); });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) { external.push(url.origin); return route.abort(); }
  return route.continue();
});
const navigate = async path => {
  const response = await page.goto(base + path);
  assert.equal(response.status(), 200, path);
  await page.locator('#ventra-main').waitFor();
};
const noOverflow = async () => {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client, JSON.stringify(dimensions));
  return dimensions;
};
async function scenarios(file) {
  const recipe = JSON.parse(await readFile(new URL('../apps/web/test/' + file, import.meta.url), 'utf8'));
  for (const [index, step] of recipe.steps.entries()) {
    try {
      if (step.action === 'navigate') await navigate(step.url);
      else if (step.kind === 'resize') await page.setViewportSize({ width: step.width, height: step.height });
      else if (step.kind === 'press') await page.keyboard.press(step.key);
      else if (step.kind === 'evaluate') {
        // Historical recipe origin was task-owned 3321; this run owns 3100.
        const fn = step.fn.replaceAll('http://127.0.0.1:3321', base);
        checks.push({ recipe: file, step: index, result: await page.evaluate('(' + fn + ')()') });
      } else throw Error('Unsupported step: ' + JSON.stringify(step));
    } catch (error) { throw Error(file + ' step ' + index + ': ' + error.message); }
  }
}
try {
  await navigate('/');
  await page.getByRole('heading', { name: 'Recommended for you' }).waitFor();
  for (const width of [1440, 1024, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    checks.push({ home: await noOverflow() });
    if ([1440, 390].includes(width)) await page.screenshot({ path: new URL('home-' + width + '.png', evidence).pathname, fullPage: true });
  }
  const profile = { ...blankProfile(), name: 'QA Glass Studio', audience: 'QA founders', goal: 'QA preserve drafts', expertise: 'QA design', stage: 'existing' };
  const contact = saveContact({ ...blankContactInput(), name: 'QA Contact' }, { id: 'qa-contact', profileId: profile.id });
  await page.evaluate(({ profileKey, profile, contactKey, contact }) => {
    localStorage.setItem(profileKey, JSON.stringify(profile));
    localStorage.setItem(contactKey, JSON.stringify([contact]));
  }, { profileKey: storageKey, profile, contactKey: contactStorageKey(profile.id), contact });
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenarios('ventra-ui-reference.scenarios.json');
  await scenarios('ventra-ui-refresh.scenarios.json');
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenarios('ventra-phase4.scenarios.json');
  await scenarios('ventra-recovery-privacy.scenarios.json');
  await scenarios('ventra-grow.scenarios.json');
  // Route/editor checks at both reference widths after hydration and lazy loading.
  const routes = ['/', '/services', '/services/growth-audit', '/create', '/business', '/business?tab=website', '/business?tab=offers', '/business?tab=delivery', '/customers', '/customers?tab=opportunities', '/grow', '/grow?tab=content', '/grow?tab=campaigns', '/grow?tab=automations', '/sales?tab=invoices', '/insights?tab=audit', '/inbox', '/settings', '/tools', '/workspace', '/onboarding'];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of routes) {
      await navigate(path);
      await page.waitForTimeout(150);
      checks.push({ path, layout: await noOverflow() });
    }
  }
  await navigate('/');
  await page.getByRole('heading', { name: 'Recommended for you' }).waitFor();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('#v-mobile-menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded'), 'false');
  await page.locator('.v-create-dock').click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  const api = await context.request.get(base + '/api/workspace');
  assert.equal(api.status(), 503);
  assert.equal((await api.json()).configured, false);
  checks.push({ mobileMenuEscape: true, createDialogEscape: true, disconnectedApi: 503 });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  assert.deepEqual(external, []);
  await writeFile(new URL('results.json', evidence), JSON.stringify({ checks, errors, expectedDisconnectedErrors, failures, external }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, unexpectedErrors: errors.length, expectedDisconnectedErrors: expectedDisconnectedErrors.length, failedResources: failures.length, externalRequests: external.length, evidence: evidence.pathname }));
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', evidence).pathname, fullPage: true });
  console.error(error.message);
  process.exitCode = 1;
} finally { await browser.close(); }
