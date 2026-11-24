import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appTabs, primaryEntry, setupSteps } from '../lib/aimp/entry.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the primary entry is Find my side hustle and goes to the real /start flow', () => {
  assert.equal(primaryEntry.label, 'Find my side hustle');
  assert.equal(primaryEntry.href, '/start');
});

test('setup steps and bottom tabs match the brief', () => {
  assert.deepEqual(setupSteps.map((s) => s.label), ['Find my side hustle', 'Build it for me', 'Review my launch']);
  assert.deepEqual(appTabs.map((t) => t.label), ['Home', 'My Shop', 'Growth']);
});

test('the website and the /start welcome use the shared entry, and the old calls to action are gone', () => {
  const site = read('app/plant-lab/page.tsx');
  const welcome = read('app/start/page.tsx');
  assert.match(site, /primaryEntry\.label/);
  assert.match(welcome, /primaryEntry\.label/);
  for (const old of ['Build My AI Business', 'Create My Business', 'Activate My Business']) assert.ok(!site.includes(old), old);
});
