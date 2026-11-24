// F08 opt-in capture service (AMP-053 slice 1). Single opt-in. canSendMarketing is the one gate any later sender must call.
import type { EmailAdapter } from '../providers/types.ts';
import { AudienceCapError, AudienceExistsError } from './store.ts';
import type {
  AudienceContext, AudienceStore, CaptureInput, CaptureResult, ChangeResult, ConsentRecord, ConsentSource, Form, FormInput,
  ListFilter, PublicReply, SampleOutcome, SourceInput, Subscriber,
} from './types.ts';

export const MAX_EMAIL = 254;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_SOURCE_FIELD = 100;
export const MAX_WORDING = 1000;

const SHAPE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\.]+$/;

// Control characters (NUL, DEL, newlines) and format characters (zero-width, bidi) are never part of an address.
const CONTROL_OR_FORMAT = /\p{Cc}|\p{Cf}/u;

/** Trim, lowercase, simple shape check, 254 cap. Returns null when it is not an address. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (CONTROL_OR_FORMAT.test(e)) return null;
  if (e.length === 0 || e.length > MAX_EMAIL || !SHAPE.test(e)) return null;
  const [local, domain] = e.split('@');
  if (!local || !domain || local.length > 64 || domain.startsWith('.') || domain.includes('..')) return null;
  return e;
}

/** Lowercase, trimmed, 1 to 30 characters each (longer ones are cut), no duplicates, at most 10. */
export function normaliseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const v = t.replace(/\p{Cc}+/gu, ' ').trim().toLowerCase().slice(0, MAX_TAG_LENGTH).trim();
    if (v.length > 0 && !out.includes(v)) out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const field = (v: unknown): string => (typeof v === 'string' ? v.replace(/\p{Cc}+/gu, ' ').trim().slice(0, MAX_SOURCE_FIELD) : '');

function cleanSource(formId: string, s: SourceInput | undefined): ConsentSource {
  const channel = s?.channel === 'import' || s?.channel === 'manual' ? s.channel : 'store_form';
  return {
    channel, formId: field(formId),
    pageSlug: field(s?.pageSlug), utmSource: field(s?.utmSource), utmMedium: field(s?.utmMedium),
    utmCampaign: field(s?.utmCampaign), utmContent: field(s?.utmContent), utmTerm: field(s?.utmTerm), referrer: field(s?.referrer),
  };
}

export interface AudienceDeps {
  store: AudienceStore;
  email: EmailAdapter;
  now?: () => number;
  newId?: () => string;
  /** Show the "test message from a fixture setup" line in the sample email. On by default; a real adapter must pass false. */
  sampleLabel?: boolean;
}

export const PUBLIC_OK_MESSAGE = 'Thanks. If this address can be added to the list, it will be.';

/**
 * Public-safe reply for any route or form a visitor can reach. Same ok:true text for a new, an already-subscribed and a suppressed
 * address, so the reply never reveals list membership or suppression. Public code must return this and never echo the subscriber.
 */
export function toPublicReply(result: CaptureResult): PublicReply {
  if (result.ok) return { ok: true, message: PUBLIC_OK_MESSAGE };
  if (result.code === 'no_consent' || result.code === 'bad_email') return { ok: false, message: result.message };
  return { ok: false, message: 'This sign-up form is not available right now.' };
}

export type FormResult = { ok: true; form: Form } | { ok: false; message: string };

const BAD_EMAIL = 'That does not look like an email address. Please check it and try again.';
const NO_CONSENT = 'Please tick the box to agree before signing up. Nothing was saved.';
const NO_FORM = 'That sign-up form was not found for this store.';
const NOT_FOUND = 'That email is not on your list.';

const FORM_EXISTS = 'A form with that id already exists.';
const FULL_LIST = 'This list is not taking new sign-ups right now.';
const TOO_MANY_FORMS = 'This business already has the most sign-up forms it can hold.';

/**
 * The checks that need no stored data, in the order captureOptIn runs them. A caller that would create anything first (a form, a record)
 * runs this before, so a refused submit leaves nothing behind. Returns null when the input passes.
 */
export function precheckCapture(input: { consentTicked: unknown; email: unknown }): CaptureResult | null {
  if (input?.consentTicked !== true) return { ok: false, code: 'no_consent', message: NO_CONSENT };
  if (!normaliseEmail(input.email)) return { ok: false, code: 'bad_email', message: BAD_EMAIL };
  return null;
}

export function createAudienceService(deps: AudienceDeps) {
  const { store, email } = deps;
  const now = deps.now ?? (() => Date.now());
  const sampleLabel = deps.sampleLabel !== false;
  let n = 0;
  const newId = deps.newId ?? (() => `aud_${now().toString(36)}_${(++n).toString(36)}`);
  const ok = (ctx: AudienceContext) => typeof ctx?.workspaceId === 'string' && ctx.workspaceId !== '' && typeof ctx.businessId === 'string' && ctx.businessId !== '';

  const consent = (ctx: AudienceContext, sub: Subscriber, decision: 'granted' | 'withdrawn', f: { wordingVersion: number; wordingText: string }, source: ConsentSource): ConsentRecord => ({
    id: newId(), workspaceId: ctx.workspaceId, businessId: ctx.businessId, subscriberId: sub.id, purpose: 'marketing', decision,
    wordingVersion: f.wordingVersion, wordingText: f.wordingText, at: now(), source,
  });

  const wordingOf = async (ctx: AudienceContext, sub: Subscriber) => {
    // A withdrawal records the wording of the latest grant, so the log reads on its own.
    const list = await store.consents(ctx, sub.emailNorm);
    const last = [...list].reverse().find((c) => c.decision === 'granted');
    return { wordingVersion: last?.wordingVersion ?? 0, wordingText: last?.wordingText ?? '', source: last?.source };
  };

  async function createForm(ctx: AudienceContext, input: FormInput): Promise<FormResult> {
    if (!ok(ctx)) return { ok: false, message: NO_FORM };
    const id = field(input.id);
    const text = typeof input.wordingText === 'string' ? input.wordingText.trim().slice(0, MAX_WORDING) : '';
    if (!id || !text) return { ok: false, message: 'A form needs an id and the wording shown next to the tick box.' };
    if (await store.getForm(ctx, id)) return { ok: false, message: FORM_EXISTS };
    const form: Form = {
      id, workspaceId: ctx.workspaceId, businessId: ctx.businessId, storeSlug: field(input.storeSlug), wordingVersion: 1, wordingText: text,
      ...(input.sampleProductId ? { sampleProductId: field(input.sampleProductId) } : {}), tags: normaliseTags(input.tags),
    };
    try {
      // The earlier getForm is only a quick answer; the store re-checks in the same step as the write, so a parallel create cannot overwrite.
      return { ok: true, form: await store.saveForm(form, { create: true }) };
    } catch (e) {
      if (e instanceof AudienceExistsError) return { ok: false, message: FORM_EXISTS };
      if (e instanceof AudienceCapError) return { ok: false, message: TOO_MANY_FORMS };
      throw e;
    }
  }

  /** Changing the wording starts a new wordingVersion. Old consent records keep the version and text they were given under. */
  async function updateForm(ctx: AudienceContext, formId: string, patch: Partial<Omit<FormInput, 'id'>>): Promise<FormResult> {
    const cur = ok(ctx) ? await store.getForm(ctx, formId) : null;
    if (!cur) return { ok: false, message: NO_FORM };
    const next: Form = { ...cur };
    if (typeof patch.wordingText === 'string') {
      const t = patch.wordingText.trim().slice(0, MAX_WORDING);
      if (!t) return { ok: false, message: 'The wording next to the tick box cannot be empty.' };
      if (t !== cur.wordingText) { next.wordingText = t; next.wordingVersion = cur.wordingVersion + 1; }
    }
    if (patch.tags !== undefined) next.tags = normaliseTags(patch.tags);
    if (patch.storeSlug !== undefined) next.storeSlug = field(patch.storeSlug);
    if ('sampleProductId' in patch) {
      if (patch.sampleProductId) next.sampleProductId = field(patch.sampleProductId);
      else delete next.sampleProductId;
    }
    return { ok: true, form: await store.saveForm(next) };
  }

  async function captureOptIn(ctx: AudienceContext, input: CaptureInput): Promise<CaptureResult> {
    if (!ok(ctx)) return { ok: false, code: 'unknown_form', message: NO_FORM };
    const refused = precheckCapture(input ?? { consentTicked: false, email: '' });
    if (refused) return refused;
    const norm = normaliseEmail(input.email) as string;
    const form = await store.getForm(ctx, String(input.formId ?? ''));
    if (!form) return { ok: false, code: 'unknown_form', message: NO_FORM };
    const source = cleanSource(form.id, input.source);
    const display = (input.email as string).trim().slice(0, MAX_EMAIL);

    const cap = typeof input.maxSubscribers === 'number' && Number.isFinite(input.maxSubscribers) ? input.maxSubscribers : undefined;
    let r: { sub: Subscriber; created: boolean; resubscribed: boolean };
    try {
      r = await store.transact<{ sub: Subscriber; created: boolean; resubscribed: boolean }>(ctx, norm, (cur) => {
      const at = now();
      if (!cur) {
        const sub: Subscriber = {
          id: newId(), workspaceId: ctx.workspaceId, businessId: ctx.businessId, storeSlug: form.storeSlug, emailNorm: norm, emailDisplay: display,
          status: 'subscribed', tags: normaliseTags(form.tags), source: source.channel, createdAt: at, updatedAt: at,
        };
        return { next: sub, consent: consent(ctx, sub, 'granted', form, source), value: { sub, created: true, resubscribed: false } };
      }
      if (cur.status === 'unsubscribed') {
        const sub: Subscriber = { ...cur, status: 'subscribed', tags: normaliseTags([...cur.tags, ...form.tags]), updatedAt: at };
        return { next: sub, consent: consent(ctx, sub, 'granted', form, source), value: { sub, created: false, resubscribed: true } };
      }
      // Already subscribed or pending: same record back, no second grant. Suppressed: never revived.
      return { value: { sub: cur, created: false, resubscribed: false } };
      }, cap === undefined ? undefined : { maxSubscribers: cap });
    } catch (e) {
      if (e instanceof AudienceCapError) return { ok: false, code: 'full', message: FULL_LIST };
      throw e;
    }

    let sample: SampleOutcome = 'not_requested';
    if (input.sample) {
      if (!form.sampleProductId) sample = 'no_sample_product';
      else if (r.sub.status !== 'subscribed') sample = 'not_sent';
      else sample = await sendSample(ctx, r.sub, form, field(input.sampleProductTitle));
    }
    return { ok: true, subscriber: r.sub, created: r.created, resubscribed: r.resubscribed, sample };
  }

  async function sendSample(ctx: AudienceContext, sub: Subscriber, form: Form, title: string): Promise<SampleOutcome> {
    const productId = form.sampleProductId as string;
    const store = form.storeSlug || 'the store';
    try {
      await email.send({
        to: sub.emailNorm,
        subject: `Sample (test message) from ${store}`,
        // The internal product id is never printed. No unsubscribe promise: there is no unsubscribe path yet.
        text: [
          'Hi,', '',
          `This is a sample message from ${store}, sent because you asked for the sample when you signed up.`,
          title ? `Sample item: ${title}` : 'Sample item: the free sample you asked for', '',
          ...(sampleLabel ? ['This is a test message from a fixture setup. No real email was delivered and there is no download link in it.'] : []),
          'There is no download link in this message.',
        ].join('\n'),
        idempotencyKey: `sample:${ctx.workspaceId}:${ctx.businessId}:${sub.emailNorm}:${productId}`,
      });
      return 'sent';
    } catch {
      return 'failed';
    }
  }

  async function change(ctx: AudienceContext, raw: string, fn: (cur: Subscriber, at: number) => { next?: Subscriber; withdraw?: boolean }, create?: () => Subscriber): Promise<ChangeResult> {
    const norm = ok(ctx) ? normaliseEmail(raw) : null;
    if (!norm) return { ok: false, code: 'bad_email', message: BAD_EMAIL };
    const prior = await store.get(ctx, norm);
    const last = prior ? await wordingOf(ctx, prior) : null;
    const r = await store.transact(ctx, norm, (cur) => {
      const at = now();
      if (!cur) {
        if (!create) return { value: null as { sub: Subscriber; changed: boolean } | null };
        const sub = { ...create(), emailNorm: norm, emailDisplay: raw.trim().slice(0, MAX_EMAIL), createdAt: at, updatedAt: at };
        return { next: sub, value: { sub, changed: true } };
      }
      const d = fn(cur, at);
      if (!d.next) return { value: { sub: cur, changed: false } };
      const next = { ...d.next, updatedAt: at };
      const rec = d.withdraw
        // A withdrawal is a manual action: it keeps only the grant's form id, not the grant's campaign tags.
        ? consent(ctx, next, 'withdrawn', { wordingVersion: last?.wordingVersion ?? 0, wordingText: last?.wordingText ?? '' }, cleanSource(last?.source?.formId ?? '', { channel: 'manual' }))
        : undefined;
      return { next, ...(rec ? { consent: rec } : {}), value: { sub: next, changed: true } };
    });
    if (!r) return { ok: false, code: 'not_found', message: NOT_FOUND };
    return { ok: true, subscriber: r.sub, changed: r.changed };
  }

  /** Appends a 'withdrawn' record. Idempotent. A suppressed contact stays suppressed. */
  const unsubscribe = (ctx: AudienceContext, rawEmail: string) =>
    change(ctx, rawEmail, (cur) => (cur.status === 'subscribed' || cur.status === 'pending' ? { next: { ...cur, status: 'unsubscribed' }, withdraw: true } : {}));

  /** Blocks all marketing to this address. An unknown address is added as suppressed so it cannot be added later. */
  const suppress = (ctx: AudienceContext, rawEmail: string, reason: string) => {
    const why = field(reason) || 'suppressed';
    return change(
      ctx, rawEmail,
      (cur) => (cur.status === 'suppressed' ? {} : { next: { ...cur, status: 'suppressed', suppressReason: why }, withdraw: cur.status === 'subscribed' || cur.status === 'pending' }),
      () => ({ id: newId(), workspaceId: ctx.workspaceId, businessId: ctx.businessId, storeSlug: '', emailNorm: '', emailDisplay: '', status: 'suppressed', tags: [], source: 'manual', suppressReason: why, createdAt: 0, updatedAt: 0 }),
    );
  };

  const retag = (ctx: AudienceContext, rawEmail: string, tags: string[], add: boolean) => {
    const t = normaliseTags(tags);
    return change(ctx, rawEmail, (cur) => {
      const merged = add ? normaliseTags([...cur.tags, ...t]) : cur.tags.filter((x) => !t.includes(x));
      return merged.length === cur.tags.length && merged.every((x, i) => x === cur.tags[i]) ? {} : { next: { ...cur, tags: merged } };
    });
  };
  const tag = (ctx: AudienceContext, rawEmail: string, tags: string[]) => retag(ctx, rawEmail, tags, true);
  const untag = (ctx: AudienceContext, rawEmail: string, tags: string[]) => retag(ctx, rawEmail, tags, false);

  async function listSubscribers(ctx: AudienceContext, filter: ListFilter = {}): Promise<Subscriber[]> {
    if (!ok(ctx)) return [];
    const want = filter.tag === undefined ? null : normaliseTags([filter.tag])[0] ?? '';
    return (await store.list(ctx))
      .filter((s) => (filter.status ? s.status === filter.status : true) && (want === null ? true : s.tags.includes(want)))
      .sort((a, b) => a.createdAt - b.createdAt || a.emailNorm.localeCompare(b.emailNorm));
  }

  /** The single gate: true only for a known, subscribed contact in this workspace and business. */
  async function canSendMarketing(ctx: AudienceContext, rawEmail: string): Promise<boolean> {
    const norm = ok(ctx) ? normaliseEmail(rawEmail) : null;
    if (!norm) return false;
    return (await store.get(ctx, norm))?.status === 'subscribed';
  }

  async function consentLog(ctx: AudienceContext, rawEmail: string): Promise<ConsentRecord[]> {
    const norm = ok(ctx) ? normaliseEmail(rawEmail) : null;
    return norm ? store.consents(ctx, norm) : [];
  }

  return { createForm, updateForm, getForm: (ctx: AudienceContext, id: string) => store.getForm(ctx, id), captureOptIn, unsubscribe, suppress, tag, untag, listSubscribers, canSendMarketing, consentLog };
}

export type AudienceService = ReturnType<typeof createAudienceService>;
