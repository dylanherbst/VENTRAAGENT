'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GlassButton, GlassIcon, GlassNotice, GlassSelect, GlassTextArea, OnboardingHeader, OnboardingLayout } from '../../design-system/aimp-glass';
import { countries, describeContext, KNOWN_PEOPLE_MAX, languages, loadContext, saveContext, validateContext } from '../../../lib/aimp/onboarding/context';
import type { LaunchContext } from '../../../lib/aimp/onboarding/context';
import { START_DRAFT_KEY, startRoutes } from '../flow';

// One screen, three questions. Answers are saved in this browser (same key as the goals) so ideas and later steps can read them.
const browserZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'; } catch { return 'Australia/Sydney'; } };

export function AboutFlow() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('en');
  const [knownPeople, setKnownPeople] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof LaunchContext, string>>>({});

  useEffect(() => {
    let saved: LaunchContext | null;
    try { saved = loadContext(globalThis.localStorage, START_DRAFT_KEY); } catch { saved = null; }
    if (saved) { setCountry(saved.country); setLanguage(saved.language); setKnownPeople(saved.knownPeople); }
    setReady(true);
  }, []);

  const current = validateContext({ country, language, timezone: browserZone(), knownPeople });
  const notes = current.ok ? describeContext(current.value).notes : [];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = validateContext({ country, language, timezone: browserZone(), knownPeople });
    if (!r.ok) { setErrors(r.errors); return; }
    try { saveContext(globalThis.localStorage, START_DRAFT_KEY, r.value); } catch { /* storage blocked: carry on, the ideas do not need it */ }
    router.push(startRoutes.ideas);
  }

  const header = <OnboardingHeader onBack={() => router.push(startRoutes.goals)} backLabel="Back to your goals" step={3} totalSteps={3} />;
  if (!ready) return <OnboardingLayout align="end" header={header}><p className="plg-lede" role="status">Loading…</p></OnboardingLayout>;

  return (
    <OnboardingLayout
      align="end"
      header={header}
      footer={<GlassButton variant="primary" icon={<GlassIcon name="spark" size={22} tone="deep" />} onClick={() => (document.getElementById('start-about-form') as HTMLFormElement | null)?.requestSubmit()}>See my business ideas</GlassButton>}
    >
      <form id="start-about-form" className="plg-stack" data-gap="4" onSubmit={submit} noValidate>
        <div className="plg-stack" data-gap="2">
          <p className="plg-eyebrow">One more step</p>
          <h1 className="plg-title">A few more details</h1>
        </div>
        <GlassSelect label="Where will you run this from?" name="country" value={country} onChange={(e) => { setCountry(e.target.value); setErrors({}); }} error={errors.country} icon={<GlassIcon name="info" />}>
          <option value="">Choose a country</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </GlassSelect>
        <GlassSelect label="Which language do you want your shop and posts in?" name="language" value={language} onChange={(e) => { setLanguage(e.target.value); setErrors({}); }} error={errors.language} icon={<GlassIcon name="info" />}>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </GlassSelect>
        <GlassTextArea label="Who do you already know how to reach? (optional)" name="knownPeople" value={knownPeople} maxLength={KNOWN_PEOPLE_MAX} showCount rows={3} onChange={(e) => { setKnownPeople(e.target.value); setErrors({}); }} error={errors.knownPeople} hint="For example: a parents' group, 800 Instagram followers, past customers. We use it to suggest where your first buyers could come from." />
        {notes.map((n) => <GlassNotice key={n} tone="info">{n}</GlassNotice>)}
      </form>
    </OnboardingLayout>
  );
}
