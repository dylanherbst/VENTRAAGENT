'use server';
// Runs one simulated call for the Receptionist Test Lab. Everything happens in memory (scripted model, fake store,
// fake calendar, recording senders): no call is placed or answered, nothing is sent, no database or provider is used.
import { fixtureById, fixtures, simulateCall } from '../../../lib/front-office/receptionist/simulate';
import type { SimResult } from '../../../lib/front-office/receptionist/simulate';
import type { ReceptionistLabState } from '../../../lib/front-office/receptionist/lab-live';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import { endCall, liveTurn, startCall } from './live';
import type { LiveCallResult } from './live';

export type LabState = { result: SimResult | null; error: string | null };

// Live AI Test (task A-41): the real model through the A-26 engine (lib/front-office/receptionist/lab-live.ts), with the
// store, calendar and senders sandboxed. Starting and ending a call are free (no model). A turn is paid, so the caller is
// built ONLY from the server-verified Supabase session (lp-access cookie read here); no user id is taken from the browser.
export async function startLiveCall(): Promise<LiveCallResult> {
  return startCall();
}

export async function sendLiveTurn(state: ReceptionistLabState, says: string): Promise<LiveCallResult> {
  return liveTurn(state, says, {
    token: async () => {
      // Imported here so the demo action (and its Node tests) never load next/headers.
      const { cookies } = await import('next/headers');
      return (await cookies()).get('lp-access')?.value;
    },
  });
}

export async function endLiveCall(state: ReceptionistLabState): Promise<LiveCallResult> {
  return endCall(state);
}

export async function getLiveUsage(): Promise<LabUsageToday> {
  return labUsageToday();
}

export async function runLab(_prev: LabState, form: FormData): Promise<LabState> {
  const id = String(form.get('fixture') ?? '');
  const fixture = fixtureById(id) ?? fixtures[0];
  const lines = String(form.get('lines') ?? '').slice(0, 3000).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8);
  try {
    const result = await simulateCall(fixture, {
      liveSwitch: form.get('live') === 'on',
      receptionistOn: form.get('receptionistOn') === 'on',
      transfer: form.get('transfer') === 'on',
      calendar: form.get('calendar') === 'on',
      callerLines: form.get('custom') === 'on' ? lines : [],
    });
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : 'The simulation failed.' };
  }
}
