import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:3148';
const qaUrl = new URL(QA_BASE_URL);
assert.equal(qaUrl.origin, QA_BASE_URL, 'QA_BASE_URL must be an origin without a path');
assert.equal(qaUrl.hostname, '127.0.0.1', 'QA_BASE_URL must use the loopback QA host');
assert.ok(['3148', '3149'].includes(qaUrl.port) && qaUrl.protocol === 'http:', 'QA_BASE_URL must use an approved local QA port');
const CDP_URL = 'http://127.0.0.1:9348';
const QA_PROFILE_DIR = '/tmp/ventraa-starters-chrome-20261017';
// Fail closed unless CDP belongs to the disposable browser profile used for this harness.
const browserInfo = await (await fetch(`${CDP_URL}/json/version`)).json();
const browserWs = new WebSocket(browserInfo.webSocketDebuggerUrl);
await new Promise(resolve => browserWs.addEventListener('open', resolve, { once: true }));
let browserArgs;
try {
  browserArgs = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser profile check timed out')), 5000);
    browserWs.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      if (response.id !== 1) return;
      clearTimeout(timer);
      if (response.error) reject(new Error(`Browser profile check unavailable: ${JSON.stringify(response.error)}`));
      else resolve(response.result.arguments);
    });
    browserWs.send(JSON.stringify({ id: 1, method: 'Browser.getBrowserCommandLine' }));
  });
} finally { browserWs.close(); }
assert.ok(browserArgs.includes(`--user-data-dir=${QA_PROFILE_DIR}`), 'CDP browser is not the dedicated QA profile');
assert.ok(browserArgs.includes('--remote-debugging-port=9348'), 'CDP browser is not the dedicated QA instance');
const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/website-page-removal-2026-10-17/', import.meta.url));
await mkdir(evidenceDir, { recursive: true });
const target = await (await fetch(`${CDP_URL}/json/new?about:blank`, { method: 'PUT' })).json();
assert.equal(target.type, 'page', 'Could not create a dedicated QA tab');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0; const pending = new Map(); const exceptions = [];
let loaded = null;
ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result); } else if (data.method === 'Page.loadEventFired') { loaded?.(); loaded = null; } else if (data.method === 'Page.javascriptDialogOpening' && data.params.type === 'beforeunload') { cdp('Page.handleJavaScriptDialog', { accept: true }); } else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails); });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const callId = ++id; const timer = setTimeout(() => { pending.delete(callId); reject(new Error('CDP timeout: ' + method)); }, 15000); pending.set(callId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id: callId, method, params })); });
const evaluate = async expression => { const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Runtime evaluate failed'); return res.result.value; };
const wait = async (expression, ms = 12000) => { const deadline = Date.now() + ms; do { try { if (await evaluate(expression)) return; } catch (error) { if (!/navigated|context/.test(error.message)) throw error; } await new Promise(r => setTimeout(r, 50)); } while (Date.now() < deadline); throw new Error('Timeout: ' + expression); };
const click = async (label, selector = 'button') => { await evaluate(`(() => {const el = [...document.querySelector('.website-page-draft').querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`); };
const fill = async (label, value, root = "document.querySelector('.website-page-draft')") => { await evaluate(`(() => {const label = [...${root}.querySelectorAll('label')].find(x => [...x.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`); };
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const screenshot = async name => { const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(`${evidenceDir}/${name}.png`, Buffer.from(result.data, 'base64')); };
const pressKey = async key => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: key === 'Enter' ? 13 : 9 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 9 }); };
const reloadPage = async () => { const complete = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Reload load event timeout')), 15000); loaded = () => { clearTimeout(timer); resolve(); }; }); await cdp('Page.reload'); await complete; };
const key = 'launchpad.website-page-draft.v1.local-business';
const getRaw = () => evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const focusText = () => evaluate('document.activeElement.textContent.trim()');
const messages = [];
try {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
  await wait(`document.readyState === 'complete' && location.origin === ${JSON.stringify(QA_BASE_URL)}`);
  const profile = { ...blankProfile(), primary: 'business', pathways: ['business'], name: 'Starter QA', audience: 'Independent makers', industry: 'Design', goal: 'Draft a page' };
  await evaluate(`for (const key of ['launchpad.business-profile.v1','launchpad.storefront-draft.v1.local-business','launchpad.website-page-draft.v1.other-owner','launchpad.website-page-draft.v1.local-business']) localStorage.removeItem(key); localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.setItem('launchpad.storefront-draft.v1.local-business','KEEP STOREFRONT'); localStorage.setItem('launchpad.website-page-draft.v1.other-owner','KEEP OTHER OWNER')`);
  await reloadPage(); await wait(bodyIncludes('Create website page'));
  for (const width of [1440, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`);
    await click('Reload saved website page'); await wait(bodyIncludes('No saved website page yet.'));
    if (width === 1440) assert.equal(await evaluate("document.querySelector('.website-page-draft select').value"), 'blank');
    await fill('New page starter', 'blank');
    await click('Create website page'); await wait(bodyIncludes('New website page draft'));
    assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), '');
    assert.equal(await getRaw(), null);
    await click('Cancel website page changes');
    for (const [id, title] of [['service', 'Useful work, shaped around you'], ['creator', 'Notes from a work in progress'], ['landing', 'Make room for one useful idea']]) {
      await wait(bodyIncludes('Choose a starting point'));
      await fill('New page starter', id);
      assert.equal(await getRaw(), null);
      await evaluate("document.querySelector('.website-page-draft select').focus()");
      await pressKey('Tab');
      assert.equal(await focusText(), 'Create website page');
      await pressKey('Enter');
      await wait(bodyIncludes('New website page draft'));
      assert.equal(await focusText(), 'New website page draft');
      assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), title);
      assert.equal(await evaluate("[...document.querySelector('.website-page-draft').querySelectorAll('label')].some(x=>x.textContent.includes('New page starter'))"), false);
      await pressKey('Tab'); assert.equal(await evaluate('document.activeElement.tagName'), 'INPUT');
      await fill('Page title', `<script>not executable</script> ${id}`);
      await click('Preview unsaved website page'); await wait(bodyIncludes('Unsaved owner preview · unpublished'));
      assert.equal(await focusText(), 'Unsaved owner preview · unpublished');
      assert.equal(await getRaw(), null);
      assert.equal(await evaluate("document.querySelectorAll('.website-page-canvas script,.website-page-canvas img,.website-page-canvas a').length"), 0);
      assert.equal(await evaluate("document.querySelector('.website-page-canvas button').disabled"), true);
      await evaluate("document.querySelector('.website-page-owner-preview').scrollIntoView()");
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await screenshot(`${id}-preview-${width}`);
      await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
      assert.equal(await focusText(), 'Preview unsaved website page');
      assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), `<script>not executable</script> ${id}`);
      await click('Reload saved website page'); await wait(bodyIncludes('Discard edits and reload page'));
      await click('Keep editing website page');
      assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), `<script>not executable</script> ${id}`);
      if (id !== 'landing') {
        await click('Cancel website page changes'); await wait(bodyIncludes('Create website page')); assert.equal(await getRaw(), null);
      }
    }
    // The saved landing starter exercises adjacent section order and CTA remapping.
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.website-page-draft form fieldset input')].map(x => x.value)"), ['A smaller, clearer starting point', 'Try a first step']);
    await evaluate("([...document.querySelectorAll('.website-page-draft button')].find(x => x.textContent.trim() === 'Move section 2 up')).focus()");
    await pressKey('Enter');
    await wait("document.querySelector('.website-page-draft form fieldset input')?.value === 'Try a first step'");
    assert.equal(await evaluate("document.activeElement.value"), 'Try a first step');
    const firstMoveStatus = await evaluate("document.querySelector('.website-page-draft [role=status]').textContent");
    await click('Move section 1 down');
    await click('Move section 2 up');
    const repeatedMoveStatus = await evaluate("document.querySelector('.website-page-draft [role=status]').textContent");
    assert.notEqual(repeatedMoveStatus, firstMoveStatus, 'Repeated same-destination move must update live region');
    assert.match(repeatedMoveStatus, /section 2 moved to position 1.*Action 3/);
    assert.equal(await evaluate("[...document.querySelectorAll('.website-page-draft form select')].find(x => x.value.startsWith('section-'))?.value"), 'section-1');
    assert.equal(await getRaw(), null);
    await click('Preview unsaved website page'); await wait(bodyIncludes('Unsaved owner preview'));
    assert.equal(await evaluate("document.querySelector('.website-page-canvas section h3')?.textContent"), 'Try a first step');
    assert.equal(await evaluate("document.querySelector('.website-page-cta p')?.textContent"), 'Destination: Section 1');
    await screenshot(`reordered-preview-${width}`);
    await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
    await click('Save website page'); await wait(bodyIncludes('Website page saved in this browser. Still unpublished.'));
    let savedRaw = await getRaw();
    await reloadPage(); await wait(bodyIncludes('Edit website page'));
    assert.equal(await getRaw(), savedRaw);
    assert.deepEqual(JSON.parse(savedRaw).sections.map(section => section.heading), ['Try a first step', 'A smaller, clearer starting point']);
    assert.equal(JSON.parse(savedRaw).ctaTarget, 'section-1');
    assert.equal(await evaluate("document.querySelector('.website-page-draft select') === null"), true);
    await click('Edit website page'); await wait(bodyIncludes('Edit website page draft'));
    for (const ordinal of [3, 4]) {
      await click('Add text section');
      await fill(`Section ${ordinal} heading`, `Extra ${ordinal}`);
      await fill(`Section ${ordinal} text`, `Body ${ordinal}`);
    }
    assert.equal(await evaluate("[...document.querySelectorAll('.website-page-draft button')].find(x => x.textContent === 'Add text section').disabled"), true);
    await fill('Page button destination', 'section-4');
    // Native Tab/Enter activates arbitrary (non-last) removal at both widths.
    await evaluate("[...document.querySelectorAll('.website-page-draft button')].find(x => x.textContent === 'Move section 2 down').focus()");
    await pressKey('Tab'); assert.equal(await focusText(), 'Remove text section 2');
    await pressKey('Enter');
    await wait("document.querySelectorAll('.website-page-draft form fieldset').length === 3");
    assert.equal(await evaluate('document.activeElement.value'), 'Extra 3');
    assert.equal(await evaluate("document.querySelector('.website-page-draft form select').value"), 'section-3');
    assert.equal(await getRaw(), savedRaw);
    await click('Preview unsaved website page'); await wait(bodyIncludes('Unsaved owner preview'));
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.website-page-canvas section h3')].map(x => x.textContent)"), ['Try a first step', 'Extra 3', 'Extra 4']);
    assert.equal(await evaluate("document.querySelector('.website-page-cta p').textContent"), 'Destination: Section 3');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await screenshot(`removed-middle-preview-${width}`);
    await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
    assert.equal(await focusText(), 'Preview unsaved website page');
    await click('Remove text section 3');
    assert.equal(await evaluate('document.activeElement.value'), 'Extra 3');
    assert.equal(await evaluate("document.querySelector('.website-page-draft form select').value"), '');
    assert.equal(await evaluate("[...document.querySelectorAll('.website-page-draft form input')].at(-1).value"), '');
    assert.match(await evaluate("document.querySelector('.website-page-draft [role=status]').textContent"), /Page button cleared/);
    await fill('Page button label (optional)', 'Keep first'); await fill('Page button destination', 'section-1');
    await click('Remove text section 2');
    assert.equal(await evaluate('document.activeElement.value'), 'Try a first step');
    assert.equal(await evaluate("document.querySelector('.website-page-draft form select').value"), 'section-1');
    assert.equal(await evaluate("[...document.querySelectorAll('.website-page-draft button')].some(x => x.textContent.startsWith('Remove text section'))"), false);
    await click('Reload saved website page'); await wait(bodyIncludes('Discard edits and reload page'));
    await click('Keep editing website page'); assert.equal(await getRaw(), savedRaw);
    await click('Cancel website page changes'); await click('Edit website page');
    assert.equal(await evaluate("document.querySelectorAll('.website-page-draft form fieldset').length"), 2);
    // First-section target removal clears both fields and persists only on explicit save.
    await click('Remove text section 1');
    assert.equal(await evaluate('document.activeElement.value'), 'A smaller, clearer starting point');
    assert.equal(await getRaw(), savedRaw);
    await click('Preview unsaved website page'); await wait(bodyIncludes('Unsaved owner preview'));
    assert.equal(await evaluate("document.querySelectorAll('.website-page-cta').length"), 0);
    await screenshot(`removed-first-preview-${width}`);
    await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
    await click('Save website page'); await wait(bodyIncludes('Website page saved in this browser. Still unpublished.'));
    savedRaw = await getRaw();
    assert.equal(JSON.parse(savedRaw).version, 1);
    assert.equal(JSON.parse(savedRaw).sections.length, 1);
    assert.equal(JSON.parse(savedRaw).ctaLabel, ''); assert.equal(JSON.parse(savedRaw).ctaTarget, '');
    await reloadPage(); await wait(bodyIncludes('Edit website page'));
    assert.equal(await getRaw(), savedRaw);
    await click('Edit website page'); await wait(bodyIncludes('Edit website page draft'));
    assert.equal(await evaluate("document.querySelectorAll('.website-page-draft form fieldset').length"), 1);
    await fill('Page title', 'Unsaved owner edit');
    await click('Preview unsaved website page'); await wait(bodyIncludes('Unsaved owner preview'));
    await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
    assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), 'Unsaved owner edit');
    assert.equal(await getRaw(), savedRaw);
    await click('Cancel website page changes'); await wait(bodyIncludes('Edit website page'));
    assert.equal(await getRaw(), savedRaw);
    await click('Edit website page'); await fill('Page title','Another unsaved edit');
    await click('Reload saved website page'); await wait(bodyIncludes('Discard edits and reload page'));
    assert.equal(await getRaw(), savedRaw);
    await click('Discard edits and reload page'); await wait(bodyIncludes('Saved website page restored from this browser.'));
    assert.equal(await getRaw(), savedRaw);
    await click('Preview saved website page'); await wait(bodyIncludes('Saved owner preview'));
    assert.equal(await evaluate("document.querySelector('.website-page-canvas h2').textContent"), '<script>not executable</script> landing');
    await click('Close website page preview'); await wait("!document.querySelector('.website-page-owner-preview')");
    assert.equal(await evaluate("localStorage.getItem('launchpad.storefront-draft.v1.local-business')"), 'KEEP STOREFRONT');
    assert.equal(await evaluate("localStorage.getItem('launchpad.website-page-draft.v1.other-owner')"), 'KEEP OTHER OWNER');
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`); await reloadPage(); await wait(bodyIncludes('Create website page'));
    await evaluate("document.querySelector('.website-page-draft').scrollIntoView()"); await screenshot(`chooser-${width}`);
    // A saved record arriving after template selection is not overwritten.
    await fill('New page starter','service'); await click('Create website page'); await wait(bodyIncludes('New website page draft'));
    await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(savedRaw)})`);
    await click('Save website page'); await wait(bodyIncludes('Saved page changed in another tab'));
    assert.equal(await getRaw(), savedRaw);
    assert.equal(await evaluate("document.querySelector('.website-page-draft form input').value"), 'Useful work, shaped around you');
    await click('Cancel website page changes'); await click('Reload saved website page'); await wait(bodyIncludes('Saved website page restored'));
    messages.push(`${width}px PASS: blank path; all 3 explicit starters; native select Tab/Enter and heading/field focus; no chooser in open/saved editor; editable safe preview and focus return; cancel/confirmed reload; v1 save/reload; saved bytes and unrelated owner/storefront preservation; stale new-page save rejection; no horizontal overflow. Reorder-specific: native Enter section 2→1, focus and CTA remapping, repeated same-destination live-region text differs, unsaved preview order and explicit v1 save/reload. Removal-specific: 4-section cap; native Tab/Enter middle removal with next-heading focus and later CTA decrement; target removal clears both fields and last-removal previous-heading focus; earlier target preserved; no removal control at one; first-target removal; inert preview, cancel/reload guard, explicit save/reload.`);
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  await writeFile(`${evidenceDir}/browser-results.json`, JSON.stringify({ baseUrl: QA_BASE_URL, checks: messages, runtimeExceptions: exceptions },null,2));
  console.log(messages.join('\n'));
} finally {
  ws.close();
  const closed = await fetch(`${CDP_URL}/json/close/${target.id}`);
  assert.ok(closed.ok, 'Could not close the dedicated QA tab');
}
