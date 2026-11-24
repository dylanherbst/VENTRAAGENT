import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPrefsRaw, defaultPrefs, restorePrefs, serializePrefs } from '../lib/notification-prefs.ts';
import { computeNotifications, UNREADABLE } from '../lib/notifications.ts';
import type { NotificationInput } from '../lib/notifications.ts';
import type { Contact } from '../lib/local-crm-contacts.ts';
import type { ContentPost } from '../lib/local-content-calendar.ts';
import type { ServiceInvoiceDraft } from '../lib/local-service-invoice-draft.ts';

const contact = { id: 'c1', name: 'Ann', updatedAt: '2026-11-03T00:00:00.000Z' } as Contact;
const post = (o: Partial<ContentPost>) => ({ id: 'x', platform: 'Instagram', plannedDate: '2026-11-10', title: 'T', body: '', status: 'idea', ...o }) as ContentPost;
const full: NotificationInput = {
  todayIso: '2026-11-04',
  contacts: [contact],
  posts: [post({ id: 'a', plannedDate: '2026-11-01' }), post({ id: 'b', plannedDate: '2026-11-05' })],
  invoice: { draftReference: 'INV-1', dueDate: '2026-11-01' } as ServiceInvoiceDraft,
};
const kinds = (i: NotificationInput) => computeNotifications(i).map(n => n.kind);
const prefs = (off: string[]) => { const p = defaultPrefs('2026-11-04T00:00:00.000Z'); for (const k of off) (p.enabled as Record<string, boolean>)[k] = false; return p; };

test('without prefs or with defaults everything is shown', () => {
  const all = ['invoice-overdue', 'post-overdue', 'post-upcoming', 'recent-contact'];
  assert.deepEqual(kinds(full), all);
  assert.deepEqual(kinds({ ...full, prefs: null }), all);
  assert.deepEqual(kinds({ ...full, prefs: defaultPrefs() }), all);
});
test('each switched-off kind is hidden and the others stay', () => {
  assert.deepEqual(kinds({ ...full, prefs: prefs(['invoice-overdue']) }), ['post-overdue', 'post-upcoming', 'recent-contact']);
  assert.deepEqual(kinds({ ...full, prefs: prefs(['post-overdue']) }), ['invoice-overdue', 'post-upcoming', 'recent-contact']);
  assert.deepEqual(kinds({ ...full, prefs: prefs(['post-upcoming']) }), ['invoice-overdue', 'post-overdue', 'recent-contact']);
  assert.deepEqual(kinds({ ...full, prefs: prefs(['recent-contact']) }), ['invoice-overdue', 'post-overdue', 'post-upcoming']);
  assert.deepEqual(kinds({ ...full, prefs: prefs(['invoice-overdue', 'post-overdue', 'post-upcoming', 'recent-contact']) }), []);
});
test('unreadable notices are kept unless every notice the part feeds is off', () => {
  const bad: NotificationInput = { todayIso: '2026-11-04', contacts: UNREADABLE, posts: UNREADABLE, invoice: UNREADABLE };
  assert.equal(kinds(bad).length, 3);
  assert.equal(kinds({ ...bad, prefs: prefs(['post-overdue']) }).length, 3, 'one post notice still on, so the unreadable calendar is still reported');
  assert.equal(kinds({ ...bad, prefs: prefs(['post-overdue', 'post-upcoming']) }).length, 2);
  assert.equal(kinds({ ...bad, prefs: prefs(['invoice-overdue', 'recent-contact']) }).length, 1);
});
test('prefs round trip and strict validation', () => {
  const p = prefs(['post-upcoming']);
  assert.deepEqual(restorePrefs(serializePrefs(p)), p);
  assert.equal(restorePrefs(null), null);
  checkPrefsRaw(serializePrefs(p));
  for (const bad of ['nope', 'null', '[]', '{}', JSON.stringify({ ...p, version: 2 }), JSON.stringify({ ...p, updatedAt: 'x' }), JSON.stringify({ ...p, enabled: { ...p.enabled, 'post-overdue': 'yes' } }), JSON.stringify({ ...p, enabled: { 'invoice-overdue': true } }), 'x'.repeat(2001)]) {
    assert.throws(() => restorePrefs(bad), `rejects ${bad.slice(0, 30)}`);
    assert.throws(() => checkPrefsRaw(bad));
  }
});
test('unknown extra keys are dropped on restore', () => {
  const p = prefs([]);
  const out = restorePrefs(JSON.stringify({ ...p, extra: 1, enabled: { ...p.enabled, other: true } }))!;
  assert.deepEqual(Object.keys(out.enabled).sort(), ['invoice-overdue', 'post-overdue', 'post-upcoming', 'recent-contact']);
  assert.equal('extra' in out, false);
});
