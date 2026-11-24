import { followUpState } from './local-lead-followups.ts';
import type { FollowUpList } from './local-lead-followups.ts';
import type { Contact } from './local-crm-contacts.ts';
import { buildPlan } from './onboarding.ts';
import type { Profile } from './onboarding.ts';
import { kindLabel, kindHref } from './draft-registry.ts';
import { UNREADABLE, isUnreadable } from './notifications.ts';
import type { Part } from './notifications.ts';

// Pure, read-only "Today" view. Every item comes from saved data passed in; nothing is invented, sent or changed.
// An unreadable part gives one notice and is never treated as empty. Account state is separate: null means "not checked".
export type TodayInput = {
  todayIso: string; // YYYY-MM-DD, the owner's local date
  profile: Profile | null;
  followups: Part<FollowUpList>;
  contacts: Part<readonly Contact[]>;
  /** Draft kinds that have saved content in this browser. */
  localKinds: Part<readonly string[]>;
  /** Draft kinds that exist in the account, or null when the account could not be checked (signed out, offline). */
  accountKinds: readonly string[] | null;
};
export type TodayKind = 'followup-overdue' | 'followup-today' | 'checklist' | 'not-in-account' | 'unreadable';
export type TodayItem = { id: string; kind: TodayKind; text: string; href: string };
export type TodayView = { items: TodayItem[]; accountChecked: boolean };
export { UNREADABLE };

export function computeToday(input: TodayInput): TodayView {
  const out: TodayItem[] = [];
  const unreadable = (id: string, name: string, href: string) => out.push({ id, kind: 'unreadable', text: `${name} could not be read, so it is not checked. Nothing was changed.`, href });

  if (isUnreadable(input.followups)) unreadable('followups-unreadable', 'The saved follow-ups', '/customers?tab=follow-ups');
  else if (input.followups) {
    const names = new Map<string, string>();
    if (Array.isArray(input.contacts)) for (const c of input.contacts) names.set(c.id, c.name);
    for (const t of input.followups.tasks) {
      const state = followUpState(t, input.todayIso);
      if (state !== 'overdue' && state !== 'due-today') continue;
      const who = names.get(t.contactId);
      const base = `${t.title}${who ? ` (${who})` : ''}`;
      out.push(state === 'overdue'
        ? { id: `followup-${t.id}`, kind: 'followup-overdue', text: `Overdue follow-up: ${base}, due ${t.dueOn}.`, href: '/customers?tab=follow-ups' }
        : { id: `followup-${t.id}`, kind: 'followup-today', text: `Follow-up due today: ${base}.`, href: '/customers?tab=follow-ups' });
    }
  }

  if (input.profile) {
    for (const s of buildPlan(input.profile)) {
      if (!input.profile.completed.includes(s.id)) out.push({ id: `step-${s.id}`, kind: 'checklist', text: `Launch plan step not reviewed yet: ${s.title}.`, href: '/create/start#start-checklist' });
    }
  }

  let accountChecked = false;
  if (isUnreadable(input.localKinds)) unreadable('drafts-unreadable', 'Your saved drafts', '/settings');
  else if (input.accountKinds !== null && input.localKinds) {
    accountChecked = true;
    const inAccount = new Set(input.accountKinds);
    for (const kind of [...input.localKinds].sort()) {
      if (!inAccount.has(kind)) out.push({ id: `account-${kind}`, kind: 'not-in-account', text: `${kindLabel(kind)} is saved only in this browser, not in your account yet.`, href: kindHref(kind) });
    }
  }

  const rank: Record<TodayKind, number> = { 'followup-overdue': 0, 'followup-today': 1, checklist: 2, 'not-in-account': 3, unreadable: 4 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id));
  return { items: out, accountChecked };
}

/** Which registered draft kinds have a saved, non-empty browser copy. Never throws; an unreadable store makes the whole answer unreadable. */
export function localDraftKinds(read: (key: string) => string | null, kinds: readonly { kind: string; key: string }[]): Part<string[]> {
  const found: string[] = [];
  try {
    for (const k of kinds) {
      const raw = read(k.key);
      if (raw === null || raw === '' || raw === '[]') continue;
      found.push(k.kind);
    }
  } catch { return UNREADABLE; }
  return found;
}
