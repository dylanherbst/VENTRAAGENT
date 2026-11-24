'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appointmentTypeLimit, blackoutLimit, blankBookingPage, bookingPageStorageKey, computeSlots, dayNumber, nameLimit, persistBookingPage, priceNoteLimit, restoreBookingPage, summarizeSlots, validateBookingPage, wallClock, windowLimit } from '../../lib/local-booking-page';
import type { BookingPage } from '../../lib/local-booking-page';
import { offerStorageKey } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function readOffers(profileId: string): { id: string; name: string }[] {
  try {
    const raw = window.localStorage.getItem(offerStorageKey(profileId));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((o): o is { id: string; name: string } => !!o && typeof o.id === 'string' && typeof o.name === 'string') : [];
  } catch { return []; }
}

export default function BookingPageDraft({ profile }: { profile: Pick<Profile, 'id'> }) {
  const profileId = profile.id;
  const [page, setPage] = useState<BookingPage>(() => blankBookingPage(profileId, 'UTC'));
  const [offers, setOffers] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [newBlackout, setNewBlackout] = useState('');
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [nowIso, setNowIso] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    setOffers(readOffers(profileId));
    setNowIso(new Date().toISOString());
    try {
      const raw = window.localStorage.getItem(bookingPageStorageKey(profileId));
      const saved = restoreBookingPage(raw, profileId);
      setPage(saved ?? blankBookingPage(profileId));
      setSelected(saved?.appointmentTypes[0]?.id ?? '');
      rawRef.current = raw; setWritable(true); setError('');
    } catch (e) {
      setPage(blankBookingPage(profileId)); setWritable(false);
      setError(e instanceof Error ? e.message : 'Saved booking page could not be read. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  const check = useMemo(() => validateBookingPage(page), [page]);
  const preview = useMemo(() => {
    if (!ready || !nowIso || check.problems.length || !page.appointmentTypes.some(t => t.id === selected)) return null;
    try { return computeSlots(page, selected, wallClock(nowIso, page.timezone).date, 14, nowIso); } catch { return null; }
  }, [ready, nowIso, check, page, selected]);
  const summary = preview ? summarizeSlots(preview) : null;

  const edit = (next: BookingPage) => { setPage(next); setDirty(true); setStatus(''); };
  function save() {
    try {
      rawRef.current = persistBookingPage(window.localStorage, profileId, rawRef.current, page, new Date().toISOString());
      setPage(restoreBookingPage(rawRef.current, profileId) as BookingPage);
      setDirty(false); setError(''); setStatus('Booking page draft saved in this browser. Nothing is published.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); }
  }
  const patchType = (id: string, patch: Partial<BookingPage['appointmentTypes'][number]>) => edit({ ...page, appointmentTypes: page.appointmentTypes.map(t => (t.id === id ? { ...t, ...patch } : t)) });
  const patchWin = (id: string, patch: Partial<BookingPage['weeklyWindows'][number]>) => edit({ ...page, weeklyWindows: page.weeklyWindows.map(w => (w.id === id ? { ...w, ...patch } : w)) });
  const num = (v: string) => (v === '' ? NaN : Number(v));

  if (!ready) return <p role="status">Loading booking page…</p>;
  return <section aria-labelledby="booking-title" data-testid="booking-page">
    <div className="section-heading">
      <h2 id="booking-title">Booking page draft</h2>
      <span className="status-badge">Browser draft · preview only · no real bookings</span>
    </div>
    <p className="panel-note">Set what you offer and when you are free. The preview shows what a customer would see. No calendar is connected, nobody can book and nothing is published.</p>
    {status && <p role="status" className="activity-status" data-testid="booking-status">{status}</p>}
    {error && <p role="alert" className="error" data-testid="booking-error">{error}</p>}
    <form data-testid="booking-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <fieldset disabled={!writable}>
        <legend>Availability rules</legend>
        <label>Your timezone (IANA name)<input value={page.timezone} data-testid="booking-timezone" onChange={e => edit({ ...page, timezone: e.target.value })} /></label>
        <label>Minimum notice (hours)<input type="number" min={0} max={168} value={Number.isNaN(page.minNoticeHours) ? '' : page.minNoticeHours} data-testid="booking-notice" onChange={e => edit({ ...page, minNoticeHours: num(e.target.value) })} /></label>

        <h3>Appointment types</h3>
        {page.appointmentTypes.length === 0 && <p className="panel-note" data-testid="booking-types-empty">No appointment types yet.</p>}
        {page.appointmentTypes.map((t, i) => <fieldset key={t.id} data-testid="booking-type">
          <legend>Appointment type {i + 1}</legend>
          <label>Name<input value={t.name} maxLength={nameLimit} data-testid="booking-type-name" onChange={e => patchType(t.id, { name: e.target.value })} /></label>
          <label>Duration (minutes)<input type="number" min={5} max={480} step={5} value={Number.isNaN(t.durationMinutes) ? '' : t.durationMinutes} data-testid="booking-type-duration" onChange={e => patchType(t.id, { durationMinutes: num(e.target.value) })} /></label>
          <label>Buffer after (minutes)<input type="number" min={0} max={120} value={Number.isNaN(t.bufferMinutes) ? '' : t.bufferMinutes} data-testid="booking-type-buffer" onChange={e => patchType(t.id, { bufferMinutes: num(e.target.value) })} /></label>
          <label>Price note<input value={t.priceNote} maxLength={priceNoteLimit} onChange={e => patchType(t.id, { priceNote: e.target.value })} /></label>
          <label>Linked offer<select value={t.linkedOfferId ?? ''} onChange={e => patchType(t.id, { linkedOfferId: e.target.value || undefined })}>
            <option value="">Not linked</option>
            {t.linkedOfferId && !offers.some(o => o.id === t.linkedOfferId) && <option value={t.linkedOfferId}>(missing offer)</option>}
            {offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
          <button type="button" onClick={() => edit({ ...page, appointmentTypes: page.appointmentTypes.filter(x => x.id !== t.id) })}>Remove appointment type {i + 1}</button>
        </fieldset>)}
        <button type="button" disabled={page.appointmentTypes.length >= appointmentTypeLimit} data-testid="booking-add-type" onClick={() => { const id = newId(); edit({ ...page, appointmentTypes: [...page.appointmentTypes, { id, name: '', durationMinutes: 30, bufferMinutes: 0, priceNote: '' }] }); if (!selected) setSelected(id); }}>Add appointment type ({page.appointmentTypes.length} of {appointmentTypeLimit})</button>

        <h3>Weekly windows</h3>
        {page.weeklyWindows.length === 0 && <p className="panel-note" data-testid="booking-windows-empty">No weekly windows yet. No slots are open.</p>}
        {page.weeklyWindows.map((w, i) => <fieldset key={w.id} data-testid="booking-window">
          <legend>Window {i + 1}</legend>
          <label>Day<select value={w.weekday} data-testid="booking-window-day" onChange={e => patchWin(w.id, { weekday: Number(e.target.value) })}>{days.map((d, n) => <option key={d} value={n}>{d}</option>)}</select></label>
          <label>From<input type="time" value={w.start} data-testid="booking-window-start" onChange={e => patchWin(w.id, { start: e.target.value })} /></label>
          <label>Until<input type="time" value={w.end} data-testid="booking-window-end" onChange={e => patchWin(w.id, { end: e.target.value })} /></label>
          <button type="button" onClick={() => edit({ ...page, weeklyWindows: page.weeklyWindows.filter(x => x.id !== w.id) })}>Remove window {i + 1}</button>
        </fieldset>)}
        <button type="button" disabled={page.weeklyWindows.length >= windowLimit} data-testid="booking-add-window" onClick={() => edit({ ...page, weeklyWindows: [...page.weeklyWindows, { id: newId(), weekday: 1, start: '09:00', end: '17:00' }] })}>Add window ({page.weeklyWindows.length} of {windowLimit})</button>

        <h3>Blackout dates</h3>
        <ul data-testid="booking-blackouts">{page.blackoutDates.map(d => <li key={d}>{d} <button type="button" onClick={() => edit({ ...page, blackoutDates: page.blackoutDates.filter(x => x !== d) })}>Remove {d}</button></li>)}</ul>
        <label>Add a date off<input type="date" value={newBlackout} data-testid="booking-blackout-input" onChange={e => setNewBlackout(e.target.value)} /></label>
        <button type="button" data-testid="booking-add-blackout" disabled={dayNumber(newBlackout) === null || page.blackoutDates.includes(newBlackout) || page.blackoutDates.length >= blackoutLimit} onClick={() => { edit({ ...page, blackoutDates: [...page.blackoutDates, newBlackout].sort() }); setNewBlackout(''); }}>Add blackout date ({page.blackoutDates.length} of {blackoutLimit})</button>

        {check.problems.length > 0 && <ul role="status" data-testid="booking-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
        {check.warnings.length > 0 && <ul className="panel-note" data-testid="booking-warnings">{check.warnings.map(w => <li key={w}>Note: {w}</li>)}</ul>}
        <button type="submit" className="primary-button" disabled={!writable || !dirty || check.problems.length > 0} data-testid="booking-save">Save booking page draft</button>
      </fieldset>
    </form>

    <h3>Customer preview (next 14 days, {page.timezone})</h3>
    <p className="panel-note">Preview only. Customers cannot see or book these times.</p>
    {page.appointmentTypes.length > 0 && <label>Preview appointment type<select value={selected} data-testid="booking-preview-type" onChange={e => setSelected(e.target.value)}>
      <option value="">Choose a type</option>
      {page.appointmentTypes.map(t => <option key={t.id} value={t.id}>{t.name || '(unnamed)'}</option>)}
    </select></label>}
    {!preview && <p className="panel-note" data-testid="booking-preview-empty">{check.problems.length ? 'Fix the problems above to see the preview.' : 'Add and choose an appointment type to see the preview.'}</p>}
    {preview && summary && <>
      <p data-testid="booking-summary">{summary.totalSlots} open slots across {summary.openDays} of 14 days{summary.blackoutDays ? `, ${summary.blackoutDays} blacked out` : ''}.</p>
      {summary.totalSlots === 0 && <p className="panel-note" data-testid="booking-no-slots">No open slots. Check your windows, notice and appointment length.</p>}
      <ul data-testid="booking-preview">{preview.map(d => <li key={d.date} data-testid="booking-preview-day">
        <strong>{days[d.weekday]} {d.date}</strong>: {d.blackout ? 'Day off' : d.slots.length ? d.slots.join(', ') : 'No slots'}
      </li>)}</ul>
    </>}
  </section>;
}
