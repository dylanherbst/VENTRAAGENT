import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
// Run only against the separately launched, dedicated QA Chrome profile on port 9322.
const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/storefront-drafts/', import.meta.url));
await mkdir(evidenceDir, { recursive: true });
const target = (await (await fetch('http://127.0.0.1:9322/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0; const pending = new Map(); const exceptions = [];
ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); pending.delete(data.id); if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails); });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Runtime evaluate failed'); return res.result.value; };
const wait = async (expression, ms = 12000) => { const deadline = Date.now() + ms; do { try { if (await evaluate(expression)) return; } catch (error) { if (!/navigated|context/.test(error.message)) throw error; } await new Promise(r => setTimeout(r, 50)); } while (Date.now() < deadline); throw new Error('Timeout: ' + expression); };
const click = async (label, selector = 'button') => { await evaluate(`(() => {const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`); };
const fill = async (label, value, root = 'document') => { await evaluate(`(() => {const label = [...${root}.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`); };
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const screenshot = async name => { const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(`${evidenceDir}/${name}.png`, Buffer.from(result.data, 'base64')); };
const pressKey = async key => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key }); };
const waitStorefrontReady = async () => {
  await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create storefront draft' || b.textContent.trim() === 'Edit storefront draft')`);
};

await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
const profile = { ...blankProfile(), primary: 'business', pathways: ['business'], name: 'QA Store Studio', audience: 'Local businesses', industry: 'Design', goal: 'Draft storefront' };
await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.removeItem('launchpad.offers.v1.local-business'); localStorage.removeItem('launchpad.storefront-draft.v1.local-business');`);
await cdp('Page.reload');
await wait(bodyIncludes('Create an offer →'));
await waitStorefrontReady();

await click('Create an offer →'); await wait(bodyIncludes('Create your offer'));
for (const [label, value] of [['Offer name', 'Shelf offer'], ['Audience', 'Local businesses'], ['One-time price (0 for free)', '49.00'], ['Description or promised outcome', 'Visible outcome'], ['Delivery details: inclusions, duration, location and booking plan', 'Delivery stays private']]) await fill(label, value);
await click('Save local offer'); await wait(bodyIncludes('Shelf offer'));

await click('Create an offer →');
await wait(bodyIncludes('Create your offer'));
for (const [label, value] of [['Offer name', 'Second shelf'], ['Audience', 'Local businesses'], ['One-time price (0 for free)', '19.00'], ['Description or promised outcome', 'Second outcome'], ['Delivery details: inclusions, duration, location and booking plan', 'Second delivery']]) await fill(label, value);
await click('Save local offer'); await wait(bodyIncludes('Second shelf'));

await click('Create storefront draft'); await wait(bodyIncludes('New storefront draft'));
assert.equal(await evaluate('document.activeElement.textContent'), 'New storefront draft');
await fill('Business heading', '<img src=x onerror=alert(1)> QA shelf');
await fill('Introduction', 'Intro only.');
assert.equal(JSON.parse(await evaluate("localStorage.getItem('launchpad.offers.v1.local-business')")).length, 2);
await evaluate("(() => {for (const box of document.querySelectorAll('.storefront-draft fieldset input[type=checkbox]')) box.click();})()");
await fill('Search title', 'QA search title');
await fill('Search description', 'QA search description for local preview only.');
await click('Preview search appearance'); await wait(bodyIncludes('Local only · not indexed'));
assert.ok(await evaluate("document.querySelector('.storefront-search-snippet-title')?.textContent === 'QA search title'"));
assert.ok(await evaluate("document.querySelector('.storefront-search-snippet-description')?.textContent.includes('QA search description')"));
await click('Close search preview'); await wait('!document.querySelector(\'.storefront-search-preview\')');
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Preview search appearance');

await click('Preview unsaved draft'); await wait(bodyIncludes('Unsaved preview'));
assert.equal(await evaluate("document.querySelectorAll('.storefront-preview img').length"), 0);
assert.ok(await evaluate("document.querySelector('.storefront-preview').innerText.includes('AUD 49.00')"));
assert.ok(await evaluate("!document.querySelector('.storefront-preview').innerText.includes('Delivery stays private')"));
await click('Close preview'); await wait('!document.querySelector(\'.storefront-preview\')');
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Preview unsaved draft');

await click('Save local storefront draft'); await wait(bodyIncludes('Storefront draft saved'));
await click('Preview search appearance'); await wait(bodyIncludes('Local only · not indexed'));
await click('Close search preview'); await wait('!document.querySelector(\'.storefront-search-preview\')');
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Preview search appearance');
const savedRaw = await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')");
const savedJson = JSON.parse(savedRaw);
assert.equal(savedJson.offerSnapshots.length, 2);
assert.equal(savedJson.searchTitle, 'QA search title');

await click('Edit storefront draft'); await fill('Business heading', 'Cancelled heading'); await click('Cancel storefront changes');
assert.equal(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')"), savedRaw);
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Edit storefront draft');

await click('Edit storefront draft'); await fill('Business heading', 'Updated shelf'); await click('Save local storefront draft'); await wait(bodyIncludes('Updated shelf'));
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Edit storefront draft');

await cdp('Page.reload');
await wait(bodyIncludes('Saved heading:'));
await wait(bodyIncludes('Updated shelf'));
await waitStorefrontReady();
await click('Preview saved draft'); await wait(bodyIncludes('Saved draft preview'));
await evaluate("document.querySelector('.storefront-preview').scrollIntoView({block:'start'})"); await screenshot('desktop-preview');

// Keyboard: focus reorder on first selected offer and move down via keyboard on move button
await click('Close preview');
await click('Edit storefront draft');
await evaluate("(() => {const b=[...document.querySelectorAll('.storefront-draft button')].find(x => /Move .+ down/.test(x.getAttribute('aria-label')||'')); if(!b) throw new Error('move down'); b.focus();})()");
await pressKey('Enter');
await click('Preview unsaved draft'); await wait(bodyIncludes('Unsaved preview'));
await click('Close preview');

// Missing-offer recovery: drop one offer from library, remove unavailable row, save
assert.equal(JSON.parse(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')")).offerSnapshots.length, 2);
await evaluate(`(() => {const offers=JSON.parse(localStorage.getItem('launchpad.offers.v1.local-business')); localStorage.setItem('launchpad.offers.v1.local-business', JSON.stringify([offers[0]]));})()`);
await click('Cancel storefront changes');
await click('Edit storefront draft');
await wait(bodyIncludes('Remove unavailable offer'));
await click('Remove unavailable offer');
await wait('!document.body.innerText.includes(\'Remove unavailable offer\')');
await click('Save local storefront draft'); await wait(bodyIncludes('Storefront draft saved'));
assert.equal(JSON.parse(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')")).offerSnapshots.length, 1);

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await click('Preview saved draft'); await wait(bodyIncludes('Saved draft preview'));
await screenshot('mobile-preview');
assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'No mobile page overflow');

// Stale tab while editing: cancel before reload
await click('Close preview');
await click('Edit storefront draft'); await fill('Business heading', 'Pending edit');
await evaluate("(() => {const key='launchpad.storefront-draft.v1.local-business';localStorage.setItem(key, JSON.stringify({...JSON.parse(localStorage.getItem(key)), heading:'Other tab'}));})()");
await click('Save local storefront draft'); await wait(bodyIncludes('another tab'));
assert.equal(await evaluate("[...document.querySelectorAll('.storefront-draft input')].find(x=>x.value==='Pending edit')?.value"), 'Pending edit');
await click('Cancel storefront changes');

const corrupt = '{';
await evaluate(`localStorage.setItem('launchpad.storefront-draft.v1.local-business', ${JSON.stringify(corrupt)})`);
await click('Reload saved draft'); await wait(bodyIncludes('Nothing was overwritten.'));
assert.equal(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')"), corrupt);
assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit storefront draft')?.disabled"), true);
await click('Preview saved draft'); await wait(bodyIncludes('last-known draft'));
assert.ok(await evaluate(bodyIncludes('Nothing was overwritten.')));
assert.equal(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')"), corrupt);

assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
console.log(`PASS: storefront journey on ${QA_BASE_URL} — preview/save/focus/keyboard/reorder/missing-offer/stale/corrupt storage.`);
ws.close();
