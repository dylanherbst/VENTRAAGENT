import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const STOREFRONT_KEY = 'launchpad.storefront-draft.v1.local-business';
const target = (await (await fetch('http://127.0.0.1:9322/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0; const pending = new Map(); const exceptions = [];
ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); pending.delete(data.id); if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails); });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Runtime evaluate failed'); return res.result.value; };
const wait = async (expression, ms = 12000) => { const deadline = Date.now() + ms; do { try { if (await evaluate(expression)) return; } catch (error) { if (!/navigated|context/.test(error.message)) throw error; } await new Promise(r => setTimeout(r, 50)); } while (Date.now() < deadline); throw new Error('Timeout: ' + expression); };
const click = async label => { await evaluate(`(() => {const el = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`); };
const fill = async (label, value, root = 'document') => { await evaluate(`(() => {const label = [...${root}.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`); };
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;

const denyGetSource = `(() => {
  const key = ${JSON.stringify(STOREFRONT_KEY)};
  window.__storefrontQa = window.__storefrontQa || { origGet: Storage.prototype.getItem, origSet: Storage.prototype.setItem, writes: 0 };
  const qa = window.__storefrontQa;
  Storage.prototype.getItem = function(k) { if (k === key) throw new Error('Storage read denied'); return qa.origGet.call(this, k); };
})();`;

const quotaSetSource = `(() => {
  const key = ${JSON.stringify(STOREFRONT_KEY)};
  window.__storefrontQa = window.__storefrontQa || { origGet: Storage.prototype.getItem, origSet: Storage.prototype.setItem, writes: 0 };
  const qa = window.__storefrontQa;
  Storage.prototype.setItem = function(k, v) { if (k === key) { qa.writes += 1; throw new DOMException('Quota exceeded', 'QuotaExceededError'); } return qa.origSet.call(this, k, v); };
})();`;

const restoreSource = `(() => {
  const qa = window.__storefrontQa;
  if (!qa) return;
  Storage.prototype.getItem = qa.origGet;
  Storage.prototype.setItem = qa.origSet;
})();`;

await cdp('Page.enable'); await cdp('Runtime.enable');
const profile = { ...blankProfile(), primary: 'business', pathways: ['business'], name: 'QA Storage Studio', audience: 'Local businesses', industry: 'Design', goal: 'Storage QA' };
const draft = { version: 1, profileId: 'local-business', heading: 'Persisted shelf', introduction: 'Intro', layout: 'stacked', offerSnapshots: [{ offerId: 'o1', name: 'Offer', outcome: 'Outcome', amountMinor: 4900, currency: 'AUD' }] };
const offer = { version: 1, id: 'o1', profileId: 'local-business', name: 'Offer', audience: 'Local businesses', outcome: 'Outcome', delivery: 'Delivery', amountMinor: 4900, currency: 'AUD', kind: 'service' };

await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.setItem('launchpad.offers.v1.local-business', ${JSON.stringify(JSON.stringify([offer]))}); localStorage.setItem(${JSON.stringify(STOREFRONT_KEY)}, ${JSON.stringify(JSON.stringify(draft))});`);

const { identifier: denyId } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: denyGetSource });
await cdp('Page.reload');
await wait('!!document.querySelector("#storefront-storage-error")');
assert.equal(await evaluate('document.querySelector("#storefront-storage-error")?.textContent.includes("Nothing was overwritten")'), true);
await wait('[...document.querySelectorAll(".storefront-draft button")].some(b => b.textContent.trim() === "Create storefront draft" && b.disabled)');
await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: denyId });
await evaluate(restoreSource);
await cdp('Page.reload');
await wait(bodyIncludes('Persisted shelf'));
assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(STOREFRONT_KEY)})`), JSON.stringify(draft));

await evaluate(denyGetSource);
try {
  await click('Reload saved draft');
  await wait(bodyIncludes('Nothing was overwritten.'));
  assert.ok(await evaluate(bodyIncludes('Persisted shelf')));
  assert.equal(await evaluate('document.querySelector("#storefront-storage-error") !== null'), true);
  assert.equal(await evaluate('window.__storefrontQa?.writes || 0'), 0);
} finally {
  await evaluate(restoreSource);
}

await cdp('Page.reload');
await wait(bodyIncludes('Persisted shelf'));
await click('Edit storefront draft');
await wait(bodyIncludes('Edit storefront draft'));
try {
  await evaluate(quotaSetSource);
  await fill('Business heading', 'Quota blocked', "document.querySelector('.storefront-draft form')");
  await click('Save local storefront draft');
  await wait('document.body.innerText.toLowerCase().includes("quota")');
  assert.equal(await evaluate('!!document.querySelector(".storefront-draft form")'), true);
  assert.equal(await evaluate("document.querySelector('.storefront-draft form')?.querySelector('input')?.value"), 'Quota blocked');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(STOREFRONT_KEY)})`), JSON.stringify(draft));
  assert.equal(await evaluate('window.__storefrontQa.writes'), 1);
} finally {
  await evaluate(restoreSource);
}

assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
console.log(`PASS: R5 denied read on mount/reload and quota-denied save preserve editor on ${QA_BASE_URL}`);
ws.close();
