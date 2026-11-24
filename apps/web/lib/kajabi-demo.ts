// Local simulation only. Client-side checks are NOT authentication or security.
export type Actor = { tenantId: string; id: string; role: 'owner' | 'editor' | 'learner' | 'anonymous' };
export type Lesson = { id: string; title: string; body: string; included: boolean };
export type Module = { id: string; title: string; lessons: Lesson[] };
export type CourseDraft = { id: string; tenantId: string; title: string; summary: string; archived: boolean; modules: Module[] };
export type CourseVersion = Readonly<{ id: string; tenantId: string; courseId: string; number: number; title: string; summary: string; modules: readonly Readonly<{ id: string; title: string; lessons: readonly Readonly<Lesson>[] }>[] }>;
export type OfferVersion = Readonly<{ id: string; tenantId: string; courseVersionId: string; title: string; summary: string; slug: string; amountMinor: number; currency: string; terms: string; published: boolean }>;
export type Entitlement = { tenantId: string; learnerId: string; courseVersionId: string; active: boolean };
export type Progress = { tenantId: string; learnerId: string; courseVersionId: string; lessonId: string };
const requireValue = (value: string, name: string) => { if (!value.trim()) throw new Error(name + ' is required.'); };
export function staff(actor: Actor, tenantId: string, publish = false) {
  if (actor.tenantId !== tenantId || !(publish ? actor.role === 'owner' : actor.role === 'owner' || actor.role === 'editor')) throw new Error('Staff access denied.');
}
export function validateDraft(draft: CourseDraft) {
  requireValue(draft.title, 'Course title');
  for (const module of draft.modules) { requireValue(module.title, 'Module title'); for (const lesson of module.lessons) requireValue(lesson.title, 'Lesson title'); }
  const ids = draft.modules.flatMap(m => [m.id, ...m.lessons.map(l => l.id)]);
  if (new Set(ids).size !== ids.length) throw new Error('Outline IDs must be unique.');
}
export function saveDraft(actor: Actor, draft: CourseDraft): CourseDraft { staff(actor, draft.tenantId); validateDraft(draft); return structuredClone(draft); }
export function reorder<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = [...items]; const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function publishCourse(actor: Actor, draft: CourseDraft, number: number, reviewed: boolean): CourseVersion {
  staff(actor, draft.tenantId, true); validateDraft(draft);
  if (draft.archived || !reviewed || !Number.isInteger(number) || number < 1) throw new Error('Active course and completed publish review required.');
  const modules = draft.modules.map(m => ({ ...m, lessons: m.lessons.filter(l => l.included).map(l => ({ ...l })) })).filter(m => m.lessons.length);
  if (!modules.length) throw new Error('Include at least one lesson in a module.');
  for (const m of modules) for (const l of m.lessons) requireValue(l.body, 'Included lesson content');
  for (const m of modules) { m.lessons.forEach(Object.freeze); Object.freeze(m.lessons); Object.freeze(m); }
  return Object.freeze({ id: draft.id + '-v' + number, tenantId: draft.tenantId, courseId: draft.id, number, title: draft.title, summary: draft.summary, modules: Object.freeze(modules) });
}
// Validate the raw field before conversion: a cleared price must not become free.
export function parsePriceMinor(raw: string): number {
  const digits = raw.trim();
  if (!/^[0-9]+$/.test(digits)) throw new Error('Enter a nonnegative whole-number price in AUD minor units (0 is allowed).');
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) throw new Error('Price must be a safe integer in AUD minor units.');
  return amount;
}
export function publishOffer(actor: Actor, offer: OfferVersion, versions: readonly CourseVersion[]): OfferVersion {
  staff(actor, offer.tenantId, true);
  for (const field of ['title', 'summary', 'slug', 'terms'] as const) requireValue(offer[field], 'Offer ' + field);
  if (!/^[a-z0-9-]+$/.test(offer.slug) || offer.currency !== 'AUD' || !Number.isSafeInteger(offer.amountMinor) || offer.amountMinor < 0) throw new Error('Use a URL slug, AUD and a nonnegative integer minor-unit price.');
  if (!versions.some(v => v.id === offer.courseVersionId && v.tenantId === offer.tenantId)) throw new Error('Published content in this workspace is required.');
  return Object.freeze({ ...offer, published: true });
}
// Explicit allowlist projection: never spread snapshots or include lesson bodies.
export function publicOffer(offer: OfferVersion, versions: readonly CourseVersion[], tenantId: string) {
  const version = versions.find(v => v.id === offer.courseVersionId && v.tenantId === tenantId);
  if (!offer.published || offer.tenantId !== tenantId || !version) return null;
  return { id: offer.id, title: offer.title, summary: offer.summary, slug: offer.slug, amountMinor: offer.amountMinor, currency: offer.currency, terms: offer.terms, seller: 'Fieldwork Studio (synthetic)', curriculum: version.modules.map(m => ({ title: m.title, lessons: m.lessons.map(l => l.title) })) };
}
export function publishStorefront(actor: Actor, tenantId: string, selected: readonly string[], offers: readonly OfferVersion[], versions: readonly CourseVersion[]): readonly string[] {
  staff(actor, tenantId, true);
  if (selected.some(id => !offers.some(o => o.id === id && publicOffer(o, versions, tenantId)))) throw new Error('Only published workspace offers can be listed.');
  return Object.freeze([...new Set(selected)]);
}
export function storefront(tenantId: string, listed: readonly string[], offers: readonly OfferVersion[], versions: readonly CourseVersion[]) {
  return offers.filter(o => listed.includes(o.id)).flatMap(o => { const safe = publicOffer(o, versions, tenantId); return safe ? [safe] : []; });
}
export function canRead(actor: Actor, version: CourseVersion, grants: readonly Entitlement[]) {
  return actor.tenantId === version.tenantId && actor.role === 'learner' && grants.some(g => g.active && g.tenantId === version.tenantId && g.learnerId === actor.id && g.courseVersionId === version.id);
}
export function readLesson(actor: Actor, version: CourseVersion, lessonId: string, grants: readonly Entitlement[]) {
  if (!canRead(actor, version, grants)) throw new Error('Lesson access denied. Open the offer for details.');
  const lesson = version.modules.flatMap(m => m.lessons).find(l => l.id === lessonId);
  if (!lesson) throw new Error('Lesson not in entitled version.'); return lesson;
}
export function setCompletion(actor: Actor, version: CourseVersion, lessonId: string, grants: readonly Entitlement[], progress: readonly Progress[], complete: boolean): Progress[] {
  readLesson(actor, version, lessonId, grants);
  const next = progress.filter(p => !(p.tenantId === actor.tenantId && p.learnerId === actor.id && p.courseVersionId === version.id && p.lessonId === lessonId));
  return complete ? [...next, { tenantId: actor.tenantId, learnerId: actor.id, courseVersionId: version.id, lessonId }] : next;
}
export function progressCount(actor: Actor, version: CourseVersion, grants: readonly Entitlement[], progress: readonly Progress[]) {
  if (!canRead(actor, version, grants)) throw new Error('Progress access denied.');
  const ids = new Set(version.modules.flatMap(m => m.lessons.map(l => l.id)));
  const completed = new Set(progress.filter(p => p.tenantId === actor.tenantId && p.learnerId === actor.id && p.courseVersionId === version.id && ids.has(p.lessonId)).map(p => p.lessonId)).size;
  return { completed, total: ids.size, percent: ids.size ? Math.round(completed / ids.size * 100) : 0 };
}
// A separate zero-business-data view; navigation does not construct a draft or grant.
export function emptyWorkspaceFixture() {
  return { tenantId: 'empty-studio', courses: [] as CourseDraft[], versions: [] as CourseVersion[], offers: [] as OfferVersion[], listed: [] as string[], grants: [] as Entitlement[] };
}
// Display-only derivation, never a save/publication or authorization decision.
export function creatorSummary(draft: CourseDraft | null, saved: CourseDraft | null, versions: readonly CourseVersion[], offers: readonly OfferVersion[], listed: readonly string[]) {
  const latestCourse = versions.at(-1);
  const publishedOffers = offers.filter(o => o.published);
  const latestOffer = publishedOffers.at(-1);
  return {
    draft: !draft ? 'No course draft' : JSON.stringify(draft) !== JSON.stringify(saved) ? 'Unsaved curriculum changes' : 'No unsaved curriculum changes',
    saved: saved ? 'Saved draft: ' + saved.title + ' (in memory only)' : 'No saved draft',
    course: latestCourse ? 'Published course: v' + latestCourse.number + ' · ' + latestCourse.title : 'No published course version',
    offer: latestOffer ? 'Published offer: ' + latestOffer.title + ' · references ' + latestOffer.courseVersionId : 'No published offer',
    storefront: listed.filter(id => publishedOffers.some(o => o.id === id)).length + ' published storefront listing(s)',
  };
}
export function fixtures() {
  const actors: Actor[] = [{ tenantId: 'fieldwork', id: 'owner', role: 'owner' }, { tenantId: 'fieldwork', id: 'editor', role: 'editor' }, { tenantId: 'fieldwork', id: 'learner-one', role: 'learner' }, { tenantId: 'fieldwork', id: 'learner-two', role: 'learner' }, { tenantId: 'other-studio', id: 'other-owner', role: 'owner' }, { tenantId: 'fieldwork', id: 'visitor', role: 'anonymous' }];
  const draft: CourseDraft = { id: 'small-experiments', tenantId: 'fieldwork', title: 'Make room for a small experiment', summary: 'A practical text course for turning one idea into a useful weekly experiment.', archived: false, modules: [{ id: 'notice', title: 'Notice what matters', lessons: [{ id: 'question', title: 'Choose a question', body: 'Write one question you can explore this week. Keep it small enough to answer through observation, not a major launch.', included: true }, { id: 'signal', title: 'Name a useful signal', body: 'Choose one thing you can notice: a reply, a repeated obstacle, or a clearer next step. Write down why it would matter.', included: true }] }, { id: 'try', title: 'Try and reflect', lessons: [{ id: 'reflect', title: 'Run a gentle review', body: 'Describe what happened without grading yourself. What surprised you? Choose one adjustment for the next experiment.', included: true }] }] };
  const version = publishCourse(actors[0], draft, 1, true);
  const offer: OfferVersion = { id: 'offer-v1', tenantId: 'fieldwork', courseVersionId: version.id, slug: 'small-experiments', title: 'A week of small experiments', summary: draft.summary, amountMinor: 2900, currency: 'AUD', terms: 'Synthetic terms only. No sale or refund transaction is available in this demo.', published: false };
  const grants: Entitlement[] = [{ tenantId: 'fieldwork', learnerId: 'learner-one', courseVersionId: version.id, active: true }, { tenantId: 'other-studio', learnerId: 'learner-two', courseVersionId: version.id, active: true }];
  return { actors, draft, versions: [version], offer, grants };
}
