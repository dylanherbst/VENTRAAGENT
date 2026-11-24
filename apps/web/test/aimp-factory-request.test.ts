import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductFactoryError } from '../lib/aimp/factory/generate.ts';
import { buildDownload, downloadResponse, inputsFromQuery } from '../lib/aimp/factory/request.ts';

const BASE = 'http://127.0.0.1/tools/product-factory/download';
const q = (s: string) => new URL(`${BASE}?${s}`).searchParams;
const head = (b: Uint8Array, n: number) => Buffer.from(b).subarray(0, n).toString('latin1');

test('query parsing: defaults, numbers, and invalid values become NaN (rejected later, never guessed)', () => {
  assert.deepEqual(inputsFromQuery(q('')), { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 });
  const v = inputsFromQuery(q('weeklyHours=abc&pricePointMinor=&budgetMinor=12.5&niche=Yoga'));
  assert.equal(v.niche, 'Yoga');
  assert.ok(Number.isNaN(v.weeklyHours));
  assert.ok(Number.isNaN(v.pricePointMinor));
  assert.equal(v.budgetMinor, 12.5);
});

test('buildDownload: size and format fall back to A4 PDF; letter and zip are honoured', async () => {
  const dflt = await buildDownload(q(''), {});
  assert.equal(dflt.fileName, 'wedding-planning-printable-planner-a4.pdf');
  assert.equal(dflt.contentType, 'application/pdf');
  assert.equal(dflt.demo, true);
  assert.equal(head(dflt.bytes, 5), '%PDF-');
  for (const odd of ['size=a3', 'size=', 'size=LETTER', 'format=rar', 'format=', 'format=ZIP&size=zzz']) {
    const r = await buildDownload(q(odd), {});
    assert.equal(r.fileName, 'wedding-planning-printable-planner-a4.pdf', odd);
    assert.equal(r.contentType, 'application/pdf', odd);
  }
  const letter = await buildDownload(q('size=letter'), {});
  assert.equal(letter.fileName, 'wedding-planning-printable-planner-us-letter.pdf');
  assert.notDeepEqual(letter.bytes, dflt.bytes);
  const zip = await buildDownload(q('format=zip&size=letter'), {});
  assert.equal(zip.fileName, 'wedding-planning-printable-planner.zip');
  assert.equal(zip.contentType, 'application/zip');
  assert.equal(head(zip.bytes, 2), 'PK');
  const tracker = await buildDownload(q('blueprint=printable-tracker'), {});
  assert.equal(tracker.fileName, 'wedding-planning-printable-tracker-a4.pdf');
});

test('downloadResponse: 200 with exact download headers and the file body', async () => {
  const res = await downloadResponse(`${BASE}?niche=${encodeURIComponent("Mother's day")}&size=letter`, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="mother-s-day-printable-planner-us-letter.pdf"');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-product-mode'), 'demo');
  assert.equal(head(new Uint8Array(await res.arrayBuffer()), 5), '%PDF-');
  const zip = await downloadResponse(`${BASE}?format=zip`, {});
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(zip.headers.get('content-disposition'), 'attachment; filename="wedding-planning-printable-planner.zip"');
});

test('downloadResponse: invalid input is 422 with plain-English problems and no file', async () => {
  const cases: [string, RegExp][] = [
    ['weeklyHours=abc', /Hours you can give/], ['weeklyHours=', /Hours you can give/], ['weeklyHours=999', /Hours you can give/],
    ['pricePointMinor=1.5', /Price point/], ['budgetMinor=-1', /Launch budget/], ['niche=x', /Niche/], ['audience=', /Who it is for/],
  ];
  for (const [qs, re] of cases) {
    const res = await downloadResponse(`${BASE}?${qs}`, {});
    assert.equal(res.status, 422, qs);
    assert.match(res.headers.get('content-type') ?? '', /json/);
    assert.equal(res.headers.get('content-disposition'), null);
    const body = await res.json() as { error: string; problems: string[] };
    assert.match(body.problems.join(' '), re, qs);
  }
  const unknown = await downloadResponse(`${BASE}?blueprint=nope`, {});
  assert.equal(unknown.status, 422);
  assert.match(((await unknown.json()) as { error: string }).error, /blueprint does not exist/);
  const off = await downloadResponse(BASE, { AIMP_LLM_ENABLED: 'false' });
  assert.equal(off.status, 422);
  assert.match(((await off.json()) as { error: string }).error, /not available/);
});

test('downloadResponse: ProductFactoryError is 422, any other error is 500 without leaking the message', async () => {
  const factory = await downloadResponse(BASE, {}, async () => { throw new ProductFactoryError('Fix this.', ['one']); });
  assert.equal(factory.status, 422);
  assert.deepEqual(await factory.json(), { error: 'Fix this.', problems: ['one'] });
  const boom = await downloadResponse(BASE, {}, async () => { throw new Error('secret internal detail'); });
  assert.equal(boom.status, 500);
  const text = JSON.stringify(await boom.json());
  assert.equal(text, JSON.stringify({ error: 'The product could not be built.' }));
  assert.ok(!text.includes('secret'));
});
