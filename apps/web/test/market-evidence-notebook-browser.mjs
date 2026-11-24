import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
const CDP_PORT = Number(process.env.MARKET_EVIDENCE_QA_CDP_PORT || '9323');
const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/market-evidence/', import.meta.url));
await mkdir(evidenceDir, { recursive: true });

const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).catch(() => null);
if (!listRes?.ok) {
  console.error(`Market evidence browser journey skipped: CDP not available on port ${CDP_PORT}.`);
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
const root = "document.querySelector('.market-evidence')";
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
const storageKey = 'launchpad.market-evidence-notebook.v1.local-business';
const profileKey = 'launchpad.business-profile.v1';

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);
const profile = {
  ...blankProfile(),
  name: 'QA Market',
  audience: 'Creators',
  goal: 'Test offer',
  expertise: 'Workshop facilitation',
  industry: 'Training',
  pathways: ['education', 'business'],
  primary: 'education',
};
await evaluate(
  `localStorage.setItem(${JSON.stringify(profileKey)}, ${JSON.stringify(JSON.stringify(profile))}); localStorage.removeItem(${JSON.stringify(storageKey)});`,
);
await cdp('Page.reload');
await wait(bodyIncludes('Start market evidence notebook'));
await click('Start market evidence notebook', root);
await fill('Market hypothesis', 'Creators may want cohort-based onboarding help.', root);
await fill('Source title', 'Interview note', root);
await fill('Your observation (your words)', 'Two creators said they skip generic courses.', root);
await fill('Relevance to audience / offer hypothesis', 'Aligns with cohort onboarding angle.', root);
await click('Preview unsaved summary', root);
await wait(bodyIncludes('Manual notes only'));
assert.ok(await evaluate(`${root}.querySelector('.market-evidence-summary').innerText.includes('External source links')`));
await click('Close summary', root);
await click('Save local market evidence', root);
await wait(bodyIncludes('Market evidence notebook saved'));
const savedRaw = await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
assert.ok(savedRaw);
const profileAfter = await evaluate(`localStorage.getItem(${JSON.stringify(profileKey)})`);
assert.equal(JSON.parse(profileAfter).audience, 'Creators');
await click('View evidence summary', root);
await wait(bodyIncludes('Interview note'));
await click('Close summary', root);

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.captureScreenshot', { format: 'png' }).then(res =>
  writeFile(`${evidenceDir}/mobile-market-evidence.png`, Buffer.from(res.data, 'base64')),
);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

ws.close();
console.log(`PASS: market evidence browser journey on ${QA_BASE_URL}`);
