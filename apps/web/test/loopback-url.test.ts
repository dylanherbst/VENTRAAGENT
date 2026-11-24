import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoopbackHttpUrl, isLoopbackHostname } from '../lib/loopback-url.ts';

test('loopback hostnames are accepted and remote hosts are refused', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.equal(isLoopbackHostname('example.com'), false);
  assert.equal(isLoopbackHostname('0.0.0.0'), false);
});

test('assertLoopbackHttpUrl accepts isolated local http backends only', () => {
  assert.equal(assertLoopbackHttpUrl('http://127.0.0.1:54321', 'TEST_SUPABASE_URL').origin, 'http://127.0.0.1:54321');
  assert.equal(assertLoopbackHttpUrl('http://localhost:3100/', 'TEST_APP_ORIGIN').hostname, 'localhost');
  assert.throws(() => assertLoopbackHttpUrl('https://xyz.supabase.co', 'TEST_SUPABASE_URL'), /loopback/);
  assert.throws(() => assertLoopbackHttpUrl('ftp://127.0.0.1/db', 'TEST_SUPABASE_URL'), /http or https/);
  assert.throws(() => assertLoopbackHttpUrl('not-a-url', 'TEST_SUPABASE_URL'), /valid absolute URL/);
});
