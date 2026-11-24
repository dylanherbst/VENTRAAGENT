export const contactSources = ['website', 'referral', 'social', 'event', 'manual', 'other'] as const;
export type ContactSource = typeof contactSources[number];

export const contactConsentStatuses = ['unknown', 'pending', 'opted_in', 'opted_out'] as const;
export type ContactConsentStatus = typeof contactConsentStatuses[number];

export const contactNotesLimit = 2000;
export const leadFormCaptureQuestionLimit = 3;
export const leadFormCaptureLabelLimit = 120;
export const leadFormCaptureAnswerLimit = 500;

export type LeadFormCaptureAnswer = {
  questionId: string;
  label: string;
  value: string;
};

/** Structured lead-preview answers; kept separate from notes so editor limits are not silently truncated. */
export type LeadFormCapture = {
  formId: string;
  formInternalName: string;
  answers: LeadFormCaptureAnswer[];
};

export type ContactInput = {
  name: string;
  email: string;
  phone: string;
  source: ContactSource;
  consentStatus: ContactConsentStatus;
  /** Optional plain-text notes (lead capture provenance, answers). Never sent externally in this slice. */
  notes: string;
  leadFormCapture?: LeadFormCapture;
};

export type Contact = ContactInput & {
  version: 1;
  id: string;
  profileId: string;
  updatedAt: string;
};

export const contactStorageKey = (profileId: string) => `launchpad.crm-contacts.v1.${profileId}`;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const phonePattern = /^[\d\s()+\-.]{0,32}$/;

export function blankContactInput(): ContactInput {
  return { name: '', email: '', phone: '', source: 'manual', consentStatus: 'unknown', notes: '' };
}

function normalizeLeadFormCapture(value: unknown): LeadFormCapture | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as LeadFormCapture;
  const formId = text(record.formId, 'Lead form ID', 160);
  const formInternalName = text(record.formInternalName, 'Lead form name', 120);
  if (!Array.isArray(record.answers) || record.answers.length > leadFormCaptureQuestionLimit) {
    throw new Error('Invalid lead form capture answers.');
  }
  const answers = record.answers.map((answer, index) => ({
    questionId: text((answer as LeadFormCaptureAnswer).questionId, `Answer ${index + 1} ID`, 160),
    label: text((answer as LeadFormCaptureAnswer).label, `Answer ${index + 1} label`, leadFormCaptureLabelLimit),
    value: text((answer as LeadFormCaptureAnswer).value, `Answer ${index + 1}`, leadFormCaptureAnswerLimit),
  }));
  return { formId, formInternalName, answers };
}

export function editContact(contact: Contact): ContactInput {
  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    source: contact.source,
    consentStatus: contact.consentStatus,
    notes: typeof contact.notes === 'string' ? contact.notes : '',
    leadFormCapture: contact.leadFormCapture,
  };
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved contacts. Nothing was overwritten.');
  }
  return value;
}

function buildContact(
  input: ContactInput,
  identity: Pick<Contact, 'id' | 'profileId'>,
  updatedAt: string,
): Contact {
  const email = text(input.email, 'Email', 254, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email or leave it blank.');
  const phone = text(input.phone, 'Phone', 32, true);
  if (phone && !phonePattern.test(phone)) throw new Error('Phone may use digits, spaces, and + ( ) . - only.');
  if (!(contactSources as readonly unknown[]).includes(input.source)) throw new Error('Choose a contact source.');
  if (!(contactConsentStatuses as readonly unknown[]).includes(input.consentStatus)) throw new Error('Choose a consent status.');
  const notes = text(input.notes, 'Notes', contactNotesLimit, true);
  const leadFormCapture = input.leadFormCapture === undefined
    ? undefined
    : normalizeLeadFormCapture(input.leadFormCapture);
  return {
    version: 1,
    id: text(identity.id, 'Contact ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    name: text(input.name, 'Name', 160),
    email,
    phone,
    source: input.source,
    consentStatus: input.consentStatus,
    notes,
    ...(leadFormCapture ? { leadFormCapture } : {}),
    updatedAt: parseUpdatedAt(updatedAt),
  };
}

export function saveContact(input: ContactInput, identity: Pick<Contact, 'id' | 'profileId'>): Contact {
  return buildContact(input, identity, new Date().toISOString());
}

export function filterContacts(contacts: readonly Contact[], query: string): Contact[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...contacts];
  return contacts.filter(contact => {
    const captureText = contact.leadFormCapture?.answers.map(item => `${item.label} ${item.value}`).join(' ') ?? '';
    const haystack = `${contact.name} ${contact.email} ${contact.phone} ${contact.notes} ${captureText}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function restoreContacts(raw: string | null, profileId: string): Contact[] {
  if (raw === null) return [];
  if (raw.length > 256000) throw new Error('Saved contact data is too large. Nothing was overwritten.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 500) throw new Error('Invalid saved contacts. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const record = value as Contact;
    if (!record || record.version !== 1 || record.profileId !== profileId) {
      throw new Error('Invalid or mismatched saved contacts. Nothing was overwritten.');
    }
    const checked = buildContact(editContact(record), record, parseUpdatedAt(record.updatedAt));
    if (ids.has(checked.id)) throw new Error('Duplicate contact IDs. Nothing was overwritten.');
    ids.add(checked.id);
    return checked;
  });
}

export function persistContact(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  contact: Contact,
): string {
  const key = contactStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Contacts changed in another tab. Your unsaved changes remain; copy them before reloading saved contacts.');
  }
  const existing = restoreContacts(expectedRaw, profileId);
  const checked = restoreContacts(JSON.stringify([contact]), profileId)[0];
  const next = existing.some(item => item.id === checked.id)
    ? existing.map(item => (item.id === checked.id ? checked : item))
    : [...existing, checked];
  if (next.length > 500) throw new Error('This browser supports up to 500 contact drafts.');
  const raw = JSON.stringify(next);
  if (raw.length > 256000) throw new Error('Contact storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
