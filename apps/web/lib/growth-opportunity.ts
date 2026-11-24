// Growth Audit opportunity calculator (blueprint §18). Deterministic: the owner's answers and visible, adjustable
// assumptions in, a range out. Never verified revenue; every result says what it was built from.

export type ReplySpeed = 'minutes' | 'hour' | 'same-day' | 'next-day';
export type AuditAnswers = {
  enquiriesPerMonth: number;   // calls + messages + form enquiries in a normal month
  missedPct: number;           // share that never get answered or called back (0-100)
  replySpeed: ReplySpeed;      // typical time to first reply for the ones you do answer
  bookingPct: number;          // of answered enquiries, share that book or buy (0-100)
  averageValue: number;        // average value of one booking or sale, AUD
  noShowPct: number;           // share of bookings that do not turn up (0-100)
};
export type Assumptions = {
  recoverLow: number; recoverHigh: number;   // share of missed enquiries an instant 24/7 reply could still win back
  speedLiftLow: number; speedLiftHigh: number; // relative lift in booking rate when slow replies become instant
  noShowCutLow: number; noShowCutHigh: number; // share of no-shows reminders prevent
};
export type Range = { low: number; high: number };
export type Finding = {
  id: 'missed' | 'speed' | 'no-show';
  title: string; evidence: string; action: string; href: string;
  bookings: Range; value: Range; confidence: 'Low' | 'Medium';
};
export type AuditResult = { findings: Finding[]; total: { bookings: Range; value: Range }; basis: string[] };

export const defaultAssumptions: Assumptions = { recoverLow: 0.2, recoverHigh: 0.5, speedLiftLow: 0.1, speedLiftHigh: 0.25, noShowCutLow: 0.2, noShowCutHigh: 0.4 };
export const blankAnswers: AuditAnswers = { enquiriesPerMonth: 0, missedPct: 0, replySpeed: 'hour', bookingPct: 0, averageValue: 0, noShowPct: 0 };
export const speedLabels: Record<ReplySpeed, string> = { minutes: 'Within a few minutes', hour: 'Within the hour', 'same-day': 'Later the same day', 'next-day': 'The next day or later' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const pct = (n: number) => clamp(n, 0, 100) / 100;
const round = (r: Range): Range => ({ low: Math.round(r.low), high: Math.round(r.high) });

export function validateAnswers(a: AuditAnswers): string[] {
  const issues: string[] = [];
  if (!(a.enquiriesPerMonth > 0) || a.enquiriesPerMonth > 100_000) issues.push('Enter how many enquiries you get in a normal month (1 to 100,000).');
  for (const [k, label] of [['missedPct', 'missed enquiries'], ['bookingPct', 'booking rate'], ['noShowPct', 'no-shows']] as const) if (!(a[k] >= 0 && a[k] <= 100)) issues.push(`The ${label} must be between 0 and 100 percent.`);
  if (!(a.averageValue >= 0) || a.averageValue > 1_000_000) issues.push('Enter the average value of one booking or sale.');
  if (!(a.replySpeed in speedLabels)) issues.push('Choose how quickly you usually reply.');
  return issues;
}

export function validateAssumptions(x: Assumptions): string[] {
  const ok = (lo: number, hi: number) => lo >= 0 && hi <= 1 && lo <= hi;
  return ok(x.recoverLow, x.recoverHigh) && ok(x.speedLiftLow, x.speedLiftHigh) && ok(x.noShowCutLow, x.noShowCutHigh) ? [] : ['Each assumption needs a low value no higher than its high value, between 0 and 100 percent.'];
}

/** The evidence line for a finding, built only from the owner's own answers (never from assumptions or outside data). */
export function findingEvidence(id: Finding['id'], a: AuditAnswers): string {
  const enquiries = clamp(a.enquiriesPerMonth, 0, 100_000), missed = enquiries * pct(a.missedPct);
  const bookingsNow = (enquiries - missed) * pct(a.bookingPct), noShows = bookingsNow * pct(a.noShowPct);
  if (id === 'missed') return `You estimated ${Math.round(missed)} of ${Math.round(enquiries)} enquiries a month go unanswered.`;
  if (id === 'speed') return `You usually reply ${(speedLabels[a.replySpeed] ?? speedLabels.hour).toLowerCase()}. People often book with whoever answers first.`;
  return `About ${Math.round(noShows)} of your ${Math.round(bookingsNow)} monthly bookings are no-shows, from your answers.`;
}

/** Estimated extra bookings and value per month, by problem, largest first. */
export function calculate(a: AuditAnswers, x: Assumptions = defaultAssumptions): AuditResult {
  const enquiries = clamp(a.enquiriesPerMonth, 0, 100_000), value = clamp(a.averageValue, 0, 1_000_000);
  const missed = enquiries * pct(a.missedPct), answered = enquiries - missed, rate = pct(a.bookingPct);
  const money = (b: Range): Range => ({ low: b.low * value, high: b.high * value });
  const findings: Finding[] = [];

  const missedBookings: Range = { low: missed * x.recoverLow * rate, high: missed * x.recoverHigh * rate };
  if (missed > 0 && rate > 0) findings.push({
    id: 'missed', title: 'Missed calls and unanswered enquiries',
    evidence: findingEvidence('missed', a),
    action: 'Switch on the AI Receptionist and AI Setter so every call and message gets an answer, day or night.', href: '/customers/ai-team',
    bookings: missedBookings, value: money(missedBookings), confidence: 'Low',
  });

  const slow = a.replySpeed === 'same-day' || a.replySpeed === 'next-day';
  const speedBookings: Range = slow ? { low: answered * rate * x.speedLiftLow, high: answered * rate * x.speedLiftHigh } : { low: 0, high: 0 };
  if (slow && answered > 0 && rate > 0) findings.push({
    id: 'speed', title: 'Slow first replies',
    evidence: findingEvidence('speed', a),
    action: 'Let the AI Setter answer in seconds and offer real booking times.', href: '/customers/ai-team',
    bookings: speedBookings, value: money(speedBookings), confidence: 'Low',
  });

  const bookingsNow = answered * rate, noShows = bookingsNow * pct(a.noShowPct);
  const showBookings: Range = { low: noShows * x.noShowCutLow, high: noShows * x.noShowCutHigh };
  if (noShows > 0) findings.push({
    id: 'no-show', title: 'Bookings that do not turn up',
    evidence: findingEvidence('no-show', a),
    action: 'Turn on booking reminders (24 hours and 2 hours before) and the no-show rescue message.', href: '/customers/ai-team',
    bookings: showBookings, value: money(showBookings), confidence: 'Medium',
  });

  findings.sort((p, q) => q.value.high - p.value.high || q.bookings.high - p.bookings.high);
  const sum = (f: (r: Finding) => Range): Range => findings.reduce((t, r) => ({ low: t.low + f(r).low, high: t.high + f(r).high }), { low: 0, high: 0 });
  return {
    findings: findings.map(f => ({ ...f, bookings: round(f.bookings), value: round(f.value) })),
    total: { bookings: round(sum(f => f.bookings)), value: round(sum(f => f.value)) },
    basis: [
      'Built only from your answers on this screen. Nothing was connected or scanned.',
      `Assumes an instant reply wins back ${Math.round(x.recoverLow * 100)}–${Math.round(x.recoverHigh * 100)}% of missed enquiries.`,
      `Assumes instant replies lift your booking rate by ${Math.round(x.speedLiftLow * 100)}–${Math.round(x.speedLiftHigh * 100)}% when you usually reply later in the day.`,
      `Assumes reminders prevent ${Math.round(x.noShowCutLow * 100)}–${Math.round(x.noShowCutHigh * 100)}% of no-shows.`,
      'An estimate, not a promise. Measure the real change once your AI team is live.',
    ],
  };
}

// Saved in this browser so the owner can come back to the exact step.
export const opportunityKey = 'ventra.growth-opportunity.v1';
export type SavedAudit = { version: 1; step: number; answers: AuditAnswers; assumptions: Assumptions; updatedAt: string };
export function restoreSavedAudit(raw: string | null): SavedAudit | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedAudit;
    if (v?.version !== 1 || !Number.isInteger(v.step) || v.step < 0 || v.step > 6 || typeof v.updatedAt !== 'string') return null;
    const a = v.answers, x = v.assumptions;
    if (!a || !x || typeof a !== 'object' || typeof x !== 'object') return null;
    const nums = [a.enquiriesPerMonth, a.missedPct, a.bookingPct, a.averageValue, a.noShowPct, x.recoverLow, x.recoverHigh, x.speedLiftLow, x.speedLiftHigh, x.noShowCutLow, x.noShowCutHigh];
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) || !(a.replySpeed in speedLabels) || validateAssumptions(x).length) return null;
    return v;
  } catch { return null; }
}

// The business the audit is about, taken from the saved business profile. Used to brief the AI Setter.
export type AuditBusiness = { name: string; offer: string; area: string; audience: string; industry: string };
type ProfileLike = { name?: unknown; industry?: unknown; location?: unknown; audience?: unknown; expertise?: unknown; primary?: unknown; educationOffer?: unknown; businessType?: unknown };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export function auditBusiness(p: ProfileLike | null | undefined): AuditBusiness {
  const industry = text(p?.industry, 200), expertise = text(p?.expertise, 300);
  const offer = p?.primary === 'education' && expertise ? `${text(p?.educationOffer, 60) || 'Course'}: ${expertise}` : industry || expertise || text(p?.businessType, 60);
  return { name: text(p?.name, 120), offer: offer.slice(0, 400), area: text(p?.location, 200), audience: text(p?.audience, 300), industry };
}

export const aud = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
export const rangeText = (r: Range, format: (n: number) => string = String) => r.low === r.high ? format(r.low) : `${format(r.low)}–${format(r.high)}`;
