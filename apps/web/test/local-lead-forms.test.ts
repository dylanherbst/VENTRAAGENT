import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { contactStorageKey, restoreContacts } from '../lib/local-crm-contacts.ts';
import { leadCaptureApiNotConnected } from '../lib/lead-capture-api-contract.ts';
import {
  applyLeadPreviewSubmission,
  blankLeadFormDraftInput,
  leadCaptureInlineNotesLength,
  leadFormStorageKey,
  leadSubmissionToContactInput,
  normalizeLeadFormDraftInput,
  persistLeadFormDraft,
  restoreLeadFormDraft,
  saveLeadFormDraft,
  submissionFingerprint,
} from '../lib/local-lead-forms.ts';
import { contactNotesLimit } from '../lib/local-crm-contacts.ts';

const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const formId = 'form-1';
const identity = { id: formId, profileId: profile.id };

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

const baseInput = {
  ...blankLeadFormDraftInput(),
  internalName: 'Homepage form',
  headline: 'Book a call',
  ctaLabel: 'Send',
  questions: [{ id: 'q1', label: 'What do you need?', required: true }],
};

const form = saveLeadFormDraft(baseInput, identity);

test('save, restore and persist lead form draft with bounded questions', () => {
  assert.throws(() => saveLeadFormDraft({ ...baseInput, internalName: ' ' }, identity));
  const hiddenRequired = saveLeadFormDraft({ ...baseInput, requireEmail: true, showEmail: false }, identity);
  assert.equal(hiddenRequired.requireEmail, false);
  const saved = saveLeadFormDraft(baseInput, identity);
  assert.equal(restoreLeadFormDraft(JSON.stringify(saved), profile.id)?.headline, 'Book a call');
  const storage = fakeStorage();
  const raw = persistLeadFormDraft(storage, profile.id, null, saved);
  assert.equal(storage.getItem(leadFormStorageKey(profile.id)), raw);
  assert.throws(() => persistLeadFormDraft(storage, profile.id, null, saved), /another tab/);
});

test('corrupt or oversized lead form storage fails closed', () => {
  assert.equal(restoreLeadFormDraft(null, profile.id), null);
  for (const raw of ['{', '{}', JSON.stringify({ ...form, profileId: 'other' }), ' '.repeat(70000)]) {
    assert.throws(() => restoreLeadFormDraft(raw, profile.id));
  }
});

test('preview submission converts to CRM contact with website source, consent and provenance notes', () => {
  const submission = {
    name: 'Jamie Lead',
    email: 'jamie@example.test',
    phone: '',
    consentGranted: true,
    answers: { q1: 'Coaching' },
  };
  const input = leadSubmissionToContactInput(form, submission);
  assert.equal(input.source, 'website');
  assert.equal(input.consentStatus, 'opted_in');
  assert.match(input.notes, /browser-local lead form preview/);
  assert.match(input.notes, /Coaching/);
  assert.throws(() => leadSubmissionToContactInput(form, { ...submission, consentGranted: false }));
  assert.throws(() => leadSubmissionToContactInput(form, { ...submission, answers: { q1: '' } }));
});

test('applyLeadPreviewSubmission appends contact without overwriting existing contacts', () => {
  const storage = fakeStorage();
  const existing = applyLeadPreviewSubmission(storage, profile.id, null, form, {
    name: 'First Lead',
    email: 'first@example.test',
    phone: '',
    consentGranted: true,
    answers: { q1: 'A' },
  }, 'contact-a');
  const second = applyLeadPreviewSubmission(storage, profile.id, existing.contactsRaw, form, {
    name: 'Second Lead',
    email: 'second@example.test',
    phone: '',
    consentGranted: true,
    answers: { q1: 'B' },
  }, 'contact-b');
  const contacts = restoreContacts(second.contactsRaw, profile.id);
  assert.equal(contacts.length, 2);
  assert.equal(contacts.find(item => item.id === 'contact-a')?.name, 'First Lead');
  assert.throws(() => applyLeadPreviewSubmission(storage, profile.id, existing.contactsRaw, form, {
    name: 'Stale',
    email: 'stale@example.test',
    phone: '',
    consentGranted: true,
    answers: { q1: 'X' },
  }, 'contact-c'), /another tab/);
  assert.equal(restoreContacts(second.contactsRaw, profile.id).length, 2);
});

test('submission fingerprint is stable for duplicate detection', () => {
  const submission = { name: 'A', email: 'a@test', phone: '', consentGranted: true, answers: { q1: 'x' } };
  const a = submissionFingerprint(formId, submission);
  const b = submissionFingerprint(formId, submission);
  assert.equal(a, b);
  assert.notEqual(a, submissionFingerprint(formId, { ...submission, name: 'B' }));
});

test('lead capture API contract reports not connected', () => {
  const stub = leadCaptureApiNotConnected();
  assert.equal(stub.configured, false);
  assert.match(stub.error, /not connected/i);
  assert.equal(contactStorageKey(profile.id).includes(profile.id), true);
});

test('normalizeLeadFormDraftInput clears required flags when contact fields are hidden', () => {
  const hiddenEmail = normalizeLeadFormDraftInput({
    ...blankLeadFormDraftInput(),
    showEmail: false,
    requireEmail: true,
    showPhone: false,
    requirePhone: true,
  });
  assert.equal(hiddenEmail.requireEmail, false);
  assert.equal(hiddenEmail.requirePhone, false);
  const saved = saveLeadFormDraft({
    ...baseInput,
    showEmail: false,
    requireEmail: true,
    showPhone: true,
    requirePhone: false,
  }, identity);
  assert.equal(saved.requireEmail, false);
});

test('maximum editor-length custom answers are preserved without silent notes truncation', () => {
  const label = 'L'.repeat(120);
  const answer = 'C'.repeat(500);
  const maxForm = saveLeadFormDraft({
    ...baseInput,
    internalName: 'N'.repeat(120),
    questions: [
      { id: 'q1', label, required: true },
      { id: 'q2', label, required: true },
      { id: 'q3', label, required: true },
    ],
  }, { id: formId, profileId: profile.id });
  const submission = {
    name: 'Jamie Lead',
    email: 'jamie@example.test',
    phone: '',
    consentGranted: true,
    answers: { q1: answer, q2: answer, q3: answer },
  };
  assert.ok(leadCaptureInlineNotesLength(maxForm, submission) > contactNotesLimit);
  const input = leadSubmissionToContactInput(maxForm, submission);
  assert.ok(input.notes.length <= contactNotesLimit);
  assert.match(input.notes, /structured lead capture/);
  assert.equal(input.leadFormCapture?.answers.length, 3);
  assert.equal(input.leadFormCapture?.answers[2]?.value, answer);
  const storage = fakeStorage();
  const { contactsRaw } = applyLeadPreviewSubmission(storage, profile.id, null, maxForm, submission, 'contact-max');
  const stored = restoreContacts(contactsRaw, profile.id)[0];
  assert.equal(stored.leadFormCapture?.answers[2]?.value, answer);
});
