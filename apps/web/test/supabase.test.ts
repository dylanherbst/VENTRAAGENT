import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../lib/supabase/client.ts';

test('missing configuration fails without connecting', () => {
  assert.throws(() => createSupabaseClient({ url: '', publishableKey: '' }), /not configured/);
});

test('client construction does not make a network request', () => {
  let calls = 0;
  const client = createSupabaseClient({
    url: 'https://example.invalid', publishableKey: 'placeholder-not-a-real-key',
    fetch: () => { calls += 1; throw new Error('Network forbidden in scaffold test'); },
  });
  assert.equal(typeof client.from, 'function');
  assert.equal(calls, 0);
});
