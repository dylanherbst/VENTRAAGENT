// Operator runs (screen 34, AMP-128; G04, G08). Pure view model: it turns the job rows of the automation activity into the plain
// words the page draws. No I/O and no state. Times are written in UTC so the server and the browser always agree.
import { AREA_LABELS, automationAreas } from '../../../../lib/aimp/automation/types.ts';
import type { ActivityEntry, ActivityStatus } from '../../../../lib/aimp/automation/types.ts';
import { isoOf, whenLabel } from '../approvals/view-model.ts';

export const RUN_LIMIT = 30;
/** How many activity rows are asked for (the service's own maximum). Runs are the job rows among them. */
export const FEED_LIMIT = 500;
export const NOT_IN_DEMO = 'Not available in the demo yet';
export const NOT_IN_DEMO_TEXT = 'The list of runs is not available in the demo yet. No runs are shown here because none can be read, and nothing was changed.';
export const NO_RUNS = 'No runs yet';
export const NO_RUNS_TEXT = 'When a job runs for this business, such as a job you approved, it is listed here, newest first, with what happened to it.';
export const DEMO_TEXT = 'Demo storage on the server: runs are kept in memory and are lost when the server restarts. Jobs here run on demo fixtures only. Guided set-up does not send its work through the job queue yet, so set-up steps do not appear here. Retry hands a run back to the demo job queue; this page does not run the queue, so a retried run shows as Queued until the queue runs.';

/** One plain sentence per run status. Says what state the run is in, never a claim about posting, sending or selling. */
export const STATUS_WORDS: Readonly<Record<string, string>> = {
  queued: 'Waiting in the queue to start.',
  running: 'Working on it now.',
  'waiting-retry': 'It hit a temporary problem and will try again by itself. You do not need to do anything.',
  succeeded: 'Finished.',
  failed: 'It stopped and will not try again by itself. Choose Retry to try again; steps already finished are not repeated.',
  cancelled: 'It was cancelled and will not run.',
  paused: 'Paused. It will not run until it is switched back on.',
};
export const UNKNOWN_STATUS_WORDS = 'We do not know the state of this run.';

/** Details the service writes that only repeat the status sentence. */
const PLAIN_DETAILS: readonly string[] = ['Finished.', 'Waiting to start.', 'In progress.', 'Cancelled.', 'Paused.', 'It stopped.'];
const TONES: Readonly<Record<string, RunVM['tone']>> = { failed: 'danger', paused: 'warn', 'waiting-retry': 'warn', succeeded: 'success' };

export const operatorHref = (businessId: string): string => `/app/${businessId}/operator`;

export interface RunVM {
  /** The job id: the only thing Retry sends back. */
  id: string; title: string; status: ActivityStatus; statusLabel: string; tone: 'neutral' | 'success' | 'warn' | 'danger';
  words: string; detail: string | null; areaLabel: string | null; whenLabel: string; whenIso: string;
  nextTryLabel: string | null; nextTryIso: string | null; canRetry: boolean;
}

export interface OperatorData { entries: ActivityEntry[] }

export interface OperatorVM {
  businessId: string; businessName: string | null; title: 'Operator runs'; overviewHref: string; approvalsHref: string; demoText: string;
  runs: RunVM[]; runsHidden: boolean; failedShown: number; failedText: string | null;
}

/** The job rows of an activity feed, newest first. Rows without a job id are not runs. */
export function runsOf(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return entries
    .filter((e) => e.source === 'job' && typeof e.jobId === 'string' && e.jobId.length > 0)
    .sort((x, y) => y.at - x.at || x.id.localeCompare(y.id));
}

export function buildOperator(businessId: string, businessName: string | null, data: OperatorData): OperatorVM {
  const all = runsOf(data.entries);
  const runs = all.slice(0, RUN_LIMIT).map((e): RunVM => {
    const failed = e.status === 'failed';
    const detail = e.detail && !PLAIN_DETAILS.includes(e.detail) ? e.detail : null;
    const next = e.status === 'waiting-retry' && e.nextRetryAt !== null ? e.nextRetryAt : null;
    return {
      id: e.jobId ?? '', title: e.title, status: e.status, statusLabel: e.label, tone: Object.hasOwn(TONES, e.status) ? TONES[e.status] : 'neutral',
      words: Object.hasOwn(STATUS_WORDS, e.status) ? STATUS_WORDS[e.status] : UNKNOWN_STATUS_WORDS,
      detail: detail ? (failed ? `What went wrong: ${detail}` : detail) : null,
      areaLabel: e.area && automationAreas.includes(e.area) ? AREA_LABELS[e.area] : null,
      whenLabel: whenLabel(e.at), whenIso: isoOf(e.at),
      nextTryLabel: next === null ? null : whenLabel(next), nextTryIso: next === null ? null : isoOf(next),
      canRetry: failed,
    };
  });
  const failedShown = runs.filter((r) => r.canRetry).length;
  return {
    businessId, businessName, title: 'Operator runs', overviewHref: `/app/${businessId}`, approvalsHref: `/app/${businessId}/approvals`, demoText: DEMO_TEXT,
    runs, runsHidden: all.length > RUN_LIMIT, failedShown,
    failedText: failedShown === 0 ? null : failedShown === 1 ? 'One run stopped and needs you.' : `${failedShown} runs stopped and need you.`,
  };
}

export const headingOutline = (vm: OperatorVM): { level: 1 | 2; text: string }[] => [{ level: 1, text: vm.title }, { level: 2, text: 'Recent runs' }];
