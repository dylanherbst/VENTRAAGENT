'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GlassButton, GlassField, GlassIcon, GlassNotice, GlassSelect, GlassTextArea, OnboardingHeader, OnboardingLayout } from '../../design-system/aimp-glass';
import { EXISTING_INDUSTRIES, validateExisting, type ExistingErrors } from '../../../lib/aimp/onboarding/existing';
import { startExistingBusinessAction } from './actions';

const browserZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Perth'; } catch { return 'Australia/Perth'; } };

export function ExistingFlow() {
  const router = useRouter();
  const [f, setF] = useState({ businessName: '', industry: '', offer: '', audience: '', website: '' });
  const [errors, setErrors] = useState<ExistingErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const input = { ...f, timezone: browserZone() };
    const v = validateExisting(input);
    if (!v.ok) { setErrors(v.errors); return; }
    setBusy(true); setMessage('');
    try {
      const r = await startExistingBusinessAction(input);
      if (!r.ok) { setErrors(r.errors); setMessage(r.message); return; }
      router.push(`/app/${r.businessId}/home`);
    } catch { setMessage('Something went wrong. Nothing was saved. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <OnboardingLayout
      align="end"
      header={<OnboardingHeader onBack={() => router.push('/start')} backLabel="Back to welcome" />}
      footer={<GlassButton variant="primary" disabled={busy} icon={<GlassIcon name="spark" size={22} tone="deep" />} onClick={() => (document.getElementById('start-existing-form') as HTMLFormElement | null)?.requestSubmit()}>{busy ? 'Setting up…' : 'Open my workspace'}</GlassButton>}
    >
      <form id="start-existing-form" className="plg-stack" data-gap="4" onSubmit={submit} noValidate>
        <div className="plg-stack" data-gap="2">
          <p className="plg-eyebrow">I already have a business</p>
          <h1 className="plg-title">Tell us about your business</h1>
          <p className="plg-lede">Five quick answers. You go straight to your workspace: add products when you want, and use your shop, payments, social posts, ads and inbox.</p>
        </div>
        <GlassField label="Business name" name="businessName" value={f.businessName} onChange={set('businessName')} error={errors.businessName} maxLength={80} autoComplete="organization" required />
        <GlassSelect label="What kind of business is it?" name="industry" value={f.industry} onChange={set('industry')} error={errors.industry}>
          <option value="">Choose the closest match</option>
          {EXISTING_INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </GlassSelect>
        <GlassTextArea label="What do you sell?" name="offer" value={f.offer} onChange={set('offer')} error={errors.offer} maxLength={300} rows={2} hint="For example: lash extensions and lifts, or printable meal planners." />
        <GlassField label="Who are your customers?" name="audience" value={f.audience} onChange={set('audience')} error={errors.audience} maxLength={200} />
        <GlassField label="Website (optional)" name="website" value={f.website} onChange={set('website')} error={errors.website} inputMode="url" autoComplete="url" placeholder="yourbusiness.com.au" />
        {message ? <GlassNotice tone="warn">{message}</GlassNotice> : null}
        <p className="plg-note">Nothing is published, posted or charged until you approve it.</p>
      </form>
    </OnboardingLayout>
  );
}
