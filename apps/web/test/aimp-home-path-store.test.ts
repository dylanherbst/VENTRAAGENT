import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoredPath, setStoredPath } from '../lib/aimp/home/path-store.ts';

test('path choice is saved per business and can be changed', () => {
  assert.equal(getStoredPath('biz-x'), null);
  assert.deepEqual(setStoredPath('biz-x', 'new'), { ok: true, path: 'new' });
  assert.equal(getStoredPath('biz-x'), 'new');
  assert.equal(getStoredPath('biz-y'), null);
  setStoredPath('biz-x', 'existing');
  assert.equal(getStoredPath('biz-x'), 'existing');
});

test('anything but the two paths is refused and changes nothing', () => {
  setStoredPath('biz-z', 'new');
  for (const bad of ['', 'both', null, undefined, 3, { path: 'new' }]) assert.equal(setStoredPath('biz-z', bad).ok, false);
  assert.equal(getStoredPath('biz-z'), 'new');
});
