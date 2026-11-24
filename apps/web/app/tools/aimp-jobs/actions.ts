'use server';
import { notFound, redirect } from 'next/navigation';
import { toolsEnabled } from '../../../lib/aimp/files/demo.ts';
import { demoCtx, demoJobs, MAX_DEMO_JOBS, otherCtx } from '../../../lib/aimp/jobs/demo.ts';
import { JobsError } from '../../../lib/aimp/jobs/types.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/aimp-jobs?msg=${encodeURIComponent(msg)}` : '/tools/aimp-jobs');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
/** Input mistakes made on this page: their messages are written here and are safe to show. */
class InputError extends Error {}
const errText = (e: unknown): string => (e instanceof JobsError ? `Refused (${e.code}): ${e.message}` : e instanceof InputError ? e.message : 'Something went wrong.');
/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
const guard = () => { if (!toolsEnabled()) notFound(); return demoJobs(); };
const KINDS = ['generate-product', 'publish-site', 'fulfil-order', 'scheduled-post'];

export async function enqueueDemo(f: FormData): Promise<void> {
  const d = guard();
  let msg: string;
  try {
    const kind = field(f, 'kind');
    if (!KINDS.includes(kind)) throw new InputError('Pick a job kind.');
    const key = field(f, 'key').trim().slice(0, 80) || 'demo-1';
    if ((await d.service.list(demoCtx(key))).length >= MAX_DEMO_JOBS) throw new InputError(`The demo is limited to ${MAX_DEMO_JOBS} jobs. Restart the server to reset it.`);
    const { job, created } = await d.service.enqueue(demoCtx(key), { kind, input: { niche: 'budget planners', orderId: key } });
    const failStep = field(f, 'failStep');
    // Fault only on a newly created job, so re-submitting the same key shows the duplicate being ignored.
    if (created && failStep) {
      const type = field(f, 'faultType') === 'permanent' ? 'permanent' : 'temporary';
      const when = field(f, 'when') === 'after' ? 'after' : 'before';
      const times = Math.min(4, Math.max(1, Number(field(f, 'times')) || 1));
      d.faults.add({ kind, step: failStep, times, type, when });
    }
    msg = created ? `Queued ${job.id.slice(0, 8)}.` : `Same key: kept the existing job ${job.id.slice(0, 8)} (no duplicate).`;
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function runNow(f: FormData): Promise<void> {
  const d = guard();
  let msg: string;
  try {
    if (field(f, 'skipWait') === '1') d.clock.advance(20 * 60_000);
    const reports = await d.runner.drain({ maxRounds: 20 });
    msg = `Ran ${reports.length} step(s): ${reports.map((r) => `${r.kind}/${r.step} ${r.outcome}`).join(', ') || 'nothing was due'}.`;
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function jobAction(f: FormData): Promise<void> {
  const d = guard();
  let msg = '';
  try {
    const id = field(f, 'jobId'), op = field(f, 'op');
    const ctx = demoCtx('ui');
    if (op === 'pause') await d.service.pause(ctx, id);
    else if (op === 'resume') await d.service.resume(ctx, id);
    else if (op === 'cancel') await d.service.cancel(ctx, id);
    else if (op === 'retry') await d.service.retry(ctx, id);
    else throw new InputError('Unknown action.');
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function tenantAction(f: FormData): Promise<void> {
  const d = guard();
  const op = field(f, 'op'), ctx = demoCtx('ui');
  let msg: string;
  try {
    if (op === 'pause') { await d.service.pauseTenant(ctx); msg = 'All jobs for this workspace are paused.'; }
    else if (op === 'resume') { await d.service.resumeTenant(ctx); msg = 'Workspace resumed.'; }
    else if (op === 'cancel') msg = `Cancelled ${await d.service.cancelTenant(ctx)} unfinished job(s).`;
    else throw new InputError('Unknown action.');
  } catch (e) { msg = errText(e); }
  back(msg);
}

/** Proves tenant isolation: a different workspace cannot read or change a demo job. */
export async function tryOtherTenant(f: FormData): Promise<void> {
  const d = guard();
  let msg: string;
  try { await d.service.cancel(otherCtx('ui'), field(f, 'jobId')); msg = 'Unexpected: the other workspace could change this job.'; } catch (e) { msg = `Other workspace blocked. ${errText(e)}`; }
  back(msg);
}
