import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_JSON_BODY_BYTES, RequestBodyTooLarge, readBoundedRequestBody } from '../lib/request-body.ts';

test('accepts a body exactly at the byte limit', async () => {
  const body = 'a'.repeat(MAX_JSON_BODY_BYTES);
  assert.equal((await readBoundedRequestBody(new Request('http://localhost', { method: 'POST', body }))).length, MAX_JSON_BODY_BYTES);
});

test('rejects one byte over the limit before JSON parsing', async () => {
  await assert.rejects(() => readBoundedRequestBody(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(MAX_JSON_BODY_BYTES + 1) })), RequestBodyTooLarge);
});

test('counts UTF-8 bytes rather than JavaScript string units', async () => {
  const prefix = 'a'.repeat(MAX_JSON_BODY_BYTES - 2);
  const body = prefix + '漢';
  assert.ok(body.length < MAX_JSON_BODY_BYTES);
  await assert.rejects(() => readBoundedRequestBody(new Request('http://localhost', { method: 'POST', body })), RequestBodyTooLarge);
});

test('cancels an oversized chunked stream without reading later chunks', async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array(MAX_JSON_BODY_BYTES + 1));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(() => readBoundedRequestBody(new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' })), RequestBodyTooLarge);
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
});
