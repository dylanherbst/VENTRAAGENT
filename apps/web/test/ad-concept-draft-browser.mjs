import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankProfile } from '../lib/onboarding.ts';
import { saveLocalOffer } from '../lib/local-offers.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
const CDP_PORT = Number(process.env.AD_CONCEPT_QA_CDP_PORT || '9324');
const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/ad-concepts/', import.meta.url));
await mkdir(evidenceDir, { recursive: true });

const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).catch(() => null);
if (!listRes?.ok) {
  console.error(`Ad concept browser journey skipped: CDP not available on port ${CDP_PORT}.`);
  process.exit(0);
}

const target = (await listRes.json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const data = JSON.parse(event.data);
  if (data.id) {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) p.reject(new Error(JSON.stringify(data.error)));
    else p.resolve(data.result);
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async expression => {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Runtime evaluate failed');
  return res.result.value;
};
const wait = async (expression, ms = 15000) => {
  const deadline = Date.now() + ms;
  do {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      if (!/navigated|context/.test(error.message)) throw error;
    }
    await new Promise(r => setTimeout(r, 50));
  } while (Date.now() < deadline);
  throw new Error('Timeout: ' + expression);
};
const studioRoot = "document.querySelector('.ad-concept-studio')";
const click = async (label, rootExpr = 'document') => {
  await evaluate(
    `(() => {const root = ${rootExpr}; const el = [...root.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`,
  );
};
const fill = async (label, value, rootExpr = 'document') => {
  await evaluate(
    `(() => {const root = ${rootExpr}; const label = [...root.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`,
  );
};
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const storageKey = 'launchpad.ad-concept-drafts.v1.local-business';

const profile = {
  ...blankProfile(),
  name: 'QA Ads',
  audience: 'Buyers',
  expertise: 'Offers',
  goal: 'Creative',
  pathways: ['business', 'education'],
};
const offers = saveLocalOffer(
  [],
  {
    name: 'QA Package',
    audience: 'Buyers',
    outcome: 'Clear outcome text.',
    price: '100.00',
    currency: 'AUD',
    kind: 'service',
    delivery: 'Secret delivery',
  },
  profile,
  'qa-offer-1',
);

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
await evaluate(
  `localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.setItem('launchpad.offers.v1.local-business', ${JSON.stringify(JSON.stringify(offers))}); localStorage.removeItem(${JSON.stringify(storageKey)});`,
);
await cdp('Page.reload');
await wait(bodyIncludes('Ad Creative Studio'));
await click('Create ad concept draft', studioRoot);
await wait(bodyIncludes('New ad concept'));
await fill('Concept label (for your list)', 'QA Concept', studioRoot);
await fill('Audience', 'Founders', studioRoot);
await fill('Creative angle', 'Story hook', studioRoot);
await fill('Headline', 'Validate faster', studioRoot);
await fill('Body or caption', 'Manual caption only.', studioRoot);
await fill('Call to action', 'Learn more', studioRoot);
await click('Preview unsaved concept', studioRoot);
await wait(bodyIncludes('Read-only concept mock'));
const previewText = await evaluate(`${studioRoot}.querySelector('.ad-concept-preview').innerText`);
assert.ok(previewText.includes('Manual caption only'));
assert.ok(!previewText.includes('Secret delivery'));
await click('Close concept preview', studioRoot);
await click('Save local ad concept', studioRoot);
await wait(bodyIncludes('saved in this browser'));
assert.ok(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`));

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.reload');
await wait(bodyIncludes('Ad Creative Studio'));
const overflow = await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');
assert.ok(overflow);
const shot = await cdp('Page.captureScreenshot', { format: 'png' });
await writeFile(`${evidenceDir}/ad-concept-390.png`, Buffer.from(shot.data, 'base64'));
ws.close();
console.log(`PASS: ad concept journey on ${QA_BASE_URL} (CDP ${CDP_PORT}).`);
