export const MAX_JSON_BODY_BYTES = 256_000;

export class RequestBodyTooLarge extends Error {
  constructor() {
    super('Request is too large.');
    this.name = 'RequestBodyTooLarge';
  }
}

/** Read at most maxBytes from a request stream, counting encoded bytes. */
export async function readBoundedRequestBody(req: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared) {
    const length = Number(declared);
    if (Number.isSafeInteger(length) && length > maxBytes) throw new RequestBodyTooLarge();
  }
  if (!req.body) return '';

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('request body exceeds byte limit');
        throw new RequestBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
