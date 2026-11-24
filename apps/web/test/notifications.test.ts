import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNotifications, UNREADABLE } from '../lib/notifications.ts';
import type { NotificationInput } from '../lib/notifications.ts';
import type { Contact } from '../lib/local-crm-contacts.ts';
import type { ContentPost } from '../lib/local-content-calendar.ts';
import type { ServiceInvoiceDraft } from '../lib/local-service-invoice-draft.ts';

const base: NotificationInput = { todayIso: '2026-11-04', contacts: null, posts: null, invoice: null };
const contact = (o: Partial<Contact>) => ({ version: 1, id: 'c1', profileId: 'p', name: 'Ann', email: '', phone: '', source: 'manual', consentStatus: 'unknown', notes: '', updatedAt: '2026-11-03T00:00:00.000Z', ...o }) as Contact;
const post = (o: Partial<ContentPost>): ContentPost => ({ id: 'x', platform: 'Instagram', plannedDate: '2026-11-10', title: 'T', body: '', status: 'idea', ...o });
const invoice = (o: Partial<ServiceInvoiceDraft>) => ({ draftReference: 'INV-1', dueDate: '2026-11-01', ...o }) as ServiceInvoiceDraft;

test('nothing saved gives no notifications', () => {
  assert.deepEqual(computeNotifications(base), []);
  assert.deepEqual(computeNotifications({ ...base, contacts: [], posts: [] }), []);
});
test('overdue invoice, overdue and upcoming posts, recent contacts', () => {
  const n = computeNotifications({
    ...base,
    invoice: invoice({}),
    posts: [post({ id: 'a', plannedDate: '2026-11-01', title: 'Late' }), post({ id: 'b', plannedDate: '2026-11-04', title: 'Now' }), post({ id: 'c', plannedDate: '2026-12-30' }), post({ id: 'd', plannedDate: '2026-10-01', status: 'posted-manually' })],
    contacts: [contact({}), contact({ id: 'c2', updatedAt: '2026-05-10T00:00:00.000Z' })],
  });
  assert.deepEqual(n.map(x => x.kind), ['invoice-overdue', 'post-overdue', 'post-upcoming', 'recent-contact']);
  assert.match(n[0].text, /3 days past/);
  assert.match(n[0].text, /nothing has been sent/);
});
test('invoice due today or later is not overdue', () => {
  assert.equal(computeNotifications({ ...base, invoice: invoice({ dueDate: '2026-11-04' }) }).length, 0);
});
test('unreadable parts give a notice and are not treated as empty', () => {
  const n = computeNotifications({ ...base, contacts: UNREADABLE, posts: UNREADABLE, invoice: UNREADABLE });
  assert.equal(n.length, 3);
  assert.ok(n.every(x => x.kind === 'unreadable'));
});
test('malformed dates are skipped without throwing', () => {
  assert.deepEqual(computeNotifications({ ...base, posts: [post({ plannedDate: 'soon' })], contacts: [contact({ updatedAt: 'bad' })], invoice: invoice({ dueDate: '' }) }), []);
});
