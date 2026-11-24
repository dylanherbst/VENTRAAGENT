import type { ContactConsentStatus, ContactInput, LeadFormCapture } from './local-crm-contacts.ts';
import {
  contactNotesLimit,
  leadFormCaptureLabelLimit,
  leadFormCaptureQuestionLimit,
  persistContact,
  saveContact,
} from './local-crm-contacts.ts';
import type { Contact } from './local-crm-contacts.ts';

export const leadFormCustomQuestionLimit = 3;
export const leadFormQuestionLabelLimit = 120;
export const leadFormAnswerLimit = 500;

export type LeadFormCustomQuestion = {
  id: string;
  label: string;
  required: boolean;
};

export type LeadFormDraftInput = {
  internalName: string;
  headline: string;
  ctaLabel: string;
  showEmail: boolean;
  showPhone: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  questions: LeadFormCustomQuestion[];
};

export type LeadFormDraft = LeadFormDraftInput & {
  version: 1;
  id: string;
  profileId: string;
  updatedAt: string;
};

export type LeadFormPreviewSubmission = {
  name: string;
  email: string;
  phone: string;
  consentGranted: boolean;
  answers: Record<string, string>;
};

export const leadFormStorageKey = (profileId: string) => `launchpad.lead-form-draft.v1.${profileId}`;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved lead form. Nothing was overwritten.');
  }
  return value;
}

function normalizeQuestions(questions: readonly LeadFormCustomQuestion[]): LeadFormCustomQuestion[] {
  if (!Array.isArray(questions) || questions.length > leadFormCustomQuestionLimit) {
    throw new Error(`Add up to ${leadFormCustomQuestionLimit} custom questions.`);
  }
  const ids = new Set<string>();
  return questions.map((question, index) => {
    const id = text(question.id, `Question ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each custom question needs a unique ID.');
    ids.add(id);
    return {
      id,
      label: text(question.label, `Question ${index + 1} label`, leadFormQuestionLabelLimit),
      required: !!question.required,
    };
  });
}

export function normalizeLeadFormDraftInput(input: LeadFormDraftInput): LeadFormDraftInput {
  return {
    ...input,
    requireEmail: input.showEmail && input.requireEmail,
    requirePhone: input.showPhone && input.requirePhone,
  };
}

function buildDraft(input: LeadFormDraftInput, identity: Pick<LeadFormDraft, 'id' | 'profileId'>, updatedAt: string): LeadFormDraft {
  const normalized = normalizeLeadFormDraftInput(input);
  if (!normalized.showEmail && normalized.requireEmail) throw new Error('Email cannot be required when the email field is hidden.');
  if (!normalized.showPhone && normalized.requirePhone) throw new Error('Phone cannot be required when the phone field is hidden.');
  return {
    version: 1,
    id: text(identity.id, 'Form ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    internalName: text(normalized.internalName, 'Form name', 120),
    headline: text(normalized.headline, 'Headline', 200),
    ctaLabel: text(normalized.ctaLabel, 'Button label', 60),
    showEmail: !!normalized.showEmail,
    showPhone: !!normalized.showPhone,
    requireEmail: !!normalized.requireEmail,
    requirePhone: !!normalized.requirePhone,
    questions: normalizeQuestions(normalized.questions),
    updatedAt: parseUpdatedAt(updatedAt),
  };
}

export function blankLeadFormDraftInput(): LeadFormDraftInput {
  return {
    internalName: '',
    headline: '',
    ctaLabel: 'Get in touch',
    showEmail: true,
    showPhone: false,
    requireEmail: true,
    requirePhone: false,
    questions: [],
  };
}

export function editLeadFormDraft(draft: LeadFormDraft): LeadFormDraftInput {
  return {
    internalName: draft.internalName,
    headline: draft.headline,
    ctaLabel: draft.ctaLabel,
    showEmail: draft.showEmail,
    showPhone: draft.showPhone,
    requireEmail: draft.requireEmail,
    requirePhone: draft.requirePhone,
    questions: draft.questions.map(question => ({ ...question })),
  };
}

export function saveLeadFormDraft(input: LeadFormDraftInput, identity: Pick<LeadFormDraft, 'id' | 'profileId'>): LeadFormDraft {
  return buildDraft(input, identity, new Date().toISOString());
}

export function restoreLeadFormDraft(raw: string | null, profileId: string): LeadFormDraft | null {
  if (raw === null) return null;
  if (raw.length > 64000) throw new Error('Saved lead form is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved lead form. Nothing was overwritten.');
  const record = value as LeadFormDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched lead form. Nothing was overwritten.');
  }
  return buildDraft(editLeadFormDraft(record), record, parseUpdatedAt(record.updatedAt));
}

export function persistLeadFormDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: LeadFormDraft,
): string {
  const key = leadFormStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Lead form changed in another tab. Your unsaved changes remain; copy them before reloading the saved form.');
  }
  const checked = restoreLeadFormDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid lead form draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > 64000) throw new Error('Lead form storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}

export function buildLeadFormCapture(form: LeadFormDraft, submission: LeadFormPreviewSubmission): LeadFormCapture {
  if (form.questions.length > leadFormCaptureQuestionLimit) {
    throw new Error(`Add up to ${leadFormCaptureQuestionLimit} custom questions.`);
  }
  const answers = form.questions.map(question => ({
    questionId: question.id,
    label: text(question.label, 'Question label', leadFormCaptureLabelLimit),
    value: text(submission.answers[question.id] ?? '', question.label, leadFormAnswerLimit, true),
  })).filter(item => item.value);
  return {
    formId: form.id,
    formInternalName: form.internalName,
    answers,
  };
}

function leadCaptureProvenanceLines(form: LeadFormDraft): string[] {
  return [
    `Captured via browser-local lead form preview: ${form.internalName} (${form.id}).`,
    'Not a hosted or published submission.',
  ];
}

export function buildLeadCaptureNotes(form: LeadFormDraft, submission: LeadFormPreviewSubmission): string {
  const leadFormCapture = buildLeadFormCapture(form, submission);
  const lines = [...leadCaptureProvenanceLines(form)];
  for (const answer of leadFormCapture.answers) {
    lines.push(`${answer.label}: ${answer.value}`);
  }
  const fullNotes = lines.join('\n');
  if (fullNotes.length <= contactNotesLimit) return fullNotes;
  const compact = [
    ...leadCaptureProvenanceLines(form),
    'Custom answers are stored on this contact record (see structured lead capture).',
  ].join('\n');
  if (compact.length > contactNotesLimit) {
    throw new Error('Lead form metadata is too long for CRM notes. Shorten the internal form name.');
  }
  return compact;
}

/** Full inline notes length before compact provenance fallback (regression tests). */
export function leadCaptureInlineNotesLength(form: LeadFormDraft, submission: LeadFormPreviewSubmission): number {
  const leadFormCapture = buildLeadFormCapture(form, submission);
  const lines = [...leadCaptureProvenanceLines(form)];
  for (const answer of leadFormCapture.answers) {
    lines.push(`${answer.label}: ${answer.value}`);
  }
  return lines.join('\n').length;
}

export function validateLeadPreviewSubmission(form: LeadFormDraft, submission: LeadFormPreviewSubmission): void {
  text(submission.name, 'Name', 160);
  if (!submission.consentGranted) throw new Error('Consent is required before saving this preview lead to CRM contacts.');
  const email = text(submission.email, 'Email', 254, true);
  const phone = text(submission.phone, 'Phone', 32, true);
  if (form.showEmail && form.requireEmail && !email) throw new Error('Email is required for this form.');
  if (form.showPhone && form.requirePhone && !phone) throw new Error('Phone is required for this form.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email or leave it blank.');
  if (phone && !/^[\d\s()+\-.]{0,32}$/.test(phone)) throw new Error('Phone may use digits, spaces, and + ( ) . - only.');
  for (const question of form.questions) {
    const answer = text(submission.answers[question.id] ?? '', question.label, leadFormAnswerLimit, true);
    if (question.required && !answer) throw new Error(`${question.label} is required.`);
  }
}

export function submissionFingerprint(formId: string, submission: LeadFormPreviewSubmission): string {
  const answers = Object.keys(submission.answers)
    .sort()
    .map(key => `${key}:${submission.answers[key] ?? ''}`)
    .join('|');
  return `${formId}:${submission.name}:${submission.email}:${submission.phone}:${submission.consentGranted}:${answers}`;
}

export function leadSubmissionToContactInput(form: LeadFormDraft, submission: LeadFormPreviewSubmission): ContactInput {
  validateLeadPreviewSubmission(form, submission);
  const consentStatus: ContactConsentStatus = submission.consentGranted ? 'opted_in' : 'unknown';
  const leadFormCapture = buildLeadFormCapture(form, submission);
  return {
    name: submission.name.trim(),
    email: form.showEmail ? submission.email.trim() : '',
    phone: form.showPhone ? submission.phone.trim() : '',
    source: 'website',
    consentStatus,
    notes: buildLeadCaptureNotes(form, submission),
    leadFormCapture,
  };
}

export function applyLeadPreviewSubmission(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  contactsExpectedRaw: string | null,
  form: LeadFormDraft,
  submission: LeadFormPreviewSubmission,
  contactId: string,
): { contact: Contact; contactsRaw: string } {
  const input = leadSubmissionToContactInput(form, submission);
  const contact = saveContact(input, { id: contactId, profileId });
  const contactsRaw = persistContact(storage, profileId, contactsExpectedRaw, contact);
  return { contact, contactsRaw };
}
