// In-memory AudienceStore (AMP-053). Key is `ws\0biz\0emailNorm`; every read and write filters on both ids.
// transact runs its callback synchronously, so two captures started together cannot both create the subscriber.
import type { AudienceContext, AudienceStore, ConsentRecord, Form, Subscriber } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

/** Consent records kept per subscriber. At the cap the FIRST record (the original proof of consent) and the newest ones stay; the oldest after the first is dropped. */
export const MAX_CONSENT_RECORDS_PER_SUBSCRIBER = 50;
/** Forms one business may hold. */
export const MAX_FORMS_PER_BUSINESS = 20;

/** Thrown by `saveForm(form, { create: true })` when a form with that id already exists in the business. */
export class AudienceExistsError extends Error {
  constructor() { super('Audience form already exists.'); }
}

/** Thrown by the store when a cap is reached. The service turns it into a plain refusal. */
export class AudienceCapError extends Error {
  readonly kind: 'subscribers' | 'forms';
  constructor(kind: 'subscribers' | 'forms') { super(`Audience cap reached: ${kind}.`); this.kind = kind; }
}

export function createMemoryAudienceStore(): AudienceStore {
  const subs = new Map<string, Subscriber>();
  const consents = new Map<string, ConsentRecord[]>();
  const forms = new Map<string, Form>();
  const subKey = (c: AudienceContext, email: string) => `${c.workspaceId}\u0000${c.businessId}\u0000${email}`;
  const formKey = (c: AudienceContext, id: string) => `${c.workspaceId}\u0000${c.businessId}\u0000${id}`;

  return {
    kind: 'memory',
    async saveForm(form, opts) {
      const k = formKey(form, form.id);
      // Create mode checks and writes in one synchronous step, so of two parallel creates with the same id the second is refused.
      if (opts?.create && forms.has(k)) throw new AudienceExistsError();
      if (!forms.has(k)) {
        // Synchronous count and write: parallel creates cannot overshoot the cap.
        const n = [...forms.values()].filter((f) => f.workspaceId === form.workspaceId && f.businessId === form.businessId).length;
        if (n >= MAX_FORMS_PER_BUSINESS) throw new AudienceCapError('forms');
      }
      forms.set(k, clone(form));
      return clone(form);
    },
    async getForm(ctx, formId) {
      const f = forms.get(formKey(ctx, formId));
      return f && f.workspaceId === ctx.workspaceId && f.businessId === ctx.businessId ? clone(f) : null;
    },
    async get(ctx, emailNorm) {
      const s = subs.get(subKey(ctx, emailNorm));
      return s && s.workspaceId === ctx.workspaceId && s.businessId === ctx.businessId ? clone(s) : null;
    },
    async list(ctx) {
      return [...subs.values()].filter((s) => s.workspaceId === ctx.workspaceId && s.businessId === ctx.businessId).map(clone);
    },
    async consents(ctx, emailNorm) {
      const s = subs.get(subKey(ctx, emailNorm));
      if (!s) return [];
      return (consents.get(s.id) ?? []).filter((c) => c.workspaceId === ctx.workspaceId && c.businessId === ctx.businessId).map(clone);
    },
    async transact(ctx, emailNorm, fn, opts) {
      const k = subKey(ctx, emailNorm);
      const cur = subs.get(k);
      const step = fn(cur ? clone(cur) : null);
      if (step.next) {
        // A NEW subscriber over the cap is refused here, in the same synchronous step as the write.
        if (!cur && opts?.maxSubscribers !== undefined) {
          const n = [...subs.values()].filter((s) => s.workspaceId === ctx.workspaceId && s.businessId === ctx.businessId).length;
          if (n >= opts.maxSubscribers) throw new AudienceCapError('subscribers');
        }
        // The store, not the caller, pins the tenant and the key.
        if (step.next.workspaceId !== ctx.workspaceId || step.next.businessId !== ctx.businessId || step.next.emailNorm !== emailNorm) {
          throw new Error('Subscriber does not match the tenant.');
        }
        subs.set(k, clone(step.next));
      }
      if (step.consent) {
        const s = subs.get(k);
        if (!s || s.id !== step.consent.subscriberId) throw new Error('Consent does not match the subscriber.');
        const list = consents.get(s.id) ?? [];
        // At the cap keep the first record (original proof of consent) and drop the oldest one after it.
        if (list.length >= MAX_CONSENT_RECORDS_PER_SUBSCRIBER) list.splice(1, 1);
        list.push(clone(step.consent));
        consents.set(s.id, list);
      }
      return step.value;
    },
  };
}
