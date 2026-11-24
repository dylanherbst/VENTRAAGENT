import { contactConsentStatuses, contactSources } from './local-crm-contacts.ts';
import type { Contact } from './local-crm-contacts.ts';

export const leadRuleFields = ['source', 'consent', 'hasEmail', 'hasPhone', 'noteContains'] as const;
export type LeadRuleField = typeof leadRuleFields[number];
export const leadRuleLimit = 20;
export const leadTextLimit = 100;
export const leadPointsMin = -50;
export const leadPointsMax = 50;

export type LeadRule = {
  id: string;
  field: LeadRuleField;
  /** For source (a contact source) and consent (a consent status). */
  equals?: string;
  /** For noteContains: case-insensitive text found in notes or lead form answers. */
  contains?: string;
  points: number;
};

export type LeadRuleset = {
  version: 1;
  profileId: string;
  rules: LeadRule[];
  hotAt: number;
  warmAt: number;
  revision: number;
  updatedAt: string;
};

export type LeadLabel = 'hot' | 'warm' | 'cold';
export type LeadReason = { ruleId: string; text: string; points: number };
export type LeadScore = { contactId: string; score: number; label: LeadLabel; reasons: LeadReason[] };

export const leadScoringStorageKey = (profileId: string) => `launchpad.lead-scoring.v1.${profileId}`;

export function blankRuleset(profileId: string): LeadRuleset {
  return {
    version: 1,
    profileId,
    rules: [
      { id: 'rule-consent', field: 'consent', equals: 'opted_in', points: 30 },
      { id: 'rule-referral', field: 'source', equals: 'referral', points: 25 },
      { id: 'rule-email', field: 'hasEmail', points: 15 },
      { id: 'rule-phone', field: 'hasPhone', points: 10 },
    ],
    hotAt: 60,
    warmAt: 30,
    revision: 0,
    updatedAt: new Date().toISOString(),
  };
}

const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function validateRuleset(value: unknown, profileId?: string): LeadRuleset {
  const r = value as LeadRuleset;
  if (!r || typeof r !== 'object' || r.version !== 1) throw new Error('Invalid lead scoring rules.');
  if (typeof r.profileId !== 'string' || !r.profileId || (profileId !== undefined && r.profileId !== profileId)) throw new Error('Lead scoring rules belong to a different profile.');
  if (!Array.isArray(r.rules) || r.rules.length > leadRuleLimit) throw new Error(`Use at most ${leadRuleLimit} rules.`);
  if (!Number.isFinite(r.hotAt) || !Number.isFinite(r.warmAt) || r.warmAt >= r.hotAt) throw new Error('The warm score must be lower than the hot score.');
  if (!Number.isSafeInteger(r.revision) || r.revision < 0) throw new Error('Invalid lead scoring revision.');
  if (typeof r.updatedAt !== 'string' || !isoPattern.test(r.updatedAt) || Number.isNaN(Date.parse(r.updatedAt))) throw new Error('Invalid lead scoring timestamp.');
  const ids = new Set<string>();
  const rules = r.rules.map((rule, index): LeadRule => {
    const n = index + 1;
    if (!rule || typeof rule !== 'object') throw new Error(`Rule ${n} is invalid.`);
    if (typeof rule.id !== 'string' || !rule.id || rule.id.length > leadTextLimit || ids.has(rule.id)) throw new Error(`Rule ${n} needs a unique id of ${leadTextLimit} characters or fewer.`);
    ids.add(rule.id);
    if (!(leadRuleFields as readonly unknown[]).includes(rule.field)) throw new Error(`Rule ${n} has an unknown field.`);
    if (!Number.isInteger(rule.points) || rule.points < leadPointsMin || rule.points > leadPointsMax) throw new Error(`Rule ${n} points must be a whole number from ${leadPointsMin} to ${leadPointsMax}.`);
    const out: LeadRule = { id: rule.id, field: rule.field, points: rule.points };
    if (rule.field === 'source' || rule.field === 'consent') {
      const allowed: readonly string[] = rule.field === 'source' ? contactSources : contactConsentStatuses;
      if (typeof rule.equals !== 'string' || !allowed.includes(rule.equals)) throw new Error(`Rule ${n} needs a valid ${rule.field} value.`);
      out.equals = rule.equals;
    } else if (rule.field === 'noteContains') {
      if (typeof rule.contains !== 'string' || !rule.contains.trim() || rule.contains.length > leadTextLimit) throw new Error(`Rule ${n} needs text of 1 to ${leadTextLimit} characters.`);
      out.contains = rule.contains;
    }
    return out;
  });
  return { version: 1, profileId: r.profileId, rules, hotAt: r.hotAt, warmAt: r.warmAt, revision: r.revision, updatedAt: r.updatedAt };
}

function describe(rule: LeadRule): string {
  switch (rule.field) {
    case 'source': return `Source is ${rule.equals}`;
    case 'consent': return `Consent is ${rule.equals}`;
    case 'hasEmail': return 'Has an email address';
    case 'hasPhone': return 'Has a phone number';
    default: return `Notes mention "${rule.contains}"`;
  }
}

function matches(contact: Contact, rule: LeadRule): boolean {
  switch (rule.field) {
    case 'source': return contact.source === rule.equals;
    case 'consent': return contact.consentStatus === rule.equals;
    case 'hasEmail': return contact.email.trim() !== '';
    case 'hasPhone': return contact.phone.trim() !== '';
    default: {
      const capture = contact.leadFormCapture?.answers.map(a => a.value).join(' ') ?? '';
      return `${contact.notes} ${capture}`.toLowerCase().includes((rule.contains ?? '').trim().toLowerCase());
    }
  }
}

export function scoreContact(contact: Contact, ruleset: LeadRuleset): LeadScore {
  const reasons: LeadReason[] = [];
  let score = 0;
  for (const rule of ruleset.rules) {
    if (!matches(contact, rule)) continue;
    score += rule.points;
    reasons.push({ ruleId: rule.id, text: describe(rule), points: rule.points });
  }
  let label: LeadLabel = score >= ruleset.hotAt ? 'hot' : score >= ruleset.warmAt ? 'warm' : 'cold';
  // Consent status "opted_in" is the only granted state; anything else can never be hot.
  if (label === 'hot' && contact.consentStatus !== 'opted_in') {
    label = 'warm';
    reasons.push({ ruleId: 'consent-cap', text: 'Capped at warm because consent is not opted in', points: 0 });
  }
  return { contactId: contact.id, score, label, reasons };
}

export function scoreAll(contacts: readonly Contact[], ruleset: LeadRuleset): LeadScore[] {
  return contacts.map(contact => scoreContact(contact, ruleset));
}

export function restoreRuleset(raw: string | null, profileId: string): LeadRuleset | null {
  if (raw === null) return null;
  if (raw.length > 64000) throw new Error('Saved lead scoring rules are too large. Nothing was overwritten.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved lead scoring rules are not valid. Nothing was overwritten.'); }
  try { return validateRuleset(value, profileId); } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Invalid lead scoring rules.'} Nothing was overwritten.`, { cause: error });
  }
}

export function persistRuleset(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  ruleset: LeadRuleset,
): string {
  const key = leadScoringStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Lead scoring rules changed in another tab. Your unsaved changes remain.');
  const existing = restoreRuleset(expectedRaw, profileId);
  const next = validateRuleset({ ...ruleset, revision: (existing?.revision ?? 0) + 1, updatedAt: new Date().toISOString() }, profileId);
  const raw = JSON.stringify(next);
  storage.setItem(key, raw);
  return raw;
}
