import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { blankProfile } from '../lib/onboarding.ts';
import { contactStorageKey, saveContact, blankContactInput } from '../lib/local-crm-contacts.ts';
import { dealStorageKey, saveDeal, blankDealInput } from '../lib/local-crm-pipeline.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3117').replace(/\/$/, '');
const CDP_URL = process.env.CRM_PIPELINE_CDP_URL || 'http://127.0.0.1:9323';
const evidenceDir = process.env.CRM_PIPELINE_QA_EVIDENCE_DIR || '/tmp/launchpad-crm-pipeline-20261016';
await mkdir(evidenceDir, { recursive: true });

const target = (await (await fetch(`${CDP_URL}/json/list`)).json()).find(t => t.type === 'page');
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
const scrollPipelineIntoView = async () => {
  await evaluate(`(() => { const el = document.querySelector('.crm-pipeline'); if (!el) throw new Error('pipeline section missing'); el.scrollIntoView({ block: 'start', behavior: 'instant' }); })()`);
};
const screenshot = async name => {
  await scrollPipelineIntoView();
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`${evidenceDir}/${name}`, Buffer.from(data, 'base64'));
};

await cdp('Page.enable');
await cdp('Runtime.enable');
const profile = { ...blankProfile(), primary: 'business', pathways: ['business'], name: 'QA Pipeline Studio', audience: 'Local businesses', industry: 'Design', goal: 'Pipeline drafts' };
const contact = saveContact({ ...blankContactInput(), name: 'Pipeline Contact', email: 'pipe@example.test' }, { id: 'qa-contact-pipeline', profileId: profile.id });
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.setItem(${JSON.stringify(contactStorageKey(profile.id))}, ${JSON.stringify(JSON.stringify([contact]))}); localStorage.removeItem(${JSON.stringify(dealStorageKey(profile.id))});`);
await cdp('Page.reload');
await wait(bodyIncludes('Sales pipeline'));
await waitEnabledButton('Create deal');
await click('Create deal');
await wait(bodyIncludes('New deal'));
await fill('Deal title *', 'QA Opportunity');
await fill('Contact *', contact.id);
await fill('Value (optional, not charged)', '999.00');
await click('Save local deal');
await wait(bodyIncludes('QA Opportunity'));
await assertFocusedButton('Create deal');
await fill('Search deals', 'opportunity');
await wait(bodyIncludes('QA Opportunity'));
const dealRaw = await evaluate(`localStorage.getItem(${JSON.stringify(dealStorageKey(profile.id))})`);
const dealId = JSON.parse(dealRaw)[0].id;
// Programmatic stage change: verifies persist + focus return on the stage select (not a keyboard-driven native-select path).
await evaluate(`(() => { const el = document.getElementById('deal-stage-' + ${JSON.stringify(dealId)}); if (!el) throw new Error('stage select missing'); el.value = 'proposal'; el.dispatchEvent(new Event('change', { bubbles: true })); el.focus(); })()`);
await wait(bodyIncludes('Stage updated to Proposal'));
assert.equal(await evaluate(`document.activeElement.id`), `deal-stage-${dealId}`);
await click('List by stage');
await wait(bodyIncludes('Proposal'));
await evaluate(`(() => { const card = [...document.querySelectorAll('.crm-deal-card')].find(x => x.textContent.includes('QA Opportunity')); const btn = card?.querySelector('button'); if (!btn) throw new Error('edit missing'); btn.click(); })()`);
await wait(bodyIncludes('Edit deal'));
await fill('Deal title *', 'QA Opportunity Updated');
await click('Cancel deal changes');
await wait(bodyIncludes('QA Opportunity'));
await assertFocusedButton('Create deal');
await evaluate(`(() => { const card = [...document.querySelectorAll('.crm-deal-card')].find(x => x.textContent.includes('QA Opportunity')); const btn = card?.querySelector('button'); if (!btn) throw new Error('edit missing'); btn.click(); })()`);
await fill('Deal title *', 'QA Opportunity Updated');
await click('Save local deal');
await wait(bodyIncludes('QA Opportunity Updated'));
await cdp('Page.reload');
await wait(bodyIncludes('QA Opportunity Updated'));
const removedContactId = 'qa-contact-removed-pipeline';
const orphanDeal = saveDeal(
  { ...blankDealInput(removedContactId), title: 'Orphan QA Deal', stage: 'new', value: '' },
  { id: 'qa-deal-orphan', profileId: profile.id },
);
const dealsWithOrphan = JSON.stringify([JSON.parse(dealRaw)[0], orphanDeal]);
await evaluate(`localStorage.setItem(${JSON.stringify(dealStorageKey(profile.id))}, ${JSON.stringify(dealsWithOrphan)}); localStorage.setItem(${JSON.stringify(contactStorageKey(profile.id))}, ${JSON.stringify(JSON.stringify([contact]))});`);
await cdp('Page.reload');
await wait(bodyIncludes('Orphan QA Deal'));
await wait(bodyIncludes('Missing contact (saved deal only)'));
await evaluate(`(() => { const card = [...document.querySelectorAll('.crm-deal-card')].find(x => x.textContent.includes('Orphan QA Deal')); const btn = card?.querySelector('button'); if (!btn) throw new Error('orphan edit missing'); btn.click(); })()`);
await wait(bodyIncludes('Edit deal'));
const orphanSelectState = await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim().startsWith('Contact *')); const sel = label?.querySelector('select'); if (!sel) throw new Error('contact select missing'); return { value: sel.value, valid: sel.checkValidity(), hasMissingOption: [...sel.options].some(o => o.value === ${JSON.stringify(removedContactId)} && o.textContent.includes('keep saved ID')) }; })()`);
assert.equal(orphanSelectState.value, removedContactId);
assert.equal(orphanSelectState.valid, true);
assert.equal(orphanSelectState.hasMissingOption, true);
await click('Save local deal');
await wait(bodyIncludes('Deal saved in this browser'));
const orphanRaw = await evaluate(`localStorage.getItem(${JSON.stringify(dealStorageKey(profile.id))})`);
const orphanStored = JSON.parse(orphanRaw).find(d => d.id === 'qa-deal-orphan');
assert.equal(orphanStored.contactId, removedContactId);
await waitEnabledButton('Create deal');
await click('Create deal');
await wait(bodyIncludes('New deal'));
const newDealContactOptions = await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim().startsWith('Contact *')); const sel = label?.querySelector('select'); if (!sel) throw new Error('contact select missing'); return [...sel.options].map(o => o.value); })()`);
assert.equal(newDealContactOptions.includes(removedContactId), false);
assert.equal(newDealContactOptions.includes(''), true);
assert.equal(newDealContactOptions.includes(contact.id), true);
await click('Cancel deal changes');
await scrollPipelineIntoView();
await screenshot('crm-pipeline-card-desktop.png');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await scrollPipelineIntoView();
await screenshot('crm-pipeline-card-mobile.png');
await cdp('Emulation.clearDeviceMetricsOverride');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await screenshot('crm-pipeline-mobile.png');
const overflow = await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth');
assert.equal(overflow, false);
await cdp('Emulation.clearDeviceMetricsOverride');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await screenshot('crm-pipeline-desktop.png');
assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
console.log(`PASS: CRM pipeline journey on ${QA_BASE_URL} — evidence dir ${evidenceDir}`);
ws.close();
