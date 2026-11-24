'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GlassButton, GlassNotice } from '../design-system/aimp-glass';
import { seedMockCustomerAction } from './actions';

export function SeedButton({ again }: { again: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const go = () => start(async () => {
    setMsg(null);
    try { const r = await seedMockCustomerAction(); if (r.ok) router.refresh(); else setMsg(r.message); }
    catch { setMsg('Something went wrong building the mock customer. Try again.'); }
  });
  return <>
    <GlassButton onClick={go} loading={pending} disabled={pending}>{again ? 'Build a fresh mock customer' : 'Build the mock customer'}</GlassButton>
    {pending ? <p role="status">Building: this takes a few seconds.</p> : null}
    {msg ? <GlassNotice tone="warn" title="Not built"><p>{msg}</p></GlassNotice> : null}
  </>;
}
