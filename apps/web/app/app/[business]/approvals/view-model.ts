// Approvals and activity (screen 35, AMP-127; G02, G03, I06). Pure view model: it turns what the automation service answers into the
// plain words the page draws. No I/O and no state. Times are written in UTC so the server and the browser always agree.
import { AREA_LABELS, KIND_LABELS, MAX_CAP, MODE_LABELS, automationAreas, automationModes } from '../../../../lib/aimp/automation/types.ts';
import type { ActivityEntry, ApprovalView, AutomationArea, AutomationMode, AutomationSettings } from '../../../../lib/aimp/automation/types.ts';

export const ACTIVITY_LIMIT = 30;
export const DECIDED_LIMIT = 10;
export const NOT_IN_DEMO = 'Not available in the demo yet';
export const NOT_IN_DEMO_TEXT = 'Approvals, the usage allowance and the activity list are not available in the demo yet. Nothing is waiting for you here, and nothing was changed.';
export const NOTHING_PENDING = 'Nothing is waiting for you';
export const NOTHING_PENDING_TEXT = 'When something needs your OK before it runs, it appears here.';
export const NO_ACTIVITY = 'No activity yet';
export const NO_ACTIVITY_TEXT = 'Changes to these settings, your decisions and jobs for this business are listed here, newest first.';
export const DEMO_TEXT = 'Demo storage on the server: approvals, settings and activity are kept in memory and are lost when the server restarts. Jobs here run on demo fixtures only. Guided set-up does not send its work through this page yet, so set-up steps do not appear here and do not count against the allowance.';
export const CAP_HINT = `A whole number from 0 to ${MAX_CAP}.`;

export const MODE_HELP: Readonly<Record<AutomationMode, string>> = {
  automatic: 'Runs without asking you.',
  owner_approval: 'Waits here for your OK before it runs.',
  paused: 'Nothing new starts until you switch it back on.',
};

export const approvalsHref = (businessId: string): string => `/app/${businessId}/approvals`;

const pad = (n: number) => String(n).padStart(2, '0');
/** `2026-11-15 09:30 UTC`, or "Unknown time" when the value is not a real time. */
export function whenLabel(ms: number): string {
  if (!Number.isFinite(ms)) return 'Unknown time';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
export const isoOf = (ms: number): string => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };

const areaLabel = (a: AutomationArea | null): string | null => (a && automationAreas.includes(a) ? AREA_LABELS[a] : null);
const kindLabel = (kind: string): string => (Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : 'Other action');

export interface PendingVM {
  id: string; title: string; areaLabel: string; kindLabel: string; askedLabel: string; askedIso: string; expiresLabel: string; expiresIso: string;
  /** What approving does, in plain words. Makes no claim of posting, sending or publishing. */
  effect: string;
}
export interface DecidedVM { id: string; title: string; areaLabel: string; status: 'approved' | 'rejected' | 'expired'; statusLabel: string; whenLabel: string; whenIso: string; note: string }
export interface ModeVM { area: AutomationArea; label: string; mode: AutomationMode; modeLabel: string; help: string }
export interface UsageVM { used: number; limit: number; remaining: number; reached: boolean; words: string; resetsLabel: string; resetsIso: string; note: string }
export interface ActivityVM { id: string; title: string; statusLabel: string; tone: 'neutral' | 'success' | 'warn' | 'danger'; whenLabel: string; whenIso: string; detail: string | null; nextAction: string | null; areaLabel: string | null }

export interface ApprovalsData {
  settings: AutomationSettings;
  approvals: ApprovalView[];
  activity: ActivityEntry[];
}

export interface ApprovalsVM {
  businessId: string; businessName: string | null; title: 'Approvals and activity'; overviewHref: string; demoText: string;
  pendingTitle: string; pending: PendingVM[]; decided: DecidedVM[];
  modes: ModeVM[]; modeOptions: { value: AutomationMode; label: string; help: string }[];
  usage: UsageVM; activity: ActivityVM[]; activityHidden: boolean;
}

const DECIDED_WORDS = {
  approved: { label: 'Approved', note: 'You approved this. Its job was handed to the demo job queue once.' },
  rejected: { label: 'Rejected', note: 'You rejected this. It was not run and can not be changed.' },
  expired: { label: 'Expired', note: 'This ran out of time before a decision. It was not run. Ask for it again if you still want it.' },
} as const;

const TONES: Readonly<Record<string, ActivityVM['tone']>> = {
  failed: 'danger', needs_approval: 'warn', paused: 'warn', 'waiting-retry': 'warn', succeeded: 'success', complete: 'success', live: 'success',
};

export function buildApprovals(businessId: string, businessName: string | null, data: ApprovalsData): ApprovalsVM {
  const newest = (a: ApprovalView, b: ApprovalView) => b.requestedAt - a.requestedAt || a.id.localeCompare(b.id);
  const pending = data.approvals.filter((a) => a.status === 'pending').sort(newest).map((a): PendingVM => ({
    id: a.id, title: a.description, areaLabel: areaLabel(a.area) ?? 'Other', kindLabel: kindLabel(a.kind),
    askedLabel: whenLabel(a.requestedAt), askedIso: isoOf(a.requestedAt), expiresLabel: whenLabel(a.expiresAt), expiresIso: isoOf(a.expiresAt),
    effect: `If you approve, one “${kindLabel(a.kind)}” job is handed to the demo job queue, once. If you reject, it never runs. Nothing has started yet.`,
  }));
  const decided = data.approvals
    .filter((a): a is ApprovalView & { status: DecidedVM['status'] } => a.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.requestedAt) - (a.decidedAt ?? a.requestedAt) || a.id.localeCompare(b.id))
    .slice(0, DECIDED_LIMIT)
    .map((a): DecidedVM => {
      const at = a.decidedAt ?? a.requestedAt;
      return { id: a.id, title: a.description, areaLabel: areaLabel(a.area) ?? 'Other', status: a.status, statusLabel: DECIDED_WORDS[a.status].label, whenLabel: whenLabel(at), whenIso: isoOf(at), note: DECIDED_WORDS[a.status].note };
    });
  const u = data.settings.usage;
  const sorted = [...data.activity].sort((x, y) => y.at - x.at || x.id.localeCompare(y.id));
  return {
    businessId, businessName, title: 'Approvals and activity', overviewHref: `/app/${businessId}`, demoText: DEMO_TEXT,
    pendingTitle: pending.length ? `Waiting for you (${pending.length})` : 'Waiting for you',
    pending, decided,
    modes: automationAreas.map((area) => {
      const mode = data.settings.modes[area];
      return { area, label: AREA_LABELS[area], mode, modeLabel: MODE_LABELS[mode], help: MODE_HELP[mode] };
    }),
    modeOptions: automationModes.map((m) => ({ value: m, label: MODE_LABELS[m], help: MODE_HELP[m] })),
    usage: {
      used: u.used, limit: u.limit, remaining: u.remaining, reached: u.reached,
      words: `${u.used} of ${u.limit} AI generations used this period`,
      resetsLabel: whenLabel(u.resetsAt), resetsIso: isoOf(u.resetsAt),
      note: u.reached
        ? 'The allowance is used up, so new AI generation is paused until the next period or until you raise the allowance. Orders and deliveries are not affected.'
        : `${u.remaining} left this period.`,
    },
    activity: sorted.slice(0, ACTIVITY_LIMIT).map((e): ActivityVM => ({
      id: e.id, title: e.title, statusLabel: e.label, tone: TONES[e.status] ?? 'neutral', whenLabel: whenLabel(e.at), whenIso: isoOf(e.at),
      detail: e.detail, nextAction: e.nextAction, areaLabel: areaLabel(e.area),
    })),
    activityHidden: sorted.length > ACTIVITY_LIMIT,
  };
}

export const headingOutline = (vm: ApprovalsVM): { level: 1 | 2; text: string }[] => [
  { level: 1, text: vm.title }, { level: 2, text: vm.pendingTitle }, { level: 2, text: 'AI generation allowance' }, { level: 2, text: 'What needs your OK' }, { level: 2, text: 'Recent activity' },
  ...(vm.decided.length ? [{ level: 2 as const, text: 'Already decided' }] : []),
];
