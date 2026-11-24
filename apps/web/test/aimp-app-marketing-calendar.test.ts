// Campaign calendar (screen 27, AMP-131; AMP-050 schedule, AMP-051 export; F03 F04 F05 F06 G02 G05). The loader and `runCalendarExport`
// (the whole body of the page's server action) run here against the REAL campaign and campaign-assets services on their memory stores,
// with the real brand, catalogue and site-version services of the campaign demo fixtures. The campaign is drafted and approved through
// the Marketing page's own `runMarketingOp` and the text is written and reviewed through Creative Studio's own `runCreativeOp`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import {
  MAX_EXPORT_BYTES, MAX_EXPORT_FILES, MAX_EXPORT_ITEMS, NEEDS_FIXES, NO_APPROVED_PLAN, NO_BUSINESS, NO_DRAFTS, NO_STORE, NO_WEB_ADDRESS, NOT_DONE, NOTHING_APPROVED, OLD_PLAN, WENT_WRONG, exported, runCalendarExport, tooLarge,
} from '../app/app/[business]/marketing/calendar/_server/calendar-guard.ts';
import type { CalendarExportReply, CalendarGuardInput } from '../app/app/[business]/marketing/calendar/_server/calendar-guard.ts';
import { loadCalendar } from '../app/app/[business]/marketing/calendar/_server/calendar.ts';
import type { CalendarRuntime } from '../app/app/[business]/marketing/calendar/_server/calendar.ts';
import {
  BY_HAND, ENTRY_STATE_LABELS, NOTHING_POSTED, NOT_IN_DEMO, PUBLISHING_LABEL, PUBLISHING_NOTE, PUBLISHING_TEXT, buildCalendarModel, countsLine, entriesLabel, exportHint, piecesLabel, weekdayLabel,
} from '../app/app/[business]/marketing/calendar/view-model.ts';
import type { CalendarModel } from '../app/app/[business]/marketing/calendar/view-model.ts';
import { runCreativeOp } from '../app/app/[business]/marketing/creative/_server/creative-guard.ts';
import { loadCreative } from '../app/app/[business]/marketing/creative/_server/creative.ts';
import { runMarketingOp } from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import type { MarketingContexts } from '../app/app/[business]/marketing/_server/marketing.ts';
import { getApprovedBrand } from '../lib/aimp/branding/service.ts';
import { createMemoryAssetStore } from '../lib/aimp/campaign-assets/store.ts';
import { buildCampaignDemo } from '../lib/aimp/campaigns/demo.ts';
import { scheduleFor } from '../lib/aimp/campaigns/schedule.ts';
import type { CampaignRecord } from '../lib/aimp/campaigns/types.ts';
import { DEMO_BUSINESS, DEMO_WORKSPACE, demoCtx } from '../lib/aimp/catalogue/demo.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

const A = DEMO_BUSINESS;
const B = 'biz-b';
const ON = { available: true, reason: '' };
const ENV = { AIMP_STORE_ROOT_DOMAIN: 'stores.example.test' };
const actor: Actor = { workspaceId: DEMO_WORKSPACE, userId: 'demo-owner' };
const now = () => new Date(Date.UTC(2026, 10, 15, 9, 30));
const ctx: MarketingContexts = { workspaceId: DEMO_WORKSPACE, ownerId: 'demo-owner', catalogueCtx: (businessId) => ({ ...demoCtx, businessId }), storeEnv: ENV };
const otherWorkspace: MarketingContexts = { ...ctx, workspaceId: 'other-workspace', catalogueCtx: (businessId) => ({ ...demoCtx, workspaceId: 'other-workspace', businessId }) };

type Plan = 'none' | 'draft' | 'approved';
type Ready = Extract<CalendarModel, { state: 'calendar' }>;

/** Minimal ZIP reader: central directory, stored or deflated entries. */
function unzip(base64: string): Map<string, string> {
  const b = Buffer.from(base64, 'base64');
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0);
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const local = b.readUInt32LE(p + 42);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const body = b.subarray(start, start + size);
    out.set(b.subarray(p + 46, p + 46 + nameLen).toString('utf8'), (method === 8 ? inflateRawSync(body) : body).toString('utf8'));
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return out;
}

/** The demo business with a published store, its campaign taken to `plan` through the Marketing page's own action logic. */
async function makeRt(opts: { plan?: Plan; campaigns?: boolean; assets?: boolean; context?: MarketingContexts } = {}) {
  const c = opts.context ?? ctx;
  const demo = await buildCampaignDemo(now, {});
  const brand = await getApprovedBrand({ store: demo.d.brands }, { workspaceId: DEMO_WORKSPACE }, A);
  assert.ok(brand);
  const sites = createSiteVersionStore({ now });
  assert.equal((await sites.createSite(actor, { ...demoStore, slug: brand.slug })).ok, true);
  const d = await sites.getDraft(actor, brand.slug);
  assert.ok(d.ok);
  assert.equal((await sites.publish(actor, brand.slug, { note: '', expectedRevision: d.value.revision })).ok, true);
  const assets = createMemoryAssetStore();
  const rt: CalendarRuntime = {
    businesses: new Set([A]), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>(), slugs: new Map([[A, brand.slug]]),
    brands: demo.d.brands, catalogue: demo.d.catalogue, sites,
    ...(opts.campaigns === false ? {} : { campaigns: demo.campaigns }),
    ...(opts.assets === false ? {} : { campaignAssets: assets }),
  };
  const plan = opts.plan ?? 'approved';
  if (plan !== 'none' && opts.campaigns !== false) await replan(rt, plan, c);
  const record = async (): Promise<CampaignRecord> => (await demo.campaigns.get(DEMO_WORKSPACE, A))!;
  return { rt, demo, assets, record, campaignId: (await demo.campaigns.get(DEMO_WORKSPACE, A))?.id ?? '' };
}
/** A new draft of the campaign (the next version) and, for 'approved', the owner's yes to it. */
async function replan(rt: CalendarRuntime, to: Exclude<Plan, 'none'>, c: MarketingContexts = ctx) {
  const g = { availability: ON, rt: () => rt, ctx: c, now };
  const r = await runMarketingOp(g, A, { kind: 'draft', confirmed: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (to !== 'approved') return;
  const version = (await rt.campaigns!.get(DEMO_WORKSPACE, A))!.version;
  assert.equal((await runMarketingOp(g, A, { kind: 'approve', expectedVersion: version, confirmed: true })).ok, true);
}
const input = (rt: CalendarRuntime, c: MarketingContexts = ctx): CalendarGuardInput => ({ availability: ON, rt: () => rt, ctx: c, now });
const creative = (rt: CalendarRuntime, c: MarketingContexts = ctx) => ({ availability: ON, rt: () => rt, ctx: c, now });
const no = (message: string): CalendarExportReply => ({ ok: false, message, file: null, publishing: 'Not connected' });
const model = async (rt: CalendarRuntime, c: MarketingContexts = ctx, businessId: unknown = A): Promise<CalendarModel> => {
  const r = await loadCalendar(rt, c, businessId, now);
  assert.ok(r.found && r.state === 'ready');
  return r.model;
};
const calendar = async (rt: CalendarRuntime, businessId: string = A): Promise<Ready> => {
  const m = await model(rt, ctx, businessId);
  assert.ok(m.state === 'calendar');
  return m;
};
const entries = (m: Ready) => m.days.flatMap((d) => d.entries);
/** Write the text drafts for `businessId`'s approved plan, through Creative Studio's own action logic. */
async function write(rt: CalendarRuntime, campaignId: string, businessId: string = A) {
  const g = await runCreativeOp(creative(rt), businessId, { kind: 'generate', campaignId });
  assert.equal(g.ok, true, JSON.stringify(g));
}
async function review(rt: CalendarRuntime, campaignId: string, assetId: string, kind: 'approve' | 'reject', businessId: string = A) {
  const q = await loadCreative(rt, ctx, businessId, now);
  assert.ok(q.found && q.state === 'ready' && q.model.state === 'assets');
  const a = q.model.assets.find((x) => x.id === assetId);
  assert.ok(a, assetId);
  const r = await runCreativeOp(creative(rt), businessId, { kind, campaignId, assetId, revision: a.revision, ...(kind === 'reject' ? { reason: 'Not this one' } : {}) });
  assert.equal(r.ok, true, JSON.stringify(r));
}

test('AMP-131 schedule: the days come from scheduleFor, grouped by day, each entry with what it is, its channel and its state in plain words', async () => {
  const { rt, record, campaignId } = await makeRt({ plan: 'draft' });
  const plan = (await record()).plan;
  const expected = scheduleFor(plan.schedule.startDate, plan.schedule.windowDays, plan.items).days.filter((d) => d.itemIds.length > 0);
  assert.ok(expected.length > 0);

  // A draft plan: every entry says the plan is not approved yet, and nothing can be saved.
  const draft = await calendar(rt);
  assert.deepEqual([draft.planStatus, draft.version, draft.drafts, draft.exportable], ['draft', 1, 'plan_draft', 0]);
  assert.deepEqual(draft.days.map((d) => [d.day, d.date, d.entries.map((e) => e.id)]), expected.map((d) => [d.day, d.date, d.itemIds]));
  assert.equal(entries(draft).length, plan.items.length);
  assert.equal(draft.windowDays, plan.schedule.windowDays);
  assert.equal(draft.quietDays, plan.schedule.windowDays - expected.length);
  assert.equal(draft.days[0]!.dateLabel, weekdayLabel(plan.schedule.startDate));
  assert.deepEqual(draft.counts, { plan_draft: plan.items.length, not_written: 0, draft: 0, approved: 0, rejected: 0 });
  for (const e of entries(draft)) {
    const item = plan.items.find((i) => i.id === e.id)!;
    assert.equal(e.productTitle, item.productTitle);
    assert.equal(e.hook, item.hook);
    assert.ok(['Pinterest Pin', 'Caption', 'Short video script'].includes(e.what), e.what);
    assert.ok(['Pinterest', 'Instagram', 'TikTok'].includes(e.channelLabel), e.channelLabel);
    assert.equal(e.stateLabel, 'Draft plan, not approved yet');
  }
  assert.match(exportHint(draft), /still a draft/);

  // Approved, text not written; then written; then one approved and one rejected.
  await replan(rt, 'approved');
  const bare = await calendar(rt);
  assert.deepEqual([bare.planStatus, bare.version, bare.drafts, bare.exportable], ['approved', 2, 'none', 0]);
  assert.ok(entries(bare).every((e) => e.state === 'not_written' && e.stateLabel === 'Text not written yet'));
  await write(rt, campaignId);
  const written = await calendar(rt);
  assert.equal(written.drafts, 'current');
  assert.ok(entries(written).every((e) => e.state === 'draft' && e.stateLabel === 'Draft, needs your review'));
  const pin = entries(written).find((e) => e.what === 'Pinterest Pin')!;
  const caption = entries(written).find((e) => e.what === 'Caption')!;
  await review(rt, campaignId, `${pin.id}:pin`, 'approve');
  await review(rt, campaignId, `${caption.id}:caption`, 'reject');
  const reviewed = await calendar(rt);
  assert.deepEqual([entries(reviewed).find((e) => e.id === pin.id)!.stateLabel, entries(reviewed).find((e) => e.id === caption.id)!.stateLabel], ['Approved by you', 'Rejected by you']);
  assert.deepEqual([reviewed.counts.approved, reviewed.counts.rejected, reviewed.counts.draft, reviewed.exportable], [1, 1, plan.items.length - 2, 1]);
  assert.equal(countsLine(reviewed.counts), `${plan.items.length - 2} to review, 1 approved, 1 rejected.`);
  assert.match(exportHint(reviewed), /^Saves 1 approved piece of text as one ZIP file/);

  // A newer approved plan: the old text no longer counts for any entry, and nothing can be saved until it is written again.
  await replan(rt, 'approved');
  const old = await calendar(rt);
  assert.deepEqual([old.version, old.drafts, old.exportable, old.counts.approved], [3, 'old', 0, 0]);
  assert.ok(entries(old).every((e) => e.state === 'not_written'));
  assert.deepEqual(await runCalendarExport(input(rt), A), no(OLD_PLAN));
});

test('AMP-131 view-model: no plan, a plan with a broken window, labels', async () => {
  assert.deepEqual(buildCalendarModel(undefined, null), { state: 'no_plan' });
  const none = await makeRt({ plan: 'none' });
  assert.deepEqual(await model(none.rt), { state: 'no_plan' });
  const { record } = await makeRt({ plan: 'draft' });
  const rec = await record();
  for (const schedule of [{ ...rec.plan.schedule, startDate: '2026-02-30' }, { ...rec.plan.schedule, windowDays: 0 }, { ...rec.plan.schedule, windowDays: 100000 }]) {
    assert.throws(() => buildCalendarModel({ ...rec, plan: { ...rec.plan, schedule } }, null), /no valid schedule/);
  }
  assert.equal(weekdayLabel('2026-11-17'), 'Tue 17 Nov 2026');
  assert.equal(weekdayLabel('2026-02-30'), '30 Feb 2026');
  assert.equal(weekdayLabel('nonsense'), 'Unknown date');
  assert.equal(entriesLabel(1), '1 entry');
  assert.equal(piecesLabel(2), '2 approved pieces of text');
  assert.equal(countsLine({ plan_draft: 0, not_written: 0, draft: 0, approved: 0, rejected: 0 }), 'Nothing is on the calendar.');
});

test('AMP-131 not available: a runtime with no campaign store or no draft store says so, and nothing is exported', async () => {
  for (const missing of [{ campaigns: false, assets: false }, { assets: false }, { campaigns: false }]) {
    const { rt } = await makeRt(missing);
    assert.deepEqual(await loadCalendar(rt, ctx, A, now), { found: true, state: 'unavailable' });
    assert.deepEqual(await loadCalendar(rt, ctx, 'biz-unknown', now), { found: false });
    assert.deepEqual(await runCalendarExport(input(rt), A), no(NO_STORE));
  }
  assert.match(NOT_IN_DEMO, /not available in the demo yet/);
  assert.match(NO_STORE, /not available in the demo yet/);
});

test('AMP-131 export: only this business\'s approved text leaves, as a ZIP from the campaign-assets export, with publishing not connected', async () => {
  const { rt, campaignId, record } = await makeRt({ plan: 'draft' });
  assert.deepEqual(await runCalendarExport(input(rt), A), no(NO_APPROVED_PLAN));
  await replan(rt, 'approved');
  assert.deepEqual(await runCalendarExport(input(rt), A), no(NO_DRAFTS));
  await write(rt, campaignId);
  assert.deepEqual(await runCalendarExport(input(rt), A), no(NOTHING_APPROVED));

  const pin = entries(await calendar(rt)).find((e) => e.what === 'Pinterest Pin')!;
  await review(rt, campaignId, `${pin.id}:pin`, 'approve');
  const r = await runCalendarExport(input(rt), A);
  assert.ok(r.ok && r.file, JSON.stringify(r.message));
  assert.equal(r.message, exported(1));
  assert.equal(r.publishing, 'Not connected');
  assert.equal(r.file.name, `campaign-assets-${campaignId}-v${(await record()).version}.zip`);
  const files = unzip(r.file.base64);
  assert.deepEqual([...files.keys()].sort(), ['README.txt', 'pin-images.md', 'pins.csv']);
  assert.deepEqual(r.file.files.slice().sort(), [...files.keys()].sort());
  assert.equal(files.get('pins.csv')!.trim().split('\r\n').length, 2);
  assert.match(files.get('pins.csv')!, /"https:\/\//);
  assert.match(files.get('README.txt')!, /NOTHING HAS BEEN PUBLISHED/);
});

test('AMP-131 export isolation: two businesses each get only their own campaign, whatever else exists in the store', async () => {
  const { rt, demo, assets, campaignId } = await makeRt();
  await write(rt, campaignId);
  const pinA = entries(await calendar(rt)).find((e) => e.what === 'Pinterest Pin')!;
  await review(rt, campaignId, `${pinA.id}:pin`, 'approve');
  rt.businesses = new Set([A, B]);

  // B has no campaign: it gets nothing of A's.
  assert.deepEqual(await model(rt, ctx, B), { state: 'no_plan' });
  assert.deepEqual(await runCalendarExport(input(rt), B), no(NO_APPROVED_PLAN));

  // B gets its own approved campaign with its own text. Nothing of B's is approved yet, so nothing leaves, although A has an approved Pin.
  const recB = structuredClone((await demo.campaigns.get(DEMO_WORKSPACE, A))!);
  recB.id = 'camp-b'; recB.businessId = B; recB.plan.businessId = B;
  await demo.campaigns.mutate(DEMO_WORKSPACE, B, () => ({ record: recB, result: null }));
  await write(rt, 'camp-b', B);
  assert.equal((await calendar(rt, B)).counts.approved, 0);
  assert.deepEqual(await runCalendarExport(input(rt), B), no(NOTHING_APPROVED));

  // B approves a caption. Each export holds only its own business's approved text.
  const captionB = entries(await calendar(rt, B)).find((e) => e.what === 'Caption')!;
  await review(rt, 'camp-b', `${captionB.id}:caption`, 'approve', B);
  const a = await runCalendarExport(input(rt), A);
  const b = await runCalendarExport(input(rt), B);
  assert.ok(a.ok && a.file && b.ok && b.file);
  assert.equal(a.file.name, `campaign-assets-${campaignId}-v1.zip`);
  assert.equal(b.file.name, 'campaign-assets-camp-b-v1.zip');
  assert.deepEqual(a.file.files.slice().sort(), ['README.txt', 'pin-images.md', 'pins.csv']);
  assert.deepEqual(b.file.files.slice().sort(), ['README.txt', 'captions.txt']);
  assert.equal((await calendar(rt)).exportable, 1);
  assert.equal((await calendar(rt, B)).exportable, 1);
  assert.equal(entries(await calendar(rt)).find((e) => e.id === captionB.id)!.state, 'draft');

  // The request names no campaign, so there is nothing to aim at another business. Another workspace, an unknown business and a
  // record filed under the wrong business all get nothing.
  assert.equal(runCalendarExport.length, 2);
  assert.deepEqual(await runCalendarExport(input(rt, otherWorkspace), A), no(NO_APPROVED_PLAN));
  assert.deepEqual(await model(rt, otherWorkspace), { state: 'no_plan' });
  for (const bad of ['__proto__', 'constructor', 'toString', '../etc', '', 42, null, undefined, {}, [A], 'biz-unknown']) {
    assert.deepEqual(await runCalendarExport(input(rt), bad), no(NO_BUSINESS), String(bad));
    assert.deepEqual(await loadCalendar(rt, ctx, bad, now), { found: false }, String(bad));
  }
  // The memory store itself refuses to file B's record under another business; a store that hands it over anyway still exports nothing.
  await assert.rejects(demo.campaigns.mutate(DEMO_WORKSPACE, 'biz-c', () => ({ record: structuredClone(recB), result: null })));
  const misfiled: CalendarRuntime = {
    ...rt, businesses: new Set([A, B, 'biz-c']),
    campaigns: { kind: 'memory', get: async (w, b) => (b === 'biz-c' ? structuredClone(recB) : demo.campaigns.get(w, b)), mutate: (w, b, change) => demo.campaigns.mutate(w, b, change) },
  };
  assert.deepEqual(await model(misfiled, ctx, 'biz-c'), { state: 'no_plan' });
  assert.deepEqual(await runCalendarExport(input(misfiled), 'biz-c'), no(NO_APPROVED_PLAN));
  assert.equal(await assets.get(DEMO_WORKSPACE, 'biz-c', 'camp-b'), null);
});

test('AMP-131 export refusals: demo storage off touches nothing; links with no web address are refused in plain words', async () => {
  const { rt } = await makeRt();
  let touched = false;
  assert.deepEqual(await runCalendarExport({ availability: { available: false, reason: 'Off here.' }, rt: () => { touched = true; return rt; }, ctx, now }, A), no('Off here.'));
  assert.equal(touched, false);

  // A plan made with no store domain has store paths for links: the service refuses, and the page says why.
  const { catalogueCtx, workspaceId, ownerId } = ctx;
  const bare = await makeRt({ context: { catalogueCtx, workspaceId, ownerId } });
  await write(bare.rt, bare.campaignId);
  const pin = entries(await calendar(bare.rt)).find((e) => e.what === 'Pinterest Pin')!;
  await review(bare.rt, bare.campaignId, `${pin.id}:pin`, 'approve');
  assert.deepEqual(await runCalendarExport(input(bare.rt), A), no(NO_WEB_ADDRESS));
});

test('AMP-131 a throwing store: the export answers in plain words and logs only the error name; the loader throws for the page to catch', async () => {
  const { rt } = await makeRt();
  const boom = () => { throw new TypeError('secret-db-password connection refused'); };
  const broken: CalendarRuntime = { ...rt, campaigns: { kind: 'memory', get: boom, mutate: boom } };
  const logged: string[] = [];
  const r = await runCalendarExport(input(broken), A, (m, d) => { logged.push(`${m} ${d}`); });
  assert.deepEqual(r, no(WENT_WRONG));
  assert.deepEqual(logged, ['[app calendar] export failed: TypeError']);
  assert.doesNotMatch(JSON.stringify(r), /secret|refused|TypeError/);
  await assert.rejects(loadCalendar(broken, ctx, A, now));

  // A draft store that throws, and a runtime that can not be read at all.
  const noDrafts: CalendarRuntime = { ...rt, campaignAssets: { kind: 'memory', get: boom, mutate: boom, archived: boom } };
  assert.deepEqual(await runCalendarExport(input(noDrafts), A, () => {}), no(WENT_WRONG));
  await assert.rejects(loadCalendar(noDrafts, ctx, A, now));
  assert.deepEqual(await runCalendarExport({ availability: ON, rt: boom, ctx, now }, A, () => {}), no(WENT_WRONG));
});

test('AMP-139 size cap: an export above the item, file or byte cap is refused in one sentence on the server, with no file', async () => {
  assert.deepEqual([MAX_EXPORT_ITEMS, MAX_EXPORT_FILES, MAX_EXPORT_BYTES], [200, 20, 5 * 1024 * 1024]);
  const { rt, campaignId } = await makeRt();
  await write(rt, campaignId);
  const pin = entries(await calendar(rt)).find((e) => e.what === 'Pinterest Pin')!;
  await review(rt, campaignId, `${pin.id}:pin`, 'approve');

  // Under the default caps the same export goes through.
  const ok = await runCalendarExport(input(rt), A);
  assert.ok(ok.ok && ok.file);
  const size = Buffer.from(ok.file.base64, 'base64').byteLength;
  assert.ok(size < MAX_EXPORT_BYTES);

  const cases: [Partial<{ items: number; files: number; bytes: number }>, string][] = [
    [{ items: 0 }, tooLarge('0 approved pieces of text')],
    [{ files: 1 }, tooLarge('1 files')],
    [{ bytes: size - 1 }, tooLarge(`${size - 1} bytes`)],
  ];
  for (const [limits, message] of cases) {
    const r = await runCalendarExport({ ...input(rt), limits }, A);
    assert.deepEqual(r, no(message));
    assert.equal(r.file, null);
    assert.match(r.message, /^This export is too large to download in one go \(more than .+\), so nothing was saved\.$/);
    assert.equal(r.message.split(/(?<=\.)\s/).length, 1, 'one plain sentence');
  }
  // A cap equal to the size is not over it.
  assert.equal((await runCalendarExport({ ...input(rt), limits: { bytes: size } }, A)).ok, true);
});

test('AMP-139 publishing card: says only what the code does today, with no coming-later promise; the result is announced once and focus is moved', () => {
  assert.doesNotMatch(PUBLISHING_TEXT, /\bcoming\b|\bsoon\b|\blater\b|will be able|\bwill\b/i);
  assert.doesNotMatch(PUBLISHING_NOTE, /\bcoming\b|\bsoon\b|\blater\b|will be able|\bwill\b/i);
  assert.match(PUBLISHING_TEXT, /nothing is posted for you/);
  const dir = join(import.meta.dirname, '..', 'app', 'app', '[business]', 'marketing', 'calendar');
  const view = readFileSync(join(dir, 'calendar-view.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.doesNotMatch(view, /\bcoming\b|\bsoon\b|will be able/i);
  // One polite status region that always stays on the page; the visible notice is not live, so the result is read once.
  assert.equal(view.match(/role="status"/g)?.length, 1);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /<GlassNotice [^>]*live="none"/);
  // Focus goes to the export area after the file is made (the button is disabled while it is made).
  assert.match(view, /focusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(view, /ref=\{focusRef\} tabIndex=\{-1\}/);
});

test('AMP-161 calendar: counts are checked before the ZIP is built; a save failure on the device has its own message; focus is not stolen', async () => {
  const dir = join(import.meta.dirname, '..', 'app', 'app', '[business]', 'marketing', 'calendar');
  const guard = readFileSync(join(dir, '_server', 'calendar-guard.ts'), 'utf8');
  // The stored approved assets are counted first; the ZIP service is only called after that check.
  const at = (s: string) => guard.indexOf(s);
  assert.ok(at('deps.assets.get(') > 0 && at('deps.assets.get(') < at('await exportCampaign('));
  assert.ok(at('approved.length > cap.items') < at('await exportCampaign('));
  assert.ok(at('fileCount > cap.files') < at('await exportCampaign('));

  // Behaviour: with two approved pieces and a cap of one, the reply is the too-large sentence with no file; at the cap it goes through.
  const { rt, campaignId } = await makeRt();
  await write(rt, campaignId);
  const pin = entries(await calendar(rt)).find((e) => e.what === 'Pinterest Pin')!;
  await review(rt, campaignId, `${pin.id}:pin`, 'approve');
  // One approved piece: a cap of one is not over it; a cap of none is refused with no file.
  assert.equal((await runCalendarExport({ ...input(rt), limits: { items: 1 } }, A)).ok, true);
  assert.deepEqual(await runCalendarExport({ ...input(rt), limits: { items: 0 } }, A), no(tooLarge('0 approved pieces of text')));
  // A pin makes 2 files plus the README: a cap of 3 passes, a cap of 2 is refused.
  assert.equal((await runCalendarExport({ ...input(rt), limits: { files: 3 } }, A)).ok, true);
  assert.deepEqual(await runCalendarExport({ ...input(rt), limits: { files: 2 } }, A), no(tooLarge('2 files')));

  const view = readFileSync(join(dir, 'calendar-view.tsx'), 'utf8');
  const unreachable = /const UNREACHABLE = '([^']+)'/.exec(view)![1];
  const saveFailed = /const SAVE_FAILED = '([^']+)'/.exec(view)![1];
  assert.notEqual(unreachable, saveFailed);
  assert.match(saveFailed, /could not save it to this device/);
  assert.match(view, /try \{ saveFile\(r\.file\); \} catch \{ saved = false; \}/);
  assert.match(view, /if \(!saved\) setNotice\(\{ ok: false, text: SAVE_FAILED/);
  // Focus moves only when it is still lost (on the page, or on the export area), never when the owner has gone elsewhere.
  assert.match(view, /document\.activeElement/);
  assert.match(view, /if \(lost\) focusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('AMP-131 wording: publishing shows "Not connected" and nothing claims a post went out or has a time it goes out', async () => {
  const { rt, campaignId } = await makeRt();
  await write(rt, campaignId);
  const m = await calendar(rt);
  assert.equal(PUBLISHING_LABEL, 'Not connected');
  assert.ok(m.channels.length > 0 && m.channels.every((c) => c.publishing === 'Not connected'));
  assert.match(PUBLISHING_TEXT, /^No social account is connected/);
  assert.match(NOTHING_POSTED, /^Nothing is posted, scheduled or sent from here/);
  for (const s of [exported(1), exported(3), WENT_WRONG]) assert.match(s, /Nothing was posted\.$/, s);
  // No entry state borrows a publishing word: the spec's scheduled, submitting and published states belong to a later release.
  for (const s of Object.values(ENTRY_STATE_LABELS)) assert.doesNotMatch(s, /schedul|publish|posted|sent|live|queued/i, s);

  const claims = /(?<!nothing )\b(was|were|is|are|has been|have been) (posted|scheduled|published|sent)\b|\bwe (posted|scheduled|published)\b|guarantee/i;
  const promises = /\b(will|going to) (be )?(post|publish|send|sent|go out)|\bscheduled (for|to|at)\b|\b(goes|went|going) out\b|\bis (now )?live\b|\bqueued\b/i;
  const variants: Ready[] = [m, { ...m, drafts: 'plan_draft' }, { ...m, drafts: 'none' }, { ...m, drafts: 'old' }, { ...m, exportable: 0 }, { ...m, exportable: 4 }];
  const copy = [
    NOTHING_POSTED, NOT_IN_DEMO, PUBLISHING_LABEL, PUBLISHING_NOTE, PUBLISHING_TEXT, BY_HAND, tooLarge('3 files'), NO_BUSINESS, NO_STORE, NO_APPROVED_PLAN, NO_DRAFTS, OLD_PLAN, NOTHING_APPROVED, NEEDS_FIXES,
    NO_WEB_ADDRESS, NOT_DONE, WENT_WRONG, exported(1), exported(5), countsLine(m.counts), entriesLabel(3), ...Object.values(ENTRY_STATE_LABELS), ...variants.map(exportHint),
    ...m.days.flatMap((d) => [d.dateLabel, ...d.entries.flatMap((e) => [e.what, e.channelLabel, e.stateLabel])]),
  ];
  for (const s of copy) {
    assert.doesNotMatch(s, claims, s);
    assert.doesNotMatch(s, promises, s);
  }
  // Every word the page itself can show: the source of the page, with its code comments taken out.
  const dir = join(import.meta.dirname, '..', 'app', 'app', '[business]', 'marketing', 'calendar');
  const sources = [...readdirSync(dir), ...readdirSync(join(dir, '_server')).map((f) => join('_server', f))].filter((f) => /\.tsx?$/.test(f));
  assert.ok(sources.length >= 6);
  for (const f of sources) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, claims, f);
    assert.doesNotMatch(text, promises, f);
  }
});
