'use client';
import { useEffect, useState } from 'react';
import { checkPrefsRaw, defaultPrefs, notificationPrefsKey, prefKinds, prefLabels, restorePrefs, serializePrefs } from '../../lib/notification-prefs';
import type { NotificationPrefs } from '../../lib/notification-prefs';
import { LauncherAccountSync } from './launcher-account-sync';

// Shared by Settings > Notifications and /tools/notification-prefs. Browser storage is the working copy; the account copy is explicit and revisioned.
export function NotificationPrefsEditor() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    try { const raw = localStorage.getItem(notificationPrefsKey); setSaved(raw); setPrefs(restorePrefs(raw) ?? defaultPrefs()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Saved notification settings cannot be read. Nothing was overwritten.'); }
  }, []);
  function save() {
    if (!prefs) return;
    try {
      // Refuse if another tab changed the stored value since this page loaded.
      if (localStorage.getItem(notificationPrefsKey) !== saved) { setError('Notification settings changed in another tab. Reload before saving.'); return; }
      const raw = serializePrefs({ ...prefs, updatedAt: new Date().toISOString() });
      localStorage.setItem(notificationPrefsKey, raw); setSaved(raw); setError(''); setMessage('Saved in this browser. The notifications list now follows these choices.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  }
  return <section aria-label="Notification settings" data-testid="notification-prefs">
    <h2>Notifications</h2>
    <p>Choose which in-app notices to show. Nothing is emailed or pushed. If a saved list cannot be read you are still told, unless you turned off every notice it feeds.</p>
    {error && <p role="alert" data-testid="notification-prefs-error">{error}</p>}
    {prefs && <fieldset><legend>Show me</legend>
      {prefKinds.map(k => <label key={k}><input type="checkbox" checked={prefs.enabled[k]} onChange={e => { setMessage(''); setPrefs({ ...prefs, enabled: { ...prefs.enabled, [k]: e.target.checked } }); }} /> {prefLabels[k]}</label>)}
      <button type="button" className="v-button" onClick={save}>Save notification settings</button>
    </fieldset>}
    {message && <p role="status" data-testid="notification-prefs-message">{message}</p>}
    {prefs && <LauncherAccountSync kind="notification-prefs" label="Notification settings" readLocal={() => localStorage.getItem(notificationPrefsKey)} validate={checkPrefsRaw} onApply={raw => { localStorage.setItem(notificationPrefsKey, raw); window.location.reload(); }} />}
  </section>;
}
