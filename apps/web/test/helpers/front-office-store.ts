// In-memory stand-in for the front-office RPCs, shared by the scripted Setter tests and the live replay.
import { canTransition } from '../../lib/front-office/state.ts';

/** In-memory stand-in for the fo_* RPCs with the same rules (state machine, opt-out, one pending ladder). */
export function store(state = 'new', messages: { direction: 'inbound' | 'outbound'; body: string }[] = [{ direction: 'inbound', body: 'Hi, saw your ad' }], phone: string | null = '+61411111111') {
  const db = {
    contact: { id: 'c1', name: null as string | null, phone: phone as string | null, email: null as string | null, state, optedOut: false, answers: {} as Record<string, string> },
    messages: messages.map(m => ({ ...m, agent: null as string | null, at: '' })),
    appointment: null as null | { id: string; starts: string; ends: string; status: string },
    handoffs: [] as Record<string, unknown>[], outbound: [] as { message: string; prompt: string }[],
    jobs: [] as { id: string; contact: string; kind: string; step: number; appointment: string | null; due: string; status: string }[],
    states: [state] as string[],
  };
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (fn) {
      case 'fo_contact_context': return structuredClone({ contact: db.contact, messages: db.messages, appointment: db.appointment, handoffs: db.handoffs });
      case 'fo_save_details': Object.assign(db.contact.answers, a.new_answers); if (a.contact_name) db.contact.name = a.contact_name as string; if (a.contact_email) db.contact.email = a.contact_email as string; if (a.contact_phone) db.contact.phone = a.contact_phone as string; return { answers: { ...db.contact.answers }, skipped: [] };
      case 'fo_set_state':
        if (!canTransition(db.contact.state as never, a.new_state as never)) throw new Error(`Contact cannot move from ${db.contact.state} to ${a.new_state}.`);
        db.contact.state = a.new_state as string; db.states.push(db.contact.state); return db.contact.state;
      case 'fo_record_handoff': db.handoffs.push(a.handoff as Record<string, unknown>); return 'h' + db.handoffs.length;
      case 'fo_log_outbound':
        if (db.contact.optedOut) throw new Error('Contact opted out.');
        if (!a.prompt) throw new Error('prompt version required');
        db.outbound.push({ message: a.message as string, prompt: a.prompt as string }); return 'm';
      case 'fo_schedule_job':
        if (a.job_kind === 'follow-up' || a.job_kind === 'no-show-rescue') for (const j of db.jobs) if (j.kind === a.job_kind && j.status === 'pending') j.status = 'cancelled';
        db.jobs.push({ id: 'j' + db.jobs.length, contact: a.contact as string, kind: a.job_kind as string, step: a.job_step as number, appointment: a.appointment as string | null, due: a.due as string, status: 'pending' }); return 'j';
      case 'fo_booking_for_event': return null;
      case 'fo_book':
        if (!canTransition(db.contact.state as never, 'booked')) throw new Error('cannot book');
        db.contact.state = 'booked'; db.states.push('booked');
        db.appointment = { id: 'appt-1', starts: a.starts as string, ends: a.ends as string, status: 'booked' };
        return { appointment: 'appt-1', state: 'booked', duplicate: false };
      case 'fo_claim_jobs': { const due = db.jobs.filter(j => j.status === 'pending' && Date.parse(j.due) <= (a.__now as number ?? Infinity)); due.forEach(j => { j.status = 'running'; }); return due.map(j => ({ ...j })); }
      case 'fo_finish_job': { const j = db.jobs.find(x => x.id === a.job); if (j) j.status = a.outcome as string; return null; }
      default: throw new Error('unknown rpc ' + fn);
    }
  };
  return { db, rpc };
}
