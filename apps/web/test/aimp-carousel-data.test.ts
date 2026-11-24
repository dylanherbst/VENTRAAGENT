// The workspace carousel's numbers come from the real overview view model. These tests check the grouping and counts without a browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCarouselData, GROUP_OF } from '../app/app/[business]/carousel/carousel-data.ts';
import { buildBusinessOverview } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../lib/aimp/overview/demo.ts';
import { buildOverviewViewModel } from '../app/app/[business]/view-model.ts';

const data = (state: 'new_setup' | 'live') => buildCarouselData(buildOverviewViewModel({ overview: buildBusinessOverview({ ...demoSnapshot(state), businessId: 'biz-a' }, DEMO_OVERVIEW_NOW), businessName: 'Test shop' }));

test('every launch step belongs to exactly one group and the counts add up', () => {
  const d = data('new_setup');
  assert.equal(d.count.build.total + d.count.growth.total, d.total);
  assert.equal(d.count.build.done + d.count.growth.done, d.done);
  for (const t of d.tasks) assert.equal(t.group, GROUP_OF[t.id] ?? 'build', t.id);
});

test('the next step is the first step not done, and a finished launch has none', () => {
  const d = data('new_setup');
  const first = d.tasks.find((t) => !t.done);
  assert.equal(d.next?.label, first?.label);
  assert.ok(d.percent >= 0 && d.percent <= 100);
});

test('links use the business id and never point at a different business', () => {
  const d = data('live');
  assert.equal(d.businessId, 'biz-a');
  assert.equal(d.marketingHref, '/app/biz-a/marketing');
  assert.equal(d.ordersHref, '/app/biz-a/orders');
});

// Alignment with the Home page: given the Home view, the carousel and phone Home say the same thing about what to do next.
import { buildHome } from '../lib/aimp/home/build.ts';
const homeFor = (state: 'new_setup' | 'live', waiting: number) => {
  const overview = buildBusinessOverview({ ...demoSnapshot(state), businessId: 'biz-a' }, DEMO_OVERVIEW_NOW);
  const inbox = { waiting, sent: 0, needYou: 0 };
  return { home: buildHome({ businessName: 'Biz', overview, inbox, base: '/app/biz-a', canLink: () => true }), inbox, overview };
};

test('with the Home view, the next step and the step counts match Home exactly', () => {
  for (const state of ['new_setup', 'live'] as const) {
    const { home, inbox, overview } = homeFor(state, 0);
    const vm = buildOverviewViewModel({ overview, businessName: 'Biz' });
    const d = buildCarouselData(vm, { home, inbox });
    assert.equal(d.next?.label, home.next.title);
    assert.equal(d.next?.href, home.next.href);
    assert.equal(d.done, home.checklist.done);
    assert.equal(d.total, home.checklist.total);
  }
});

test('waiting Inbox messages come first in the carousel, as they do on Home', () => {
  const { home, inbox, overview } = homeFor('new_setup', 2);
  const d = buildCarouselData(buildOverviewViewModel({ overview, businessName: 'Biz' }), { home, inbox });
  assert.match(d.next?.label ?? '', /2 messages waiting/);
  assert.equal(d.inboxWaiting, 2);
});
