import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWebsitePage, moveWebsitePageSection, removeWebsitePageSection, persistWebsitePage, projectWebsitePage, restoreWebsitePage, saveWebsitePage, websitePageLimits, websitePageStorageKey } from '../lib/local-website-page.ts';

const input = { title: 'A thoughtful studio', intro: 'Independent ideas.', sections: [{ heading: 'Our approach', body: 'Start with a conversation.' }], ctaLabel: 'Read our approach', ctaTarget: 'section-1' };
const owner = 'local-business';
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }

test('valid page round trips, trims text and does not mutate input', () => {
  assert.equal(restoreWebsitePage(null, owner), null);
  const result = saveWebsitePage({ ...input, title: '  Studio  ' }, owner);
  assert.equal(result.title, 'Studio');
  assert.deepEqual(restoreWebsitePage(JSON.stringify(result), owner), result);
  const projection = projectWebsitePage(result); projection.sections[0].body = 'Changed';
  assert.equal(result.sections[0].body, input.sections[0].body);
  assert.equal(blankWebsitePage().sections.length, 1);
});
test('required fields and exact length/section boundaries are validated', () => {
  for (const field of ['title', 'intro'] as const) {
    assert.throws(() => saveWebsitePage({ ...input, [field]: '   ' }, owner));
    assert.throws(() => saveWebsitePage({ ...input, [field]: 'x'.repeat(websitePageLimits[field] + 1) }, owner));
    assert.doesNotThrow(() => saveWebsitePage({ ...input, [field]: 'x'.repeat(websitePageLimits[field]) }, owner));
  }
  for (const field of ['heading', 'body'] as const) {
    assert.throws(() => saveWebsitePage({ ...input, sections: [{ ...input.sections[0], [field]: ' ' }] }, owner));
    assert.throws(() => saveWebsitePage({ ...input, sections: [{ ...input.sections[0], [field]: 'x'.repeat(websitePageLimits[field] + 1) }] }, owner));
  }
  assert.throws(() => saveWebsitePage({ ...input, sections: [] }, owner));
  assert.throws(() => saveWebsitePage({ ...input, sections: Array(2) }, owner));
  assert.throws(() => saveWebsitePage({ ...input, sections: Array(5).fill(input.sections[0]) }, owner));
  assert.doesNotThrow(() => saveWebsitePage({ ...input, sections: Array(4).fill(input.sections[0]) }, owner));
  for (const bad of [null, [], { ...input, title: 42 }, { ...input, sections: [null] }]) assert.throws(() => saveWebsitePage(bad, owner));
});
test('CTA only accepts an existing same-page section, never arbitrary destinations', () => {
  for (const target of ['javascript:alert(1)', 'https://example.com', '//example.com', '#section-1', 'section-0', 'section-2', 'section-01']) assert.throws(() => saveWebsitePage({ ...input, ctaTarget: target }, owner));
  assert.throws(() => saveWebsitePage({ ...input, ctaLabel: '' }, owner));
  assert.throws(() => saveWebsitePage({ ...input, ctaLabel: 'x'.repeat(61) }, owner));
  assert.doesNotThrow(() => saveWebsitePage({ ...input, ctaLabel: '', ctaTarget: '' }, owner));
});
test('adjacent moves keep button attached to its section through save and restore', () => {
  const sections = [{ heading: 'First', body: 'One' }, { heading: 'Second', body: 'Two' }, { heading: 'Third', body: 'Three' }];
  const original = { ...input, sections, ctaTarget: 'section-2' };
  const moved = moveWebsitePageSection(original, 1, -1);
  assert.deepEqual(moved.sections.map(section => section.heading), ['Second', 'First', 'Third']);
  assert.equal(moved.ctaTarget, 'section-1');
  assert.equal(original.ctaTarget, 'section-2');
  assert.deepEqual(original.sections, sections);
  const again = moveWebsitePageSection(moved, 0, 1);
  assert.deepEqual(again, original);
  const other = moveWebsitePageSection(original, 0, 1);
  assert.equal(other.ctaTarget, 'section-1');
  assert.equal(restoreWebsitePage(JSON.stringify(saveWebsitePage(moved, owner)), owner)?.ctaTarget, 'section-1');
  assert.equal(moveWebsitePageSection(original, 0, -1), original);
  assert.equal(moveWebsitePageSection(original, 2, 1), original);
});
test('early v1 page without optional CTA restores; existing storefront and bio keys remain untouched', () => {
  const store = storage();
  store.setItem('launchpad.storefront-draft.v1.local-business', 'legacy storefront');
  store.setItem('launchpad.link-in-bio-draft.v1.local-business', 'legacy bio');
  const early = { title: input.title, intro: input.intro, sections: input.sections };
  const draft = restoreWebsitePage(JSON.stringify({ ...early, version: 1, profileId: owner }), owner)!;
  assert.equal(draft.ctaLabel, ''); assert.equal(draft.ctaTarget, '');
  persistWebsitePage(store, owner, null, input);
  assert.equal(store.getItem('launchpad.storefront-draft.v1.local-business'), 'legacy storefront');
  assert.equal(store.getItem('launchpad.link-in-bio-draft.v1.local-business'), 'legacy bio');
  assert.notEqual(websitePageStorageKey(owner), websitePageStorageKey('other'));
});
test('preview allowlist excludes owner, private and unknown fields without interpreting text', () => {
  const html = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  const projected = projectWebsitePage({ ...saveWebsitePage(input, owner), title: html, privateNotes: 'SECRET', sections: [{ heading: 'Text', body: html, secret: 'SECRET' }], offers: ['SECRET'] });
  assert.deepEqual(Object.keys(projected).sort(), ['ctaLabel', 'ctaTarget', 'intro', 'sections', 'title']);
  assert.deepEqual(Object.keys(projected.sections[0]).sort(), ['body', 'heading']);
  assert.equal(projected.title, html); assert.equal(projected.sections[0].body, html);
  assert.ok(!JSON.stringify(projected).includes('SECRET'));
});
test('corrupt, future-version, wrong-owner and oversized records fail closed and remain intact', () => {
  const store = storage(); const key = websitePageStorageKey(owner);
  for (const raw of ['{', 'null', '[]', JSON.stringify({ ...saveWebsitePage(input, owner), version: 2 }), JSON.stringify(saveWebsitePage(input, 'other')), 'x'.repeat(40001)]) {
    store.setItem(key, raw);
    assert.throws(() => restoreWebsitePage(raw, owner));
    assert.throws(() => persistWebsitePage(store, owner, raw, input));
    assert.equal(store.getItem(key), raw);
  }
});
test('stale-tab overwrite is rejected; explicit reload allows recovery without touching other keys', () => {
  const store = storage(); const first = persistWebsitePage(store, owner, null, input);
  const second = persistWebsitePage(store, owner, first.raw, { ...input, title: 'Other tab' });
  assert.throws(() => persistWebsitePage(store, owner, first.raw, input), /another tab/);
  assert.equal(store.getItem(websitePageStorageKey(owner)), second.raw);
  assert.equal(restoreWebsitePage(second.raw, owner)!.title, 'Other tab');
  const third = persistWebsitePage(store, owner, second.raw, input);
  assert.equal(third.draft.title, input.title);
});
test('quota/unavailable storage errors propagate without success or losing prior data', () => {
  const previous = JSON.stringify(saveWebsitePage(input, owner));
  const store = { getItem: () => previous, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.throws(() => persistWebsitePage(store, owner, previous, { ...input, title: 'Edited' }), /QuotaExceededError/);
  assert.equal(store.getItem(), previous);
  assert.throws(() => persistWebsitePage({ ...store, getItem: () => { throw new Error('SecurityError'); } }, owner, previous, input), /SecurityError/);
});

test('arbitrary removal preserves section identity and CTA semantics for every position and target', () => {
  const sections = ['A', 'B', 'C', 'D'].map(heading => ({ heading, body: `Body ${heading}` }));
  for (let count = 2; count <= 4; count++) {
    for (let removed = 0; removed < count; removed++) {
      for (let target = 0; target <= count; target++) {
        const original = { ...input, sections: sections.slice(0, count), ctaLabel: target ? 'Read' : '', ctaTarget: target ? `section-${target}` : '' };
        const before = JSON.stringify(original);
        const result = removeWebsitePageSection(original, removed);
        assert.deepEqual(result.sections, original.sections.filter((_, index) => index !== removed));
        assert.equal(result.ctaLabel, target === removed + 1 ? '' : original.ctaLabel);
        assert.equal(result.ctaTarget, target === removed + 1 ? '' : target > removed + 1 ? `section-${target - 1}` : original.ctaTarget);
        if (result.ctaTarget) assert.equal(result.sections[Number(result.ctaTarget.slice(8)) - 1], original.sections[target - 1]);
        assert.equal(JSON.stringify(original), before);
        const store = storage();
        const saved = persistWebsitePage(store, owner, null, result);
        assert.deepEqual(restoreWebsitePage(saved.raw, owner)?.sections, result.sections);
        assert.equal(saved.draft.version, 1);
        assert.equal(saved.draft.ctaTarget, result.ctaTarget);
      }
    }
  }
});
test('removal rejects invalid indices and cannot remove the only section', () => {
  for (const index of [-1, 1, 0.5, NaN, Infinity, 0]) assert.equal(removeWebsitePageSection(input, index), input);
  const two = { ...input, sections: [input.sections[0], input.sections[0]] };
  for (const index of [-1, 2, 0.5, NaN, Infinity]) assert.equal(removeWebsitePageSection(two, index), two);
});
