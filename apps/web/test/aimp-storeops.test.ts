import test from 'node:test';
import assert from 'node:assert/strict';
import { workflows, workflowsIn, teamSummary, approvalDefault, departments } from '../lib/aimp/storeops/catalog.ts';
import { lookupOrder, draftReply, opsLogEntry } from '../lib/aimp/storeops/order-status.ts';
import type { OrderFacts } from '../lib/aimp/storeops/order-status.ts';

const base: OrderFacts = { orderId: 'o1', buyerEmail: 'Sam@Example.com', title: 'Weekly Planner', payment: 'paid', delivery: 'delivered', deliveredAt: '2026-11-15T01:00:00Z' };

test('catalogue: ids are unique, every department has a workflow, money and send always wait for the owner', () => {
  assert.equal(new Set(workflows.map((w) => w.id)).size, workflows.length);
  for (const d of departments) assert.ok(workflowsIn(d).length > 0, d);
  for (const w of workflows) if (w.action === 'send' || w.action === 'money') assert.equal(approvalDefault(w), 'owner_approval', w.id);
  assert.equal(approvalDefault({ action: 'read' }), 'automatic');
  assert.ok(workflows.find((w) => w.id === 'refund-processor' && w.action === 'money'));
});

test('digital shops leave out physical-only workflows', () => {
  const all = teamSummary().reduce((n, s) => n + s.total, 0);
  const digital = teamSummary({ digitalOnly: true }).reduce((n, s) => n + s.total, 0);
  assert.ok(digital < all);
  assert.ok(!workflowsIn('stock', { digitalOnly: true }).length);
});

test('lookup needs the matching email and never leaks another buyer', () => {
  const other: OrderFacts = { ...base, orderId: 'o2', buyerEmail: 'x@y.com' };
  assert.deepEqual(lookupOrder([base, other], { fromEmail: ' sam@example.com ' }), { found: true, order: base });
  assert.deepEqual(lookupOrder([base, other], { fromEmail: 'sam@example.com', orderRef: 'o2' }), { found: false, reason: 'none' });
  assert.deepEqual(lookupOrder([other], { fromEmail: 'sam@example.com', orderRef: 'o2' }), { found: false, reason: 'not_verified' });
  assert.deepEqual(lookupOrder([base, { ...base, orderId: 'o3' }], { fromEmail: 'sam@example.com' }), { found: false, reason: 'ambiguous' });
});

test('digital delivered order: reply offers a resend and waits for approval', () => {
  const r = lookupOrder([base], { fromEmail: 'sam@example.com' });
  const d = draftReply(r, 'Ivy Co');
  assert.equal(d.kind, 'delivered');
  assert.equal(d.suggestedAction, 'resend_download');
  assert.match(d.body, /2026-11-15/);
  assert.doesNotMatch(d.body, /https?:/);
  const log = opsLogEntry(r, d);
  assert.equal(log.status, 'waiting_for_you');
  assert.equal(log.orderId, 'o1');
});

test('split parcels list each one; missing links are called out', () => {
  const o: OrderFacts = { ...base, parcels: [{ carrier: 'AusPost', trackingUrl: 'https://t/1', state: 'delivered' }, { carrier: 'AusPost', trackingUrl: null, state: 'in_transit' }] };
  const d = draftReply({ found: true, order: o });
  assert.equal(d.kind, 'tracking');
  assert.match(d.body, /Parcel 1[^\n]*delivered[^\n]*https:\/\/t\/1/);
  assert.match(d.body, /Parcel 2[^\n]*tracking link not available/);
  assert.equal(d.handToOwner, false);
  assert.equal(draftReply({ found: true, order: { ...o, parcels: [{ carrier: 'X', trackingUrl: null, state: 'in_transit' }] } }).handToOwner, true);
});

test('unpaid, refunded, stuck and unknown cases never promise more than they know', () => {
  assert.equal(draftReply({ found: true, order: { ...base, payment: 'pending' } }).kind, 'payment_pending');
  assert.equal(draftReply({ found: true, order: { ...base, payment: 'failed' } }).handToOwner, true);
  assert.match(draftReply({ found: true, order: { ...base, payment: 'refunded' } }).body, /no longer available/);
  const stuck = draftReply({ found: true, order: { ...base, delivery: 'needs_review' } });
  assert.equal(stuck.handToOwner, true);
  assert.match(opsLogEntry({ found: true, order: base }, stuck).result, /^Needs you/);
  const none = draftReply({ found: false, reason: 'none' });
  assert.equal(none.kind, 'ask_for_details');
  assert.doesNotMatch(none.body, /Weekly/);
});
