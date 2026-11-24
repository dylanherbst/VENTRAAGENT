'use client';
// Campaign calendar (screen 27, draft and export only) on the Peach & Lavender glass library. Everything shown is read on the server
// from the campaign and campaign-assets services. The one action, saving the approved text as a ZIP file, runs through
// `exportCalendarAction` with the route's business id and nothing else. Publishing is not connected: nothing here posts anything.
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassKeyValue, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { exportCalendarAction } from './actions';
import { BY_HAND, NOTHING_POSTED, PUBLISHING_LABEL, PUBLISHING_NOTE, PUBLISHING_TEXT, countsLine, entriesLabel, exportHint } from './view-model';
import type { CalendarDay, CalendarModel, EntryState } from './view-model';

const UNREACHABLE = 'We could not reach the server, so no file was made. Try again.';
const SAVE_FAILED = 'The file was made, but your browser could not save it to this device. Nothing was posted. Try again, or check that downloads are allowed on this site.';
const TONE: Readonly<Record<EntryState, 'neutral' | 'success' | 'warn'>> = { plan_draft: 'neutral', not_written: 'neutral', draft: 'neutral', approved: 'success', rejected: 'warn' };

/** Hand the ZIP file to the browser as a download. Nothing leaves the device. */
function saveFile(file: { name: string; base64: string }) {
  const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DayCard({ day }: { day: CalendarDay }) {
  return (
    <li>
      <GlassCard heading="h3" eyebrow={`Day ${day.day}`} title={day.dateLabel} data-testid="calendar-day">
        <ul className="acal-entries">
          {day.entries.map((e) => (
            <li key={e.id} className="acal-entry" data-testid="calendar-entry" data-state={e.state}>
              <p className="acal-entry-title">{e.what} · {e.productTitle}</p>
              <p className="plg-text">{e.hook}</p>
              <div className="acal-badges">
                <GlassBadge>{e.channelLabel}</GlassBadge>
                <GlassBadge tone={TONE[e.state]} dot>{e.stateLabel}</GlassBadge>
              </div>
              <p className="plg-note">{BY_HAND}</p>
            </li>
          ))}
        </ul>
      </GlassCard>
    </li>
  );
}

export function CalendarView({ businessId, model }: { businessId: string; model: CalendarModel }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; files: string[] } | null>(null);
  const busyRef = useRef(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const marketing = `/app/${businessId}/marketing`;
  const creative = `${marketing}/creative`;

  async function exportNow() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    let reply: Awaited<ReturnType<typeof exportCalendarAction>> | null = null;
    try {
      reply = await exportCalendarAction(businessId);
    } catch { setNotice({ ok: false, text: UNREACHABLE, files: [] }); }
    if (reply) {
      const r = reply;
      // AMP-161: a failure to save the file on this device is its own message, not the server's.
      let saved = true;
      if (r.ok && r.file) { try { saveFile(r.file); } catch { saved = false; } }
      if (!saved) setNotice({ ok: false, text: SAVE_FAILED, files: [] });
      else setNotice({ ok: r.ok && r.file !== null, text: r.message || 'That did not go through, so nothing was saved.', files: r.file?.files ?? [] });
    }
    busyRef.current = false; setBusy(false);
    // The button is disabled while the file is made, so keyboard focus would be lost: put it on the export area, which the result sits next to.
    // AMP-161: only when focus is still lost (on the page itself or on the export button). If the owner has moved on, focus stays where they put it.
    requestAnimationFrame(() => {
      const el = document.activeElement;
      const lost = !el || el === document.body || el === document.documentElement || focusRef.current?.contains(el);
      if (lost) focusRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <AppLayout width="wide">
      <AppIntro title="Campaign calendar" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>The suggested day for each piece of your marketing plan, and where each one stands.</p>
        <p className="plg-note" data-testid="honesty-note">{NOTHING_POSTED} Demo storage on the server: your plan is kept in memory and is lost when the server restarts.</p>
        <Link href={marketing} className="plg-link acal-link" data-target="large" data-testid="back-to-marketing">Back to Marketing</Link>
      </AppIntro>
      <GlassNotice tone="info" title="Your social post calendar is in AI Team"><p>The week and month calendar for your social posts, with approvals, is in <a href={`/app/${businessId}/ai-team`}>AI Team</a>. This page keeps the campaign plan and the text export.</p></GlassNotice>

      {/* The one place the result is announced (polite, once). It stays on the page, so a change of text is what gets read; the visible notice below is not live. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="acal-live" data-testid="export-status">{notice ? notice.text : ''}</p>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} live="none" title={notice.text} data-testid={notice.ok ? 'export-done' : 'export-refused'}>
          {notice.files.length ? (
            <>
              <p>In the file:</p>
              <ul className="plg-list">{notice.files.map((f) => <li key={f}>{f}</li>)}</ul>
            </>
          ) : null}
        </GlassNotice>
      ) : null}

      {model.state === 'no_plan' ? (
        <GlassState kind="empty" title="You do not have a marketing plan yet" data-testid="no-plan" action={<GlassButton variant="primary" href={marketing}>Go to Marketing</GlassButton>}>
          <p>The calendar shows the days from your marketing plan. Create a plan on the Marketing page, then come back here.</p>
        </GlassState>
      ) : (
        <>
          <GlassCard heading="h2" highlighted eyebrow={`Plan version ${model.version} · ${model.planStatus === 'approved' ? 'Approved' : 'Draft'}`} title={model.windowLabel} data-testid="calendar-summary">
            <p className="plg-text">{countsLine(model.counts)}</p>
            <p className="plg-note">{model.windowDays} days in the plan, {model.days.length} with something on them and {model.quietDays} quiet. Days are calendar days in UTC.</p>
          </GlassCard>

          <div className="acal-side">
            <GlassCard heading="h2" title="Publishing" badges={<GlassBadge tone="neutral" dot data-testid="publishing-state">{PUBLISHING_LABEL}</GlassBadge>} data-testid="publishing">
              <p className="plg-text">{PUBLISHING_TEXT}</p>
              <GlassKeyValue items={model.channels.map((c) => ({ label: c.label, value: c.publishing }))} />
              <p className="plg-note" data-testid="publishing-note">{PUBLISHING_NOTE}</p>
            </GlassCard>

            <GlassCard heading="h2" title="Save your approved text" data-testid="export">
              <p className="plg-text" data-testid="export-hint">{exportHint(model)}</p>
              <div className="acal-actions acal-focus-target" ref={focusRef} tabIndex={-1} role="group" aria-label="Save your approved text" data-testid="export-actions">
                {model.exportable > 0 ? (
                  <GlassButton variant="primary" onClick={() => { void exportNow(); }} loading={busy} loadingLabel="Making your file…" disabled={busy} data-testid="export-button">Save as a ZIP file</GlassButton>
                ) : null}
                <GlassButton variant="secondary" href={model.drafts === 'plan_draft' ? marketing : creative}>{model.drafts === 'plan_draft' ? 'Go to Marketing' : 'Open Creative Studio'}</GlassButton>
              </div>
            </GlassCard>
          </div>

          <section aria-labelledby="acal-days-title" className="acal-schedule">
            <h2 id="acal-days-title" className="plg-card-title">Day by day</h2>
            {model.days.length ? (
              <ol className="acal-days" data-testid="calendar-days">
                {model.days.map((d) => <DayCard key={d.date} day={d} />)}
              </ol>
            ) : (
              <p className="plg-text">This plan has nothing on any day. Make a new draft on the Marketing page.</p>
            )}
            <p className="plg-note">{entriesLabel(model.days.reduce((n, d) => n + d.entries.length, 0))} in all. {NOTHING_POSTED}</p>
          </section>
        </>
      )}
    </AppLayout>
  );
}
