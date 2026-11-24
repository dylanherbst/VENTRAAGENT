'use client';
import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GlassButton, GlassField, GlassNotice } from '../../../design-system/aimp-glass';
import { STEPS, STEP_LABEL } from '../../../../lib/aimp/gaps/analyse';
import type { Coverage, Step } from '../../../../lib/aimp/gaps/analyse';
import { addCompetitorAction, loadExampleAction, removeCompetitorAction } from './actions';

const OPTIONS: { value: Coverage; label: string }[] = [
  { value: 'unknown', label: 'Not checked' }, { value: 'does', label: 'Does it well' }, { value: 'partial', label: 'Only partly' }, { value: 'not_offered', label: 'Does not offer it' },
];

export function CompetitorForm({ business }: { business: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [url, setUrl] = useState(''); const [friction, setFriction] = useState('');
  const [ratings, setRatings] = useState<Partial<Record<Step, Coverage>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    start(async () => {
      try {
        const r = await addCompetitorAction(business, { name, price, ratings, sourceUrl: url, friction });
        if (r.ok) { setName(''); setPrice(''); setUrl(''); setFriction(''); setRatings({}); router.refresh(); } else setMsg(r.message);
      } catch { setMsg('Something went wrong. Nothing was saved.'); }
    });
  }
  return (
    <form onSubmit={submit} data-testid="gap-form">
      <GlassField label="Competitor name" value={name} onChange={(e) => setName(e.target.value)} required />
      <GlassField label="What it costs (optional)" value={price} onChange={(e) => setPrice(e.target.value)} />
      {STEPS.map((s) => (
        <label key={s} style={{ display: 'block', margin: '8px 0' }}>
          <span>{STEP_LABEL[s]}</span>{' '}
          <select value={ratings[s] ?? 'unknown'} onChange={(e) => setRatings({ ...ratings, [s]: e.target.value as Coverage })} aria-label={STEP_LABEL[s]}>
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      <GlassField label="Source link for what you found (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <GlassField label="What goes wrong for their customers (optional)" value={friction} onChange={(e) => setFriction(e.target.value)} />
      <GlassButton type="submit" loading={pending} disabled={pending}>Add competitor</GlassButton>
      {msg ? <GlassNotice tone="warn" title="Not saved"><p>{msg}</p></GlassNotice> : null}
    </form>
  );
}

export function RowButtons({ business, id, example }: { business: string; id?: string; example?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = () => start(async () => {
    try { const r = example ? await loadExampleAction(business) : await removeCompetitorAction(business, id ?? ''); if (r.ok) router.refresh(); else setMsg(r.message); }
    catch { setMsg('Something went wrong.'); }
  });
  return <>
    <GlassButton variant="secondary" onClick={run} loading={pending} disabled={pending}>{example ? 'Load a worked example' : 'Remove'}</GlassButton>
    {msg ? <p role="status">{msg}</p> : null}
  </>;
}
