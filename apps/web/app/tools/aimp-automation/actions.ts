'use server';
import { notFound, redirect } from 'next/navigation';
import { toolsEnabled } from '../../../lib/aimp/files/demo.ts';
import { automationCtx, demoAutomation, MAX_DEMO_ACTIONS, OTHER_BUSINESS } from '../../../lib/aimp/automation/demo.ts';
import { AutomationError, automationAreas, automationModes } from '../../../lib/aimp/automation/index.ts';
import type { AutomationArea, AutomationMode } from '../../../lib/aimp/automation/index.ts';
import { JobsError } from '../../../lib/aimp/jobs/types.ts';

const back = (msg?: string, as?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set('msg', msg);
  if (as === 'other') q.set('as', 'other');
  const s = q.toString();
  return redirect(s ? `/tools/aimp-automation?${s}` : '/tools/aimp-automation');
};
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
class InputError extends Error {}
const errText = (e: unknown): string =>
  e instanceof AutomationError ? `Refused (${e.code}): ${e.message}` : e instanceof JobsError ? `Refused (${e.code}): ${e.message}` : e instanceof InputError ? e.message : 'Something went wrong.';
/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
const guard = () => { if (!toolsEnabled()) notFound(); return demoAutomation(); };
const biz = (f: FormData) => (field(f, 'as') === 'other' ? OTHER_BUSINESS : 'demo-business');
const KINDS = ['generate-product', 'publish-site', 'scheduled-post', 'fulfil-order'];

export async function setModeAction(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    const area = field(f, 'area') as AutomationArea, mode = field(f, 'mode') as AutomationMode;
    if (!automationAreas.includes(area) || !automationModes.includes(mode)) throw new InputError('Pick an area and a mode.');
    await d.automation.setMode(automationCtx('ui', biz(f)), area, mode);
    msg = `${area} is now ${mode}.`;
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

export async function setCapAction(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    await d.automation.setCap(automationCtx('ui', biz(f)), Number(field(f, 'limit')));
    msg = 'Allowance saved.';
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

export async function startAction(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    const kind = field(f, 'kind');
    if (!KINDS.includes(kind)) throw new InputError('Pick what to start.');
    if (d.actions.count >= MAX_DEMO_ACTIONS) throw new InputError(`The demo is limited to ${MAX_DEMO_ACTIONS} actions. Restart the server to reset it.`);
    d.actions.count += 1;
    const key = field(f, 'key').trim().slice(0, 80) || `demo-${d.actions.count}`;
    const r = await d.automation.start(automationCtx(key, biz(f)), { kind, input: { niche: 'budget planners', orderId: key }, description: field(f, 'description').trim().slice(0, 200) || undefined });
    msg = `${r.outcome}: ${r.message}`;
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

export async function decideAction(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    const decision = field(f, 'decision');
    if (decision !== 'approve' && decision !== 'reject') throw new InputError('Choose approve or reject.');
    const r = await d.automation.decide(automationCtx('ui', biz(f)), field(f, 'approvalId'), decision);
    msg = `${r.message}${r.ran ? ' (started now)' : ''}`;
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

export async function retryAction(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    const r = await d.automation.retryJob(automationCtx('ui', biz(f)), field(f, 'jobId'));
    msg = r.message;
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

export async function runNow(f: FormData): Promise<void> {
  const d = guard(); let msg: string;
  try {
    if (field(f, 'skipWait') === '1') d.jobs.clock.advance(20 * 60_000);
    const reports = await d.jobs.runner.drain({ maxRounds: 20 });
    msg = `Ran ${reports.length} step(s): ${reports.map((r) => `${r.kind}/${r.step} ${r.outcome}`).join(', ') || 'nothing was due'}.`;
  } catch (e) { msg = errText(e); }
  back(msg, field(f, 'as'));
}

/** Makes the next product generation fail once with a temporary problem, to show the retry in the feed. */
export async function injectFailure(f: FormData): Promise<void> {
  const d = guard();
  d.jobs.faults.add({ kind: 'generate-product', step: 'draft-spec', times: 1, type: 'temporary', when: 'before' });
  back('The next product generation will fail once, then retry.', field(f, 'as'));
}
