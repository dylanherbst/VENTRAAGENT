'use client';
import { useState } from 'react';
import { accountRequest, loadAccountCourses, saveAccountCourse, type AccountCourse } from '../../lib/course-account';
import type { EducationCourseDraftInput } from '../../lib/local-education-course';
import { uuid } from '../../lib/workspace-validation';

export function CourseAccount({input, onLoad}: {input: EducationCourseDraftInput; onLoad: (course: EducationCourseDraftInput) => void}) {
  const [workspaces, setWorkspaces] = useState<{id:string; name:string}[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [courses, setCourses] = useState<AccountCourse[]>([]);
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState<AccountCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect to list your account workspaces. Browser drafts stay separate.');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Account request failed.'); } finally { setBusy(false); }
  }
  return <section aria-label="Account courses"><h2>Account save / load</h2>
    <p><a href="/workspace">Sign in through the account workspace</a>, then connect here. Saving requires workspace owner access.</p>
    <p role="status">{message}</p>
    <fieldset disabled={busy}><legend>Account courses</legend>
      <button onClick={() => void run(async () => {
        const result = await accountRequest('/api/workspace');
        if (!Array.isArray(result.workspaces)) throw new Error('Unable to read workspaces.');
        const next = result.workspaces.map((value: unknown) => {
          if (!value || typeof value !== 'object') throw new Error('Invalid workspace.');
          const item = value as Record<string, unknown>;
          if (typeof item.name !== 'string') throw new Error('Invalid workspace.');
          return {id:uuid(item.id), name:item.name};
        });
        setWorkspaces(next); setWorkspace(''); setCourses([]); setSelected(''); setLoaded(null);
        setMessage(next.length ? 'Choose a workspace, then refresh account courses.' : 'No workspaces available. Create one in the account workspace.');
      })}>Connect account</button>
      <label>Account workspace<select value={workspace} onChange={e => {setWorkspace(e.target.value);setCourses([]);setSelected('');setLoaded(null);setMessage('Refresh account courses for this workspace.');}}><option value="">Choose workspace</option>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <button disabled={!workspace} onClick={() => void run(async () => {
        const next = await loadAccountCourses(workspace); setCourses(next); setSelected('');
        setMessage(`${next.length} account courses found. Load a course to edit its current revision, or save a new copy.`);
      })}>Refresh account courses</button>
      <label>Saved account course<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose course</option>{courses.map(c => <option key={c.id} value={c.id}>{c.course.title} (revision {c.revision})</option>)}</select></label>
      <button disabled={!selected} onClick={() => {
        const item = courses.find(c => c.id === selected);
        if (item && window.confirm('Replace editor content with this account course? Browser storage will not change until you save there.')) {onLoad(structuredClone(item.course));setLoaded(item);setMessage(`Loaded revision ${item.revision}. Review before saving.`);}
      }}>Load account course</button>
      <button disabled={!workspace} onClick={() => void run(async () => {
        const saved = await saveAccountCourse(workspace, {id:crypto.randomUUID(),revision:0,course:input});
        setLoaded(saved);setCourses(current => [...current,saved]);setSelected(saved.id);setMessage('New account copy saved at revision 1. Browser storage is unchanged.');
      })}>Save new account copy</button>
      <button disabled={!workspace || !loaded} onClick={() => void run(async () => {
        if (!loaded) return;
        const saved = await saveAccountCourse(workspace, {...loaded,course:input});
        setLoaded(saved);setCourses(current => [...current.filter(c => c.id !== saved.id),saved]);setMessage(`Account course saved at revision ${saved.revision}. Browser storage is unchanged.`);
      })}>Update loaded account course</button>
    </fieldset>
  </section>;
}
