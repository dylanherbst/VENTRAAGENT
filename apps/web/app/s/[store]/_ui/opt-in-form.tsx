'use client';
import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { submitOptInAction, unsubscribeAction } from '../actions';

/** Honest label for the whole block. Same spirit as the Test purchase label: a sample feature, nothing real is sent. */
export const OPT_IN_SAMPLE_LABEL = 'Test feature: sign-ups here are saved in a sample list only. No real email is sent by this store.';

const SEND_FAILED = 'Sorry, that could not be sent. Please try again.';
type Reply ={ ok: boolean; message: string } | null;
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const stack = { display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 440, margin: '1.25rem auto 0', textAlign: 'left' } as const;

function readSource(): Record<string, string> {
  const q = new URLSearchParams(window.location.search);
  const out: Record<string, string> = { referrer: document.referrer.slice(0, 500), pageSlug: window.location.pathname.slice(0, 200) };
  for (const k of UTM) out[k] = (q.get(k) ?? '').slice(0, 200);
  return out;
}

/** Shown only where the Test purchase form is shown (stores published from guided setup). `wording` is the consent line the server stores. */
export function OptInForm({ store, wording }: { store: string; wording: string }) {
  const [reply, setReply] = useState<Reply>(null);
  const [stopReply, setStopReply] = useState<Reply>(null);
  const [joining, startJoin] = useTransition();
  const [stopping, startStop] = useTransition();

  function onJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // The trap field has an odd name so autofill does not target it; it still goes to the server as the `website` key.
    const input = {
      email: String(f.get('email') ?? ''), consentTicked: f.get('consentTicked') === 'on', website: String(f.get('hp_field_x') ?? ''),
      ...readSource(),
    };
    startJoin(async () => {
      try { setReply(await submitOptInAction(store, input)); } catch { setReply({ ok: false, message: SEND_FAILED }); }
    });
  }
  function onStop(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = { email: String(f.get('email') ?? '') };
    startStop(async () => {
      try { setStopReply(await unsubscribeAction(store, input)); } catch { setStopReply({ ok: false, message: SEND_FAILED }); }
    });
  }

  return (
    <section className="st-wrap st-section" aria-labelledby="opt-in-h">
      <div className="st-newsletter">
        <h2 id="opt-in-h">Email updates (test)</h2>
        <p className="st-muted" id="opt-in-label">{OPT_IN_SAMPLE_LABEL}</p>
        <form onSubmit={onJoin} aria-describedby="opt-in-label" style={stack}>
          <div className="st-signup" style={{ margin: 0, maxWidth: 'none' }}>
            <label className="st-sr" htmlFor="opt-in-email">Email address for updates</label>
            <input id="opt-in-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" disabled={joining} />
            <button type="submit" className="st-btn st-btn-primary" disabled={joining}>{joining ? 'Sending...' : 'Sign up'}</button>
          </div>
          <label htmlFor="opt-in-consent" style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
            <input id="opt-in-consent" name="consentTicked" type="checkbox" required disabled={joining} defaultChecked={false} style={{ width: 24, height: 24, flex: 'none', marginTop: 2 }} />
            <span>{wording}</span>
          </label>
          <div className="st-sr" inert>
            <label htmlFor="opt-in-trap">Leave this field empty</label>
            <input id="opt-in-trap" name="hp_field_x" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        </form>
        <p className="st-note" role="status" aria-live="polite">{reply === null ? '' : reply.message}</p>

        <h3 className="st-h3" id="stop-h" style={{ marginTop: '1.5rem' }}>Stop emails</h3>
        <form onSubmit={onStop} aria-labelledby="stop-h" style={stack}>
          <div className="st-signup" style={{ margin: 0, maxWidth: 'none' }}>
            <label className="st-sr" htmlFor="stop-email">Email address to stop emails to</label>
            <input id="stop-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" disabled={stopping} />
            <button type="submit" className="st-btn" disabled={stopping}>{stopping ? 'Sending...' : 'Stop emails'}</button>
          </div>
        </form>
        <p className="st-note" role="status" aria-live="polite">{stopReply === null ? '' : stopReply.message}</p>
      </div>
    </section>
  );
}
