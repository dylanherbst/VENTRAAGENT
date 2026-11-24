import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginFeatures, pluginBuckets, featuresIn, featuresAt, featureById } from '../lib/aimp/storeops/plugin.ts';
import { routeRequest } from '../lib/aimp/storeops/router.ts';
import { workflows, approvalDefault } from '../lib/aimp/storeops/catalog.ts';

test('every plugin skill is mapped once, in a bucket, with a fallback', () => {
  assert.equal(pluginFeatures.length, 44);
  assert.equal(new Set(pluginFeatures.map((x) => x.id)).size, pluginFeatures.length);
  for (const b of pluginBuckets) assert.ok(featuresIn(b).length > 0, b);
  for (const x of pluginFeatures) assert.ok(x.fallback.length > 0, x.id);
});

test('workflow links point at real catalogue entries', () => {
  const ids = new Set(workflows.map((w) => w.id));
  for (const x of pluginFeatures) if (x.workflow) assert.ok(ids.has(x.workflow), `${x.id} -> ${x.workflow}`);
});

test('the brief\'s exclusions are catalogued but switched off; sending and money always ask the owner', () => {
  const off = featuresAt('outside_brief').map((x) => x.id);
  for (const id of ['payroll-prep', 'plan-payroll', 'hiring-screener', 'job-post-builder', 'inventory-planner', 'restock', 'pay-the-bills', 'ap-processor', 'close-month', 'month-end-prep', 'tax-prep', 'tax-season-organizer']) assert.ok(off.includes(id), id);
  for (const x of pluginFeatures) if (x.action === 'send' || x.action === 'money') assert.equal(approvalDefault(x), 'owner_approval', x.id);
  assert.ok(featuresAt('launch').length >= 10);
});

test('router follows the plugin table: one best match, urgency first', () => {
  assert.equal(routeRequest('A customer is upset about the planner')?.feature.id, 'ticket-deflector');
  assert.equal(routeRequest('where is my download?')?.feature.id, 'ticket-deflector');
  assert.equal(routeRequest('what should we post this week')?.feature.id, 'social-content-engine');
  assert.equal(routeRequest('Marketing Monday please')?.feature.id, 'marketing-monday');
  assert.equal(routeRequest('go through my email')?.feature.id, 'inbox-manager');
  assert.equal(routeRequest('I do this every week, automate it')?.feature.id, 'build-agent');
  assert.equal(routeRequest('make payroll next week?')?.feature.id, 'plan-payroll');
  assert.equal(routeRequest('hello there'), null);
});

test('router tells the truth about availability', () => {
  assert.equal(routeRequest('do my taxes')?.availability, 'switched_off');
  assert.match(routeRequest('do my taxes')?.message ?? '', /switched off/);
  assert.equal(routeRequest('my ads are expensive')?.availability, 'documented');
  assert.equal(routeRequest('write captions')?.availability, 'available_soon');
  assert.equal(routeRequest('reorder stock', { digitalShop: true }), null);
  assert.equal(featureById('restock')?.phase, 'outside_brief');
});
