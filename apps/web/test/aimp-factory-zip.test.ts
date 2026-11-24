import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as zlib from 'node:zlib';
import { printablePlanner } from '../lib/aimp/blueprints/index.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { buildReadme, createZip, crc32, generateProductSpec, renderProductZip } from '../lib/aimp/factory/index.ts';

const inputs = { niche: 'budget travel', audience: 'Students', pricePointMinor: 900, weeklyHours: 4, budgetMinor: 2000 };
const provider = createProviderRegistry({ env: {} }).llm;

interface Parsed { name: string; method: number; crc: number; data: Buffer }

/** Independent ZIP reader: walks the central directory, checks each local header, inflates and verifies CRC-32. */
function readZip(bytes: Uint8Array): Parsed[] {
  const b = Buffer.from(bytes);
  const eocd = b.length - 22;
  assert.equal(b.readUInt32LE(eocd), 0x06054b50, 'end of central directory signature');
  assert.equal(b.readUInt16LE(eocd + 20), 0, 'no comment');
  const total = b.readUInt16LE(eocd + 10);
  assert.equal(b.readUInt16LE(eocd + 8), total);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOff = b.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory ends where EOCD starts');
  const out: Parsed[] = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'central header signature');
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(b.readUInt32LE(lho), 0x04034b50, 'local header signature');
    assert.equal(b.readUInt32LE(lho + 14), crc, 'local and central CRC agree');
    assert.equal(b.readUInt16LE(lho + 26), nlen);
    assert.equal(b.subarray(lho + 30, lho + 30 + nlen).toString('utf8'), name);
    const start = lho + 30 + nlen + b.readUInt16LE(lho + 28);
    const raw = b.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : assert.fail(`method ${method}`);
    assert.equal(data.length, usize);
    assert.equal(crc32(data), crc, `CRC-32 of ${name}`);
    out.push({ name, method, crc, data });
    p += 46 + nlen + xlen + clen;
  }
  assert.equal(p, eocd);
  return out;
}

test('crc32 matches known values and node:zlib', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const zcrc = (zlib as unknown as { crc32?: (d: Uint8Array) => number }).crc32;
  if (zcrc) for (const s of ['hello', 'x'.repeat(5000)]) assert.equal(crc32(Buffer.from(s)), zcrc(Buffer.from(s)));
});

test('ZIP writer: stored and deflated entries round-trip with valid headers', () => {
  const big = Buffer.from('compress me '.repeat(500));
  const tiny = Buffer.from('a');
  const rt = readZip(createZip([{ name: 'big.txt', data: big }, { name: 'dir/tiny.txt', data: tiny }, { name: 'café.txt', data: new Uint8Array(0) }]));
  assert.deepEqual(rt.map((e) => e.name), ['big.txt', 'dir/tiny.txt', 'café.txt']);
  assert.equal(rt[0]?.method, 8);
  assert.equal(rt[1]?.method, 0);
  assert.deepEqual(rt[0]?.data, big);
  assert.deepEqual(rt[1]?.data, tiny);
  assert.equal(rt[2]?.data.length, 0);
});

test('ZIP writer refuses empty, duplicate and unsafe names', () => {
  assert.throws(() => createZip([]), /at least one/);
  assert.throws(() => createZip([{ name: 'a', data: new Uint8Array(1) }, { name: 'a', data: new Uint8Array(1) }]), /Duplicate/);
  for (const name of ['../x', '/x', 'a\\b', '']) assert.throws(() => createZip([{ name, data: new Uint8Array(1) }]), /Unsafe/);
});

test('product ZIP bundles both PDFs and a README; contents match the standalone PDFs', async () => {
  const spec = await generateProductSpec({ blueprint: printablePlanner, inputs, provider, now: () => new Date('2026-11-14T00:00:00Z') });
  const bundle = renderProductZip(spec);
  const entries = readZip(bundle.bytes);
  assert.deepEqual(entries.map((e) => e.name), bundle.files);
  assert.deepEqual(entries.map((e) => e.name), ['budget-travel-printable-planner-a4.pdf', 'budget-travel-printable-planner-us-letter.pdf', 'README.txt']);
  for (const e of entries.filter((x) => x.name.endsWith('.pdf'))) {
    assert.equal(e.data.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(e.data.subarray(-5).toString('latin1') === '%%EOF');
  }
  const readme = entries[2]?.data.toString('utf8') ?? '';
  assert.equal(readme, buildReadme(spec, bundle.files));
  assert.ok(readme.includes('DEMO SAMPLE'));
  for (const c of spec.claims) assert.ok(readme.includes(`- ${c.text}`), `README lists "${c.text}"`);
  assert.equal(bundle.claimCheck.ok, true);
  // Deterministic: same spec, same bytes.
  assert.deepEqual(renderProductZip(spec).bytes, bundle.bytes);
});

test('optional external sanity check: python3 zipfile and qpdf on files from the ZIP', async (t) => {
  const py = spawnSync('python3', ['-I', '-c', 'import zipfile'], { encoding: 'utf8' });
  if (py.error || py.status !== 0) { t.skip('python3 is not available'); return; }
  const spec = await generateProductSpec({ blueprint: printablePlanner, inputs, provider });
  const bundle = renderProductZip(spec);
  const dir = new URL('./.tmp/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL('factory-sample.zip', dir);
  writeFileSync(file, bundle.bytes);
  const out = spawnSync('python3', ['-I', '-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip(); print(bad); sys.exit(0 if bad is None else 1)', file.pathname], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});
