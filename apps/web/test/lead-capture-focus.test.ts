import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors the post-commit focus gate used in lead-capture-builder and crm-contacts:
 * focus runs only after editor/preview state has unmounted (refs cleared on commit).
 */
function shouldFocusCreateButton(editing: boolean, previewOpen: boolean, requested: boolean): boolean {
  return requested && !editing && !previewOpen;
}

function shouldFocusPreviewButton(editing: boolean, previewOpen: boolean, requested: boolean): boolean {
  return requested && !previewOpen && !editing;
}

test('lead capture defers create-button focus until editor and preview are closed', () => {
  assert.equal(shouldFocusCreateButton(true, false, true), false);
  assert.equal(shouldFocusCreateButton(false, true, true), false);
  assert.equal(shouldFocusCreateButton(false, false, true), true);
  assert.equal(shouldFocusCreateButton(false, false, false), false);
});

test('lead capture defers preview-button focus until preview closes', () => {
  assert.equal(shouldFocusPreviewButton(false, true, true), false);
  assert.equal(shouldFocusPreviewButton(true, false, true), false);
  assert.equal(shouldFocusPreviewButton(false, false, true), true);
});
