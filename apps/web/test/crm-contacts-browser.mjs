import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
const evidenceDir = process.env.CRM_QA_EVIDENCE_DIR || '/tmp/launchpad-crm-contacts-20261016';
await mkdir(evidenceDir, { recursive: true });

const target = (await (await fetch('http://127.0.0.1:9322/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
const exceptions = [];
ws.addEventListener('message', event => {
  const data = JSON.parse(event.data);
  if (data.id) {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) p.reject(new Error(JSON.stringify(data.error)));
    else p.resolve(data.result);
  } else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Runtime evaluate failed');
  return res.result.value;
};
const wait = async (expression, ms = 12000) => {
  const deadline = Date.now() + ms;
  do {
    try { if (await evaluate(expression)) return; } catch (error) { if (!/navigated|context/.test(error.message)) throw error; }
    await new Promise(r => setTimeout(r, 50));
  } while (Date.now() < deadline);
  throw new Error('Timeout: ' + expression);
};
const click = async (label, selector = 'button') => {
  await evaluate(`(() => {const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`);
};
const waitEnabledButton = async label => {
  await wait(`(() => {const el = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); return el && !el.disabled;})()`);
};
const assertFocusedButton = async label => {
  const active = await evaluate(`(() => {const el = document.activeElement; if (!el || el.tagName !== 'BUTTON') return ''; return el.textContent.trim();})()`);
  assert.equal(active, label);
};
const fill = async (label, value, root = 'document') => {
  await evaluate(`(() => {const label = [...${root}.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim().startsWith(${JSON.stringify(label)})); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`);
};
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;

await cdp('Page.enable');
await cdp('Runtime.enable');
const profile = { ...blankProfile(), primary: 'business', pathways: ['business'], name: 'QA CRM Studio', audience: 'Local businesses', industry: 'Design', goal: 'CRM drafts' };
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.removeItem('launchpad.crm-contacts.v1.local-business');`);
await cdp('Page.reload');
await wait(bodyIncludes('CRM contacts'));
await waitEnabledButton('Create contact');
await click('Create contact');
await wait(bodyIncludes('New contact'));
assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'New contact');
await fill('Name *', 'Jordan Lead');
await fill('Email (optional, never sent)', 'jordan@example.test');
await fill('Phone (optional)', '0400 111 222');
await click('Save local contact');
await wait(bodyIncludes('Jordan Lead'));
await assertFocusedButton('Create contact');
await fill('Search contacts', 'jordan@');
await wait(bodyIncludes('Jordan Lead'));
await click('Edit contact');
await fill('Name *', 'Jordan Updated');
await click('Cancel contact changes');
await wait(bodyIncludes('Jordan Lead'));
await assertFocusedButton('Create contact');
await click('Edit contact');
await fill('Name *', 'Jordan Updated');
await click('Save local contact');
await wait(bodyIncludes('Jordan Updated'));
await cdp('Page.reload');
await wait(bodyIncludes('Jordan Updated'));
const raw = await evaluate("localStorage.getItem('launchpad.crm-contacts.v1.local-business')");
assert.ok(JSON.parse(raw).some(c => c.name === 'Jordan Updated'));
assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
console.log(`PASS: CRM contacts journey on ${QA_BASE_URL} — evidence dir ${evidenceDir}`);
ws.close();
