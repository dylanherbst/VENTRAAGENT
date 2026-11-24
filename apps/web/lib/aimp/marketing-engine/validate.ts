// Validation of model output and briefs. Hand-written (no zod in this repo). Model output that fails is rejected, never repaired into
// something we would show as finished.
import { adFormats, approachInfo, approaches, channelModes, goals, type AdAngle, type Approach, type BrandBrief, type Claim, type StoryboardBeat } from './types.ts';

type J = Record<string, unknown>;
const o = (v: unknown): J | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as J) : null);
const s = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null);
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function checkBrief(raw: unknown): { ok: true; brief: BrandBrief } | { ok: false; errors: string[] } {
  const b = o(raw) ?? {};
  const errors: string[] = [];
  const need = (k: string, label: string, max: number) => { const v = clean(b[k], max); if (!v) errors.push(`Add ${label}.`); return v; };
  const brief: BrandBrief = {
    businessName: need('businessName', 'your business name', 80),
    niche: need('niche', 'your niche', 120),
    offer: need('offer', 'what you sell', 400),
    region: clean(b.region, 80) || 'Australia',
    audience: need('audience', 'who it is for', 300),
    goal: goals.includes(b.goal as never) ? (b.goal as BrandBrief['goal']) : 'leads',
    channel: channelModes.includes(b.channel as never) ? (b.channel as BrandBrief['channel']) : 'organic',
    tone: clean(b.tone, 120) || 'warm, plain, confident',
    facts: (Array.isArray(b.facts) ? b.facts : typeof b.facts === 'string' ? b.facts.split('\n') : []).map((x) => clean(x, 300)).filter(Boolean).slice(0, 20),
    brandColours: (Array.isArray(b.brandColours) ? b.brandColours : []).filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 4),
  };
  return errors.length ? { ok: false, errors } : { ok: true, brief };
}

// Claims we never let through, whatever the brief says.
const BANNED = [
  /(?<!\b(?:not|no|never|without)\b(?:\s+[a-z]+){0,2}\s+)\bguarantee[sd]?\b/i, /\brisk[- ]free\b/i, /\b(make|earn|making|earning)\s+\$?\d[\d,.]*\s*(k|k\+)?\b/i, /\bget rich\b/i, /\bpassive income\b/i,
  /\b(only|just)\s+\d+\s+(left|spots?|places?)\b/i, /\b(ends|expires)\s+(tonight|today|at midnight)\b/i, /\b100x\b|\bto the moon\b/i,
  /\b(crypto|coin)\b.*\b(profit|returns?|gains?)\b/i, /\b(before|after)\s+(and|&)\s+(after|before)\b.*\b(results?|body|weight)\b/i,
];
export const NUMBERISH = /\d[\d,.]*\s*(%|x\b|\+|k\b|clients|customers|bookings|sales|sold|leads|stars|reviews|people|users|members|orders)|\$\s?\d|\b\d{2,}(,\d{3})*\b/i;

/** True when a statement is backed by one of the owner's own facts (shared distinctive words and the same numbers). */
export function backedByFact(text: string, facts: string[]): boolean {
  const nums = (t: string) => (t.match(/\d+(?:[,.]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{5,}/g) ?? []));
  const tn = nums(text), tw = words(text);
  return facts.some((f) => {
    const fn = nums(f), fw = words(f);
    const numsOk = tn.every((n) => fn.includes(n));
    let shared = 0; for (const w of tw) if (fw.has(w)) shared++;
    return numsOk && shared >= 2;
  });
}

/** First banned-claim match in some copy, or null. Shared by every agent (ads and social posts). */
export const bannedClaim = (text: string): string | null => { const r = BANNED.find((x) => x.test(text)); return r ? r.source : null; };

/** Sentences carrying a number or result, each marked verified only when backed by the owner's facts. */
export function claimsIn(texts: string[], facts: string[]): { text: string; status: 'verified' | 'hypothesis' }[] {
  const s = [...new Set(texts.flatMap((t) => t.split(/(?<=[.!?])\s+/)).filter((t) => NUMBERISH.test(t)))];
  return s.map((text) => ({ text, status: backedByFact(text, facts) ? 'verified' as const : 'hypothesis' as const }));
}

export const jaccard = (a: string, b: string): number => {
  const A = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []), B = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
};

export function validateAngles(raw: unknown, brief: BrandBrief, newId: () => string): { ok: true; angles: AdAngle[]; notes: string[] } | { ok: false; errors: string[] } {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    const t = raw.replace(/^```(json)?|```$/g, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    try { v = JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); } catch { return { ok: false, errors: ['The writer did not return JSON.'] }; }
  }
  const root = o(v);
  const list = Array.isArray(root?.angles) ? (root!.angles as unknown[]) : null;
  if (!list || list.length !== 5) return { ok: false, errors: ['Expected exactly 5 angles.'] };
  const errors: string[] = [], notes: string[] = [];
  const angles: AdAngle[] = [];
  const seen = new Set<Approach>();
  for (const [i, item] of list.entries()) {
    const a = o(item);
    if (!a) { errors.push(`Angle ${i + 1} is not an object.`); continue; }
    const approach = a.approach as Approach;
    if (!approaches.includes(approach)) { errors.push(`Angle ${i + 1}: unknown approach.`); continue; }
    if (seen.has(approach)) { errors.push(`Angle ${i + 1}: approach ${approach} used twice.`); continue; }
    seen.add(approach);
    const hook = s(a.hook, 160), primaryCopy = s(a.primary_copy, 700), headline = s(a.headline, 90), cta = s(a.cta, 40), imageBrief = s(a.image_brief, 600);
    if (!hook || !primaryCopy || !headline || !cta || !imageBrief) { errors.push(`Angle ${i + 1}: missing or too-long text.`); continue; }
    const format = adFormats.includes(a.format as never) ? (a.format as AdAngle['format']) : approachInfo[approach].format;
    const beats: StoryboardBeat[] = (Array.isArray(a.storyboard) ? a.storyboard : []).slice(0, 8).map((x) => {
      const b = o(x) ?? {};
      return { atSeconds: typeof b.at_seconds === 'number' ? Math.max(0, Math.min(60, Math.round(b.at_seconds))) : 0, visual: clean(b.visual, 240), overlay: clean(b.overlay, 90), voiceover: clean(b.voiceover, 240) };
    }).filter((b) => b.visual);
    if (format === 'reel_9x16' && (beats.length < 3 || beats[beats.length - 1]!.atSeconds > 35)) { errors.push(`Angle ${i + 1}: a reel needs 3+ storyboard beats within 15 to 30 seconds.`); continue; }
    const all = [hook, primaryCopy, headline, cta, ...beats.flatMap((b) => [b.overlay, b.voiceover])].join(' ');
    const banned = BANNED.find((r) => r.test(all));
    if (banned) { errors.push(`Angle ${i + 1}: contains a claim we never allow (income, guarantee, fake urgency or similar).`); continue; }
    // Claims: the model lists them; we decide the status. Anything with numbers or specific results that isn't backed by the owner's own
    // facts is a hypothesis, whatever the model said.
    const modelClaims = (Array.isArray(a.claims) ? a.claims : []).map((c) => clean(o(c)?.text ?? c, 240)).filter(Boolean).slice(0, 8);
    const sentences = [primaryCopy, headline, hook].flatMap((t) => t.split(/(?<=[.!?])\s+/)).filter((t) => NUMBERISH.test(t));
    const claimTexts = [...new Set([...modelClaims, ...sentences])];
    const claims: Claim[] = claimTexts.map((text) => ({ text, status: backedByFact(text, brief.facts) ? 'verified' : 'hypothesis' }));
    angles.push({
      id: `ang_${newId()}`, approach, format, hook, primaryCopy, headline, cta, imageBrief, storyboard: beats, claims,
      evidenceStatus: claims.some((c) => c.status === 'hypothesis') ? 'needs_validation' : 'verified', editedByOwner: false,
    });
  }
  if (errors.length) return { ok: false, errors };
  for (let i = 0; i < angles.length; i++) for (let j = i + 1; j < angles.length; j++) {
    if (jaccard(`${angles[i]!.hook} ${angles[i]!.headline}`, `${angles[j]!.hook} ${angles[j]!.headline}`) > 0.6) return { ok: false, errors: ['Two angles are too similar.'] };
  }
  if (angles.some((a) => a.evidenceStatus === 'needs_validation')) notes.push('Some claims are hypotheses: check them before publishing.');
  return { ok: true, angles, notes };
}

/** Owner edits: same rules for banned claims; re-checks claim evidence. */
export function applyEdit(angle: AdAngle, edit: unknown, brief: BrandBrief): { ok: true; angle: AdAngle } | { ok: false; errors: string[] } {
  const e = o(edit) ?? {};
  const next: AdAngle = { ...angle, editedByOwner: true };
  for (const [k, max] of [['hook', 160], ['primaryCopy', 700], ['headline', 90], ['cta', 40], ['imageBrief', 600]] as const) {
    if (e[k] !== undefined) { const v = s(e[k], max); if (!v) return { ok: false, errors: [`${k} must be 1 to ${max} characters.`] }; next[k] = v; }
  }
  const all = [next.hook, next.primaryCopy, next.headline, next.cta].join(' ');
  if (BANNED.some((r) => r.test(all))) return { ok: false, errors: ['That wording makes a claim we never allow (income, guarantee, fake urgency or similar).'] };
  const sentences = [next.primaryCopy, next.headline, next.hook].flatMap((t) => t.split(/(?<=[.!?])\s+/)).filter((t) => NUMBERISH.test(t));
  next.claims = [...new Set([...angle.claims.map((c) => c.text).filter((t) => all.includes(t)), ...sentences])].map((text) => ({ text, status: backedByFact(text, brief.facts) ? 'verified' : 'hypothesis' }));
  next.evidenceStatus = next.claims.some((c) => c.status === 'hypothesis') ? 'needs_validation' : 'verified';
  return { ok: true, angle: next };
}
