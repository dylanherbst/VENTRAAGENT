import test from 'node:test';
import assert from 'node:assert/strict';
import { accountConnection } from '../lib/connection-state.ts';

test('LIVE is reported only for a verified signed-in session', () => {
  assert.equal(accountConnection(200, { signedIn: true, workspaces: [] }).mode, 'LIVE');
  assert.equal(accountConnection(200, {}).mode, 'DEMO');
  assert.equal(accountConnection(200, null).mode, 'DEMO');
});
test('unconfigured, signed-out, failed and unreachable are all DEMO with honest labels', () => {
  assert.match(accountConnection(503, { configured: false }).label, /not connected/i);
  assert.match(accountConnection(401, { signedIn: false }).label, /signed out/i);
  assert.match(accountConnection(500, {}).label, /unavailable/i);
  assert.match(accountConnection(null, null).label, /unknown/i);
  assert.equal(accountConnection(503, { error: 'x' }).mode, 'DEMO');
});
