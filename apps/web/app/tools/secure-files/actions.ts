'use server';
import { notFound, redirect } from 'next/navigation';
import { createDemoPaidOrder, demoCtx, otherCtx, runtime, toolsEnabled } from '../../../lib/aimp/files/demo.ts';
import type { DemoRuntime } from '../../../lib/aimp/files/demo.ts';
import type { FilesService } from '../../../lib/aimp/files/service.ts';
import { FilesError } from '../../../lib/aimp/files/types.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/secure-files?msg=${encodeURIComponent(msg)}` : '/tools/secure-files');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
const errText = (e: unknown) => (e instanceof FilesError ? `Refused (${e.code}): ${e.message}` : e instanceof Error ? e.message : 'Something went wrong.');

/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1, and no action without the files service. */
function guard(): { rt: DemoRuntime; files: FilesService } {
  if (!toolsEnabled()) notFound();
  const rt = runtime();
  if (!rt.files) return back('Live storage is not connected.');
  return { rt, files: rt.files };
}

export async function createOrder(): Promise<void> {
  if (!toolsEnabled()) notFound();
  let msg = '';
  try { await createDemoPaidOrder(); } catch (e) { msg = errText(e); }
  back(msg);
}

export async function issueLink(f: FormData): Promise<void> {
  const { rt, files } = guard();
  let msg = '';
  try { rt.state.lastToken = (await files.issueGrant(demoCtx, field(f, 'itemId'))).token; } catch (e) { msg = errText(e); }
  back(msg);
}

export async function reissueLink(f: FormData): Promise<void> {
  const { rt, files } = guard();
  let msg = '';
  try { rt.state.lastToken = (await files.reissueGrant(demoCtx, field(f, 'itemId'))).token; } catch (e) { msg = errText(e); }
  back(msg);
}

export async function revokeLink(f: FormData): Promise<void> {
  const { files } = guard();
  let msg = '';
  try { await files.revokeGrant(demoCtx, field(f, 'grantId')); } catch (e) { msg = errText(e); }
  back(msg);
}

export async function refundOrder(f: FormData): Promise<void> {
  const { rt } = guard();
  rt.orders.setStatus(field(f, 'orderId'), 'refunded');
  back();
}

/** Proves the tenant wall: another workspace asks for a link to this workspace's order. */
export async function tryOtherTenant(f: FormData): Promise<void> {
  const { files } = guard();
  let msg: string;
  try {
    await files.issueGrant(otherCtx, field(f, 'itemId'));
    msg = 'Unexpected: the other workspace got a link.';
  } catch (e) { msg = `Other workspace: ${errText(e)}`; }
  back(msg);
}
