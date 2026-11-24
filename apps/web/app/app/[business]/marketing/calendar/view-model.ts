// Display model for the Campaign calendar (screen 27, AMP-131; F03 F04 F05 F06 G02 G05). Pure: the day-by-day list is built by the
// campaign service's own `scheduleFor` (lib/aimp/campaigns/schedule.ts) from the saved plan, and each entry's state is the state of the
// text draft the campaign-assets service (AMP-051) keeps for it. No number is invented: counts are counted from the plan and the drafts.
// This release shows suggested days and exports approved text. Publishing is not connected, and nothing here says, or may say, that
// anything was posted or published, or that a post has a time it goes out at.
import { assetIdFor, kindsForFormat } from '../../../../../lib/aimp/campaign-assets/service.ts';
import type { AssetSet } from '../../../../../lib/aimp/campaign-assets/types.ts';
import { isWindow, parseDay, scheduleFor } from '../../../../../lib/aimp/campaigns/schedule.ts';
import type { CampaignRecord } from '../../../../../lib/aimp/campaigns/types.ts';
import { KIND_LABELS } from '../creative/view-model.ts';
import { CHANNEL_LABELS, dayLabel } from '../view-model.ts';

export const NOTHING_POSTED = 'Nothing is posted, scheduled or sent from here. The days below are suggested days only; you post by hand.';
export const NOT_IN_DEMO = 'The campaign calendar is not available in the demo yet.';
export const PUBLISHING_LABEL = 'Not connected';
export const PUBLISHING_TEXT = 'No social account is connected to this business, so this page can not post for you. This page makes drafts and a file you can save. You post the approved text yourself, and nothing is posted for you.';
export const PUBLISHING_NOTE = 'Publishing is not connected: this page only makes drafts and a ZIP file to save.';
export const BY_HAND = 'You post this by hand';

/** Where one calendar entry stands. The first two come from the plan, the last three from the text draft written for the entry. */
export type EntryState = 'plan_draft' | 'not_written' | 'draft' | 'approved' | 'rejected';
export const ENTRY_STATE_LABELS: Readonly<Record<EntryState, string>> = {
  plan_draft: 'Draft plan, not approved yet',
  not_written: 'Text not written yet',
  draft: 'Draft, needs your review',
  approved: 'Approved by you',
  rejected: 'Rejected by you',
};

export interface CalendarEntry {
  id: string;
  /** What it is: "Pinterest Pin", "Caption" or "Short video script". */
  what: string;
  productTitle: string;
  /** The headline from the plan. */
  hook: string;
  channelLabel: string;
  state: EntryState;
  stateLabel: string;
}
export interface CalendarDay {
  /** 1-based day of the plan's window. */
  day: number;
  date: string;
  /** "Tue 17 Nov 2026" (UTC calendar day). */
  dateLabel: string;
  entries: CalendarEntry[];
}
/** Which text drafts the entry states were read from. `old`: drafts exist, but for an earlier version of the plan. */
export type DraftsState = 'plan_draft' | 'none' | 'old' | 'current';

export type CalendarModel =
  | { state: 'no_plan' }
  | {
    state: 'calendar';
    planStatus: 'draft' | 'approved';
    version: number;
    windowLabel: string;
    windowDays: number;
    /** Days of the window with nothing on them. They are counted, not listed. */
    quietDays: number;
    /** Only the days that have at least one entry, in order. */
    days: CalendarDay[];
    counts: Record<EntryState, number>;
    channels: { label: string; publishing: typeof PUBLISHING_LABEL }[];
    drafts: DraftsState;
    /** Approved text drafts in the current set (search listing text included): what an export would hold. 0 = nothing to export. */
    exportable: number;
  };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-17" => "Tue 17 Nov 2026" (UTC). A date that is not real => "Unknown date". */
export function weekdayLabel(date: string): string {
  const ms = parseDay(date);
  return ms === null ? dayLabel(date) : `${WEEKDAYS[new Date(ms).getUTCDay()]} ${dayLabel(date)}`;
}

/**
 * The calendar of one saved campaign. `drafts` is the campaign's asset set as the campaign-assets service listed it, or null when
 * none was written (or the plan is not approved, in which case it is never read). A saved plan whose window is not valid throws,
 * and the page shows its plain error state.
 */
export function buildCalendarModel(c: CampaignRecord | undefined, drafts: { set: AssetSet; current: boolean } | null): CalendarModel {
  if (!c) return { state: 'no_plan' };
  const p = c.plan;
  const { startDate, windowDays } = p.schedule;
  if (parseDay(startDate) === null || !isWindow(windowDays)) throw new Error('The saved plan has no valid schedule.');
  const schedule = scheduleFor(startDate, windowDays, p.items);

  const planApproved = c.status === 'approved';
  const draftsState: DraftsState = !planApproved ? 'plan_draft' : !drafts ? 'none' : drafts.current ? 'current' : 'old';
  const set = draftsState === 'current' && drafts ? drafts.set : null;
  const assetState = new Map((set?.assets ?? []).map((a) => [a.id, a.state]));
  const items = new Map(p.items.map((i) => [i.id, i]));
  const counts: Record<EntryState, number> = { plan_draft: 0, not_written: 0, draft: 0, approved: 0, rejected: 0 };

  const days: CalendarDay[] = [];
  for (const d of schedule.days) {
    const entries: CalendarEntry[] = [];
    for (const id of d.itemIds) {
      const item = items.get(id);
      if (!item) continue;
      // The entry is the post itself: the first kind of text made for its format (a Pin, a caption or a video script).
      const kind = kindsForFormat[item.format][0]!;
      const state: EntryState = !planApproved ? 'plan_draft' : assetState.get(assetIdFor(item.id, kind)) ?? 'not_written';
      counts[state] += 1;
      entries.push({ id: item.id, what: KIND_LABELS[kind], productTitle: item.productTitle, hook: item.hook, channelLabel: CHANNEL_LABELS[item.channel], state, stateLabel: ENTRY_STATE_LABELS[state] });
    }
    if (entries.length) days.push({ day: d.day, date: d.date, dateLabel: weekdayLabel(d.date), entries });
  }

  return {
    state: 'calendar', planStatus: c.status, version: c.version,
    windowLabel: `${dayLabel(schedule.startDate)} to ${dayLabel(schedule.endDate)}`,
    windowDays: schedule.windowDays, quietDays: schedule.windowDays - days.length, days, counts,
    channels: [p.primaryChannel, ...p.secondaryChannels.map((s) => s.channel)].map((ch) => ({ label: CHANNEL_LABELS[ch], publishing: PUBLISHING_LABEL })),
    drafts: draftsState,
    exportable: set ? set.assets.filter((a) => a.state === 'approved').length : 0,
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const entriesLabel = (n: number): string => plural(n, 'entry', 'entries');
export const piecesLabel = (n: number): string => plural(n, 'approved piece of text', 'approved pieces of text');

/** "3 need your review, 2 approved, 1 rejected." Only the states that have entries are named. */
export function countsLine(c: Record<EntryState, number>): string {
  const parts = [
    c.plan_draft ? `${c.plan_draft} in a draft plan` : '',
    c.not_written ? `${c.not_written} not written yet` : '',
    c.draft ? `${c.draft} to review` : '',
    c.approved ? `${c.approved} approved` : '',
    c.rejected ? `${c.rejected} rejected` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing is on the calendar.';
}

/** What the export card says: what the ZIP file would hold, or the one step that comes first. */
export function exportHint(m: Pick<Extract<CalendarModel, { state: 'calendar' }>, 'drafts' | 'exportable' | 'version'>): string {
  if (m.drafts === 'plan_draft') return `Version ${m.version} of your plan is still a draft. Approve it on the Marketing page first; only approved text can be saved.`;
  if (m.drafts === 'none') return 'The text for these entries has not been written yet. Write and approve it in Creative Studio first.';
  if (m.drafts === 'old') return 'The text you have was written for an earlier version of your plan. Write it again in Creative Studio for this version first.';
  if (m.exportable === 0) return 'Nothing is approved yet, so there is nothing to save. Approve at least one draft in Creative Studio first.';
  return `Saves ${piecesLabel(m.exportable)} as one ZIP file, with a note on what to do with each file. Drafts and rejected text are left out.`;
}
