'use client';
import { useActionState } from 'react';
import { loginAction } from './actions';

export default function Login() {
  const [state, action, pending] = useActionState(loginAction, { error: '' });
  return (
    <main className="sh-login">
      <form action={action} className="sh-card sh-form">
        <div className="sh-brand"><span className="sh-dot" aria-hidden="true" />AiMoneyPrinter Studio</div>
        <p className="sh-muted">Private. Your own brands, agents and AI Setter.</p>
        <label>Password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
        {state.error ? <p className="sh-err" role="alert">{state.error}</p> : null}
        <button className="sh-btn" disabled={pending}>{pending ? 'Checking…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
