import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError, apiErrorCodes, apiErrorStatus, isJsonContentType, isPlainObject, isSameOriginJson, safeInteger } from '../lib/api-errors.ts';

test('every code has a status and apiError builds a stable body', () => {
  for (const c of apiErrorCodes) assert.ok(apiErrorStatus[c] >= 400);
  const e = apiError('rate_limited', 'Slow down.', { signedIn: true });
  assert.deepEqual(e, { status: 429, body: { signedIn: true, error: 'Slow down.', code: 'rate_limited' } });
  assert.equal(apiError('session_revoked', 'x').status, 401);
  assert.equal(apiError('no_workspace_access', 'x').status, 403);
  assert.equal(apiError('too_large', 'x').status, 413);
});
test('extra fields can not override the code or message', () => {
  const e = apiError('conflict', 'real', { error: 'fake', code: 'signed_out' });
  assert.equal(e.body.error, 'real'); assert.equal(e.body.code, 'conflict');
});
test('content type must be JSON, with optional parameters', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON; charset=utf-8'), true);
  for (const bad of [null, '', 'text/plain', 'application/jsonx', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=a']) assert.equal(isJsonContentType(bad), false);
});
test('same-origin JSON needs both a matching origin and a JSON body type', () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  const ok = (origin: string | null) => origin === 'http://localhost:3000';
  assert.equal(isSameOriginJson(h({ origin: 'http://localhost:3000', 'content-type': 'application/json' }), ok), true);
  assert.equal(isSameOriginJson(h({ origin: 'http://evil.test', 'content-type': 'application/json' }), ok), false);
  assert.equal(isSameOriginJson(h({ origin: 'http://localhost:3000', 'content-type': 'text/plain' }), ok), false);
  assert.equal(isSameOriginJson(h({ 'content-type': 'application/json' }), ok), false);
});
test('plain object and integer checks', () => {
  assert.equal(isPlainObject({}), true);
  for (const v of [null, [], 'x', 1, undefined]) assert.equal(isPlainObject(v), false);
  assert.equal(safeInteger(0), 0); assert.equal(safeInteger(5), 5);
  for (const v of [-1, 1.5, '1', NaN, Infinity, 2 ** 60, null]) assert.equal(safeInteger(v), null);
  assert.equal(safeInteger(0, 1), null);
});
