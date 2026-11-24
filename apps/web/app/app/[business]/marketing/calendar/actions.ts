'use server';
// The one server action this page adds. All checks and the export live in _server/calendar-guard.ts (`runCalendarExport`), which calls
// the campaign-assets service (lib/aimp/campaign-assets/export.ts). The request carries the route's business id and nothing else: the
// workspace comes from the server-side /start contexts and the campaign is looked up on the server for that business. Nothing is posted,
// scheduled or published from here.
import { availability, runtime } from '../../../../start/_server/runtime';
import { marketingContexts } from '../contexts';
import { WENT_WRONG, runCalendarExport } from './_server/calendar-guard';
import type { CalendarExportReply } from './_server/calendar-guard';
import { PUBLISHING_LABEL } from './view-model';

export async function exportCalendarAction(businessId: string): Promise<CalendarExportReply> {
  try {
    return await runCalendarExport({ availability: availability(), rt: runtime, ctx: marketingContexts(), now: () => new Date() }, businessId);
  } catch (e) {
    console.error('[app calendar] export failed:', e instanceof Error ? e.name : 'unknown error');
    return { ok: false, message: WENT_WRONG, file: null, publishing: PUBLISHING_LABEL };
  }
}
