import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
const CDP_PORT = Number(process.env.COMMUNITY_QA_CDP_PORT || '9322');
const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/community-drafts/', import.meta.url));
await mkdir(evidenceDir, { recursive: true });

const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).catch(() => null);
if (!listRes?.ok) {
  console.error(`Community browser journey skipped: CDP not available on port ${CDP_PORT}.`);
  process.exit(0);
}

const target = (await listRes.json()).find(t => t.type === 'page');
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
const wait = async (expression, ms = 15000) => {
  const deadline = Date.now() + ms;
  do {
    try { if (await evaluate(expression)) return; } catch (error) { if (!/navigated|context/.test(error.message)) throw error; }
    await new Promise(r => setTimeout(r, 50));
  } while (Date.now() < deadline);
  throw new Error('Timeout: ' + expression);
};
const communityRoot = "document.querySelector('.community-space')";
const click = async (label, rootExpr = 'document') => {
  await evaluate(`(() => {const root = ${rootExpr}; const el = [...root.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`);
};
const fill = async (label, value, rootExpr = 'document') => {
  await evaluate(`(() => {const root = ${rootExpr}; const label = [...root.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`);
};
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const storageKey = 'launchpad.community-space-draft.v1.local-business';

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
const profile = { ...blankProfile(), name: 'QA Community', audience: 'Members', expertise: 'Teaching', goal: 'Space' };
await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.removeItem(${JSON.stringify(storageKey)});`);
await cdp('Page.reload');
await wait(bodyIncludes('Create community space draft'));
await click('Create community space draft', communityRoot);
await wait(bodyIncludes('New community space'));
await fill('Community name', 'QA Lounge', communityRoot);
await fill('Community description', 'A read-only preview space.', communityRoot);
await fill('Community rules', 'Respect everyone.\nNo spam.', communityRoot);
await click('Add topic', communityRoot);
await fill('Topic name', 'Introductions', communityRoot);
await fill('Topic description (optional)', 'Say hi.', communityRoot);
await click('Preview unsaved member view', communityRoot);
await wait(bodyIncludes('Read-only member view'));
assert.ok(await evaluate(`${communityRoot}.querySelector('.community-member-preview').innerText.includes('Respect everyone')`));
await click('Close member preview', communityRoot);
await click('Save local community draft', communityRoot);
await wait(bodyIncludes('Community space draft saved'));
const savedRaw = await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
assert.ok(savedRaw);
await click('Open member preview', communityRoot);
await wait(bodyIncludes('Introductions'));
await click('Close member preview', communityRoot);

await click('Edit community space draft', communityRoot);
await fill('Community name', 'Stale name', communityRoot);
await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify({ corrupt: true }))})`);
await click('Save local community draft', communityRoot);
assert.ok(await evaluate(`${communityRoot}.innerText.includes('another tab') || ${communityRoot}.innerText.includes('Invalid')`));
await click('Cancel community changes', communityRoot);
await click('Reload saved community draft', communityRoot);
const corruptRaw = await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
assert.equal(corruptRaw, '{"corrupt":true}');
assert.ok(await evaluate(`${communityRoot}.innerText.includes('Invalid') || ${communityRoot}.innerText.includes('could not be restored')`));

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await screenshot('mobile-community');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await screenshot('desktop-community');

async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${evidenceDir}/${name}.png`, Buffer.from(result.data, 'base64'));
}

assert.equal(exceptions.length, 0, 'CDP exceptions: ' + JSON.stringify(exceptions));
ws.close();
console.log('Community space browser journey passed.');
