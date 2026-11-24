import assert from 'node:assert/strict';
import test from 'node:test';
import { computeOverview, describeOverview, UNREADABLE, upcomingPosts } from '../lib/business-overview.ts';
import type { OverviewInput } from '../lib/business-overview.ts';
import type { Contact } from '../lib/local-crm-contacts.ts';
import type { Deal } from '../lib/local-crm-pipeline.ts';
import type { ContentPost } from '../lib/local-content-calendar.ts';
import { blankRuleset } from '../lib/local-lead-scoring.ts';

const empty: OverviewInput = { profileId: 'p', todayIso: '2026-11-03', offers: null, contacts: null, deals: null, ruleset: null, leadForm: null, campaigns: null, posts: null, funnels: null, booking: null, students: null };
const contact = (o: Partial<Contact> = {}): Contact => ({ version: 1, id: 'c1', profileId: 'p', name: 'Ann', email: '', phone: '', source: 'manual', consentStatus: 'unknown', notes: '', updatedAt: '2026-05-10T00:00:00.000Z', ...o } as Contact);
const deal = (o: Partial<Deal> = {}): Deal => ({ version: 1, id: 'd1', profileId: 'p', contactId: 'c1', title: 't', stage: 'new', valueMinor: 1000, currency: 'AUD', updatedAt: '2026-05-10T00:00:00.000Z', ...o });
const post = (o: Partial<ContentPost>): ContentPost => ({ id: 'x', platform: 'Instagram', plannedDate: '2026-11-10', title: 'T', body: '', status: 'idea', ...o });

test('all-empty input gives zeros, no invented values, and a full checklist', () => {
  const o = computeOverview(empty);
  assert.deepEqual(o.offers, { status: 'ok', value: 0 });
  assert.deepEqual(o.contacts, { status: 'ok', value: 0 });
  assert.equal(o.setupChecklist.length, 9);
  assert.ok(o.setupChecklist.every(i => i.state === 'empty'));
  assert.deepEqual(o.contactFunnel, { status: 'ok', value: { contacts: 0, withDeal: 0, wonDeals: 0, dealRatio: null, wonRatio: null } });
  assert.deepEqual(o.leadForm, { status: 'ok', value: false });
  assert.deepEqual(o.booking, { status: 'ok', value: { configured: false, appointmentTypes: 0 } });
  assert.ok(describeOverview(o).includes('No deals are saved yet.'));
});

test('all parts present are counted', () => {
  const o = computeOverview({
    ...empty,
    offers: [{} as never, {} as never],
    contacts: [contact({ id: 'c1', consentStatus: 'opted_in' }), contact({ id: 'c2' })],
    deals: [deal({ id: 'd1', contactId: 'c1', stage: 'won' }), deal({ id: 'd2', contactId: 'c1' }), deal({ id: 'd3', contactId: 'zz' })],
    leadForm: {} as never,
    campaigns: [{ status: 'draft' } as never, { status: 'ready' } as never, { status: 'ready' } as never],
    posts: [post({ id: 'a', status: 'ready' }), post({ id: 'b', status: 'posted-manually' })],
    funnels: [{} as never],
    booking: { appointmentTypes: [{}, {}] } as never,
    students: { students: [{}, {}, {}] } as never,
  });
  assert.deepEqual(o.offers, { status: 'ok', value: 2 });
  assert.equal(o.deals.status === 'ok' && o.deals.value.won, 1);
  assert.equal(o.deals.status === 'ok' && o.deals.value.byStage.new, 2);
  assert.deepEqual(o.campaigns, { status: 'ok', value: { total: 3, byStatus: { draft: 1, ready: 2, archived: 0 } } });
  assert.deepEqual(o.booking, { status: 'ok', value: { configured: true, appointmentTypes: 2 } });
  assert.deepEqual(o.students, { status: 'ok', value: 3 });
  assert.deepEqual(o.leadForm, { status: 'ok', value: true });
  assert.deepEqual(o.contactFunnel, { status: 'ok', value: { contacts: 2, withDeal: 1, wonDeals: 1, dealRatio: 0.5, wonRatio: 1 } });
  assert.equal(o.setupChecklist.length, 0);
});

test('an unreadable part is explicit, does not crash, and is not zero', () => {
  const o = computeOverview({ ...empty, contacts: UNREADABLE, funnels: UNREADABLE, ruleset: UNREADABLE, deals: [deal()] });
  assert.deepEqual(o.contacts, { status: 'unreadable' });
  assert.deepEqual(o.funnels, { status: 'unreadable' });
  assert.deepEqual(o.contactFunnel, { status: 'unreadable' });
  assert.deepEqual(o.leadMix, { status: 'unreadable' });
  assert.deepEqual(o.consentGaps, { status: 'unreadable' });
  assert.equal(o.deals.status, 'ok');
  const item = o.setupChecklist.find(i => i.id === 'funnels');
  assert.equal(item?.state, 'unreadable');
  assert.match(item?.text ?? '', /could not be read/);
  assert.ok(describeOverview(o).some(s => /contacts could not be read/.test(s)));
});

test('money stays separate per currency', () => {
  const o = computeOverview({ ...empty, deals: [deal({ stage: 'won', valueMinor: 500, currency: 'AUD' }), deal({ id: 'd2', stage: 'won', valueMinor: 700, currency: 'USD' }), deal({ id: 'd3', valueMinor: 300, currency: 'AUD' })] });
  assert.equal(o.deals.status, 'ok');
  if (o.deals.status === 'ok') {
    assert.deepEqual(o.deals.value.wonValue, { AUD: 500, USD: 700 });
    assert.deepEqual(o.deals.value.openValue, { AUD: 300 });
  }
});

test('ratios are omitted when the denominator is 0', () => {
  const noDeals = computeOverview({ ...empty, contacts: [contact()], deals: [] });
  assert.deepEqual(noDeals.contactFunnel, { status: 'ok', value: { contacts: 1, withDeal: 0, wonDeals: 0, dealRatio: 0, wonRatio: null } });
  const none = computeOverview(empty);
  assert.equal(none.contactFunnel.status === 'ok' && none.contactFunnel.value.dealRatio, null);
});

test('upcoming posts: past excluded, posted excluded, ordered, capped at 3', () => {
  const posts = [
    post({ id: 'p1', plannedDate: '2026-11-02' }),
    post({ id: 'p2', plannedDate: '2026-11-20', title: 'B' }),
    post({ id: 'p3', plannedDate: '2026-11-03', title: 'A' }),
    post({ id: 'p4', plannedDate: '2026-11-05', status: 'posted-manually' }),
    post({ id: 'p5', plannedDate: '2026-12-01' }),
    post({ id: 'p6', plannedDate: '2026-11-04' }),
  ];
  assert.deepEqual(upcomingPosts(posts, '2026-11-03T10:00:00.000Z').map(p => p.id), ['p3', 'p6', 'p2']);
  assert.deepEqual(upcomingPosts(posts, '2027-01-01'), []);
  const o = computeOverview({ ...empty, posts });
  assert.equal(o.content.status === 'ok' && o.content.value.upcoming.length, 3);
});

test('consent gaps list every contact that is not opted in', () => {
  const o = computeOverview({ ...empty, contacts: [contact({ id: 'a', consentStatus: 'opted_in' }), contact({ id: 'b', consentStatus: 'pending' }), contact({ id: 'c', consentStatus: 'opted_out' }), contact({ id: 'd', consentStatus: 'unknown' })] });
  assert.equal(o.consentGaps.status === 'ok' && o.consentGaps.value.count, 3);
  assert.deepEqual(o.consentGaps.status === 'ok' && o.consentGaps.value.contacts.map(c => c.id), ['b', 'c', 'd']);
});

test('lead-score mix counts hot, warm and cold with default or saved rules', () => {
  const hot = contact({ id: 'h', consentStatus: 'opted_in', source: 'referral', email: 'a@b.co', phone: '0400000000' });
  const cold = contact({ id: 'k' });
  const def = computeOverview({ ...empty, contacts: [hot, cold] });
  assert.deepEqual(def.leadMix, { status: 'ok', value: { hot: 1, warm: 0, cold: 1, rules: 'default' } });
  const saved = computeOverview({ ...empty, contacts: [hot, cold], ruleset: blankRuleset('p') });
  assert.equal(saved.leadMix.status === 'ok' && saved.leadMix.value.rules, 'saved');
});

test('checklist wording is plain English with links', () => {
  const o = computeOverview({ ...empty, offers: [{} as never] });
  assert.ok(!o.setupChecklist.some(i => i.id === 'offers'));
  const c = o.setupChecklist.find(i => i.id === 'contacts');
  assert.equal(c?.text, 'You have not saved any contacts yet.');
  assert.equal(c?.href, '/customers?tab=contacts');
});
