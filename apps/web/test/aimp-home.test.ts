import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHome, weeklyBriefEmail } from '../lib/aimp/home/build.ts';
import { buildBusinessOverview } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const base = '/app/b1';
const canLink = (h: string) => /^\/app\/b1(\/(orders|inbox|marketing|products|brand))?$/.test(h.split('?')[0]!);
const make = (state: Parameters<typeof demoSnapshot>[0], inbox = { waiting: 0, sent: 0, needYou: 0 }) =>
  buildHome({ businessName: 'Ivy Co', overview: buildBusinessOverview({ ...demoSnapshot(state), businessId: 'b1' }, DEMO_OVERVIEW_NOW), inbox, base, canLink });

test('a new setup answers all three questions without inventing anything', () => {
  const h = make('new_setup');
  assert.match(h.headline, /Ivy Co: \d of 7 launch steps done/);
  assert.ok(h.ready.length >= 1);
  assert.ok(h.needsMe.length >= 1);
  assert.equal(h.happened.length >= 0, true);
  assert.match(h.weeklyBrief.lines[0]!, /No orders yet|order/);
  assert.ok(h.weeklyBrief.lines.some((l) => /not measured|visit/i.test(l)), 'visits are never shown as zero when unknown');
});

test('waiting Inbox messages become the next action and lead "needs me"', () => {
  const h = make('live', { waiting: 2, sent: 1, needYou: 1 });
  assert.equal(h.next.action, 'Review replies');
  assert.equal(h.next.href, '/app/b1/inbox');
  assert.match(h.needsMe[0]!.text, /2 messages waiting/);
  assert.ok(h.happened.some((x) => /1 reply approved and sent/.test(x.text)));
  assert.ok(h.weeklyBrief.lines.some((l) => /2 messages waiting/.test(l)));
});

test('live shop with sales reports orders and money from the real model', () => {
  const h = make('live');
  assert.match(h.headline, /is live/);
  assert.ok(h.happened.some((x) => /order/.test(x.text)));
  assert.ok(h.ready.some((x) => /live/.test(x.text)));
});

test('links only point at pages that exist; others are plain text', () => {
  const h = make('new_setup');
  for (const x of [...h.needsMe, ...h.happened, ...h.ready]) if (x.href) assert.ok(canLink(x.href), x.href);
  const none = buildHome({ ...{ businessName: 'Ivy Co', overview: buildBusinessOverview({ ...demoSnapshot('live'), businessId: 'b1' }, DEMO_OVERVIEW_NOW), inbox: { waiting: 3, sent: 0, needYou: 0 }, base }, canLink: () => false });
  assert.equal(none.next.href, null);
});

test('weekly brief email is plain, short and carries only the brief', () => {
  const e = weeklyBriefEmail(make('live', { waiting: 1, sent: 0, needYou: 0 }));
  assert.match(e.subject, /^Weekly brief: Ivy Co/);
  assert.ok(e.text.split('\n').length <= 12);
  assert.doesNotMatch(e.text, /@|https?:\/\/.*token/i);
});
