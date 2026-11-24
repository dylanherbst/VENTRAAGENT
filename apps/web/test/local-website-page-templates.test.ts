import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsitePageStarter, websitePageStarters } from '../lib/local-website-page-templates.ts';
import { blankWebsitePage, persistWebsitePage, projectWebsitePage, restoreWebsitePage, websitePageStorageKey } from '../lib/local-website-page.ts';

test('three original starters validate, project safely and round trip with unchanged v1 schema', () => {
  assert.equal(websitePageStarters.length, 4);
  for (const choice of websitePageStarters.filter(choice => choice.id !== 'blank')) {
    const input = createWebsitePageStarter(choice.id);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const { raw, draft } = persistWebsitePage(storage, 'owner', null, input);
    assert.deepEqual(projectWebsitePage(input), input);
    assert.deepEqual(restoreWebsitePage(raw, 'owner'), draft);
    assert.deepEqual(Object.keys(draft).sort(), ['version', 'profileId', 'title', 'intro', 'sections', 'ctaLabel', 'ctaTarget'].sort());
    assert.equal(input.ctaTarget, 'section-2');
    assert.ok(input.sections.length >= 2 && input.sections.length <= 4);
    assert.doesNotMatch(JSON.stringify(input), /https?:|<\/?(?:script|img)|javascript:/i);
  }
});
test('blank remains blank and every starter has independently editable section objects', () => {
  assert.deepEqual(createWebsitePageStarter('blank'), blankWebsitePage());
  for (const { id } of websitePageStarters) {
    const first = createWebsitePageStarter(id);
    const before = createWebsitePageStarter(id);
    first.sections[0].body = 'Owner edit';
    first.title = 'Owner title';
    assert.deepEqual(createWebsitePageStarter(id), before);
  }
});
test('creating a starter has no storage side effects and stale creation cannot replace saved or unrelated drafts', () => {
  const data = new Map([['unrelated-draft', 'keep exactly']]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const first = persistWebsitePage(storage, 'owner', null, createWebsitePageStarter('creator'));
  const snapshot = [...data.entries()];
  const starter = createWebsitePageStarter('service');
  assert.deepEqual([...data.entries()], snapshot);
  assert.throws(() => persistWebsitePage(storage, 'owner', null, starter), /another tab/);
  assert.equal(storage.getItem(websitePageStorageKey('owner')), first.raw);
  assert.equal(storage.getItem('unrelated-draft'), 'keep exactly');
  assert.throws(() => createWebsitePageStarter('unknown' as 'blank'), /available/);
});
