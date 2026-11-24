import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { blankProfile } from '../lib/onboarding.ts';

const QA_BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3418').replace(/\/$/, '');
const CDP_PORT = Number(process.env.EDUCATION_QA_CDP_PORT || '9340');
const evidenceDir = process.env.EDUCATION_QA_EVIDENCE_DIR || '/tmp/launchpad-education-fix-20261016';
await mkdir(evidenceDir, { recursive: true });

const target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(t => t.type === 'page');
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
const courseRoot = "document.querySelector('.education-course')";
const click = async (label, rootExpr = 'document') => {
  await evaluate(`(() => {const root = ${rootExpr}; const el = [...root.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!el || el.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)}); el.click();})()`);
};
const fill = async (label, value, rootExpr = 'document') => {
  await evaluate(`(() => {const root = ${rootExpr}; const label = [...root.querySelectorAll('label')].find(x => x.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const el = label?.querySelector('input,textarea,select'); if (!el) throw new Error('Field unavailable: '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));})()`);
};
const bodyIncludes = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
const activeText = () => evaluate('document.activeElement?.textContent?.trim() || document.activeElement?.id || document.activeElement?.tagName');
const progressKey = 'launchpad.education-preview-progress.v1.local-business';
const courseKey = 'launchpad.education-course-draft.v1.local-business';

async function seedCourse() {
  await click('Create course outline');
  await wait(`!!${courseRoot}?.querySelector('h3')`);
  await fill('Course title', 'Review text course', courseRoot);
  await fill('Course summary', 'Frontend preview verification', courseRoot);
  for (let i = 0; i < 2; i++) {
    await click('Add lesson', courseRoot);
    await fill('Lesson title', i ? 'Second lesson' : 'First lesson', courseRoot);
    if (!i) await fill('Lesson text', 'Useful first lesson text.', courseRoot);
    await fill('Duration (optional minutes)', i ? '' : '12', courseRoot);
  }
  await click('Save local course draft');
  await wait(bodyIncludes('Review text course'));
}

async function runWidth(width) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 720 });
  const profile = {
    ...blankProfile(),
    name: 'Review school',
    primary: 'education',
    pathways: ['education'],
    audience: 'Creators',
    goal: 'Teach',
    expertise: 'Design',
    educationOffer: 'Course',
    businessType: 'Physical services',
  };
  await evaluate(`localStorage.setItem('launchpad.business-profile.v1', ${JSON.stringify(JSON.stringify(profile))}); localStorage.removeItem(${JSON.stringify(courseKey)}); localStorage.removeItem(${JSON.stringify(progressKey)});`);
  await cdp('Page.reload');
  await wait(bodyIncludes('Local course outline'));
  await seedCourse();

  await click('Open learner preview');
  await wait("!!document.querySelector('.education-learner-preview')");
  assert.equal(await evaluate("document.activeElement?.id"), 'education-learner-preview-title');
  await click('Close learner preview');
  await wait('!document.querySelector(\'.education-learner-preview\')');
  assert.equal(await activeText(), 'Open learner preview');

  await click('Edit course outline');
  await click('Preview unsaved outline');
  await wait("!!document.querySelector('.education-learner-preview')");
  assert.equal(await evaluate("document.activeElement?.id"), 'education-learner-preview-title');
  await click('Close learner preview');
  await wait('!document.querySelector(\'.education-learner-preview\')');
  assert.equal(await activeText(), 'Preview unsaved outline');

  await fill('Course title', 'Preview stale title', courseRoot);
  await click('Preview unsaved outline');
  await wait(bodyIncludes('Preview stale title'));
  await fill('Course title', 'Actually saved title', courseRoot);
  await click('Save local course draft');
  await wait(bodyIncludes('Actually saved title'));
  assert.equal(await evaluate("!document.querySelector('.education-learner-preview')"), true);

  await click('Open learner preview');
  await wait("!!document.querySelector('.education-learner-preview input[type=checkbox]')");
  await evaluate("document.querySelector('.education-learner-preview input[type=checkbox]').click()");
  await click('Close learner preview');
  await click('Edit course outline');
  await evaluate(`(() => {const rows=[...document.querySelectorAll('.education-lesson-row')]; const btn=[...rows[0].querySelectorAll('button')].find(b=>b.textContent.trim()==='Remove lesson'); btn.click();})()`);
  await click('Save local course draft');
  await wait(bodyIncludes('Actually saved title'));
  const prunedStored = JSON.parse(await evaluate(`localStorage.getItem(${JSON.stringify(progressKey)})`));
  assert.equal(prunedStored.completedLessonIds.length, 0);

  await evaluate(`localStorage.setItem(${JSON.stringify(progressKey)}, '{')`);
  await cdp('Page.reload');
  await wait(bodyIncludes('unreadable'));
  await click('Open learner preview');
  await wait(bodyIncludes('Reset preview progress'));
  const corruptCourse = await evaluate(`localStorage.getItem(${JSON.stringify(courseKey)})`);
  const repaired = JSON.stringify({
    version: 1,
    profileId: 'local-business',
    courseId: JSON.parse(corruptCourse).id,
    completedLessonIds: ['repaired-lesson'],
    activeLessonId: null,
    updatedAt: '2026-10-16T12:00:00.000Z',
  });
  await evaluate(`localStorage.setItem(${JSON.stringify(progressKey)}, ${JSON.stringify(repaired)})`);
  await click('Reset preview progress');
  await wait(bodyIncludes('another tab'));
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(progressKey)})`), repaired);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(courseKey)})`), corruptCourse);
  await click('Close learner preview');

  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${evidenceDir}/education-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: `${QA_BASE_URL}/` });
await wait(`location.href === ${JSON.stringify(QA_BASE_URL + '/')} && document.readyState === 'complete'`);

for (const width of [1440, 390]) await runWidth(width);

assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
console.log(`PASS: education draft journey on ${QA_BASE_URL} — focus, save-close-preview, prune-on-save, corrupt-reset (${evidenceDir}).`);
ws.close();
