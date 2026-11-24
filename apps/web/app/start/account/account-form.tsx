'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Grainient from '../../../components/Grainient';
import { useTheme } from '../../app/[business]/theme-toggle';
import './login-glass.css';
import { site } from '../../../lib/aimp/site-config';
import {
  NETWORK_FAILURE, PASSWORD_MAX, PASSWORD_MIN, authRequestBody, interpretAuthResponse, startRoutes, validateCredentials,
} from '../flow';
import type { AuthMode, AuthOutcome, CredentialErrors } from '../flow';

// Sign-up and sign-in against the real auth endpoint: POST /api/workspace with { action, email, password }.
// The endpoint only accepts same-origin JSON and sets httpOnly session cookies itself; nothing is stored here.
export function AccountForm({ initialMode }: { initialMode: AuthMode }) {
  const router = useRouter();
  const dark = useTheme() === 'dark';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  // Preview/demo default (14 Nov, owner request): pre-filled so a phone tester can tap through without typing.
  // Harmless either way -- if accounts aren't connected on this preview, submitting just shows "not connected"
  // and offers Continue without an account, same as leaving these blank.
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('PreviewDemo2026!');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const signup = mode === 'signup';

  function switchMode(next: AuthMode) {
    setMode(next);
    setErrors({});
    setOutcome(null);
    emailRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setOutcome(null);
    const checked = validateCredentials(email, password, mode);
    if (!checked.ok) {
      setErrors(checked.errors);
      (checked.errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    let result: AuthOutcome;
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: authRequestBody(mode, checked.email, checked.password),
      });
      let body: unknown = null;
      try { body = await res.json(); } catch { body = null; }
      result = interpretAuthResponse(res.status, body, mode);
    } catch {
      result = NETWORK_FAILURE;
    }
    if (result.kind === 'signed-in') {
      router.push(startRoutes.tour);
      return; // stay busy until the next screen replaces this one
    }
    setBusy(false);
    setOutcome(result);
    if (result.kind === 'confirm-email') { setMode('login'); setPassword(''); }
    queueMicrotask(() => noticeRef.current?.focus());
  }

  return (
    <main className="lg-screen">
      <div className="lg-bg" aria-hidden="true">
        <Grainient colors={dark ? ['#3b0f7a', '#6d28d9', '#150d26', '#0a0712', '#0a0712'] : ['#9529fa', '#c990ff', '#f8f6fa', '#ffffff', '#ffffff']} angle={55} flow={0.8} silk={0.35} grainAmount={0.08} speed={1.45} />
      </div>
      <section className="lg-card" aria-labelledby="lg-title">
        <div className="lg-window" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aimp-logo.png" alt="" width={132} height={132} />
        </div>
        <p className="lg-eyebrow">{signup ? 'new here' : 'welcome back'}</p>
        <h1 id="lg-title" className="lg-title">{signup ? 'Join' : 'Sign in'}</h1>
        <p className="lg-sub">{signup ? site.name : `to ${site.name}`}</p>

        {outcome ? (
          <div ref={noticeRef} tabIndex={-1} className="lg-notice" data-kind={outcome.kind} role={outcome.kind === 'confirm-email' ? 'status' : 'alert'}>
            <p>{outcome.message}</p>
            {outcome.kind === 'not-connected' ? <p><Link href={startRoutes.tour}>Continue without an account</Link></p> : null}
          </div>
        ) : null}

        <form className="lg-form" onSubmit={submit} noValidate>
          <label className="lg-field">
            <span className="lg-label">Email</span>
            <input
              ref={emailRef} name="email" type="email" inputMode="email" autoComplete={signup ? 'email' : 'username'} autoCapitalize="none" autoCorrect="off"
              spellCheck={false} required maxLength={254} placeholder="you@example.com" value={email} aria-invalid={errors.email ? true : undefined}
              onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }}
            />
            {errors.email ? <span className="lg-error" role="alert">{errors.email}</span> : null}
          </label>
          <label className="lg-field">
            <span className="lg-label">Password</span>
            <span className="lg-pw">
              <input
                ref={passwordRef} name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required
                minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} placeholder="Password" value={password} aria-invalid={errors.password ? true : undefined}
                onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((x) => ({ ...x, password: undefined })); }}
              />
              <button type="button" className="lg-eye" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
            {errors.password ? <span className="lg-error" role="alert">{errors.password}</span> : signup ? <span className="lg-hint">At least {PASSWORD_MIN} characters.</span> : null}
          </label>
          <button type="submit" className="lg-primary" disabled={busy} aria-busy={busy}>
            {busy ? (signup ? 'Creating your account…' : 'Signing you in…') : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="lg-caption">
          {signup ? 'Already have an account?' : 'New here?'}{' '}
          <button type="button" onClick={() => switchMode(signup ? 'login' : 'signup')}>{signup ? 'Sign in' : 'Create an account'}</button>
        </p>
        {/* Owner request 14 Nov: an obvious way past sign-in. Nothing is created; answers stay on this device. */}
        <button type="button" className="lg-skip" onClick={() => router.push(startRoutes.tour)}>Continue without an account</button>
      </section>
    </main>
  );
}
