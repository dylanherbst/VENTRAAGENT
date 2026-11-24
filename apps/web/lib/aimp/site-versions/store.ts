// Site versions (AMP-031): one private, editable DRAFT per store plus an append-only list of immutable PUBLISHED versions.
//
// Rules this module enforces (and the tests prove):
//  - Draft changes never reach the public resolver. Only publish (or rollback) creates something the public can see.
//  - Publish and rollback are all-or-nothing. If validation or any step fails, nothing changes and the previous
//    published version keeps serving.
//  - Published snapshots are deep-frozen copies. Later draft edits can not change them.
//  - Every management call is scoped to a workspace. Another workspace's call is denied and changes nothing.
//
// Field names follow public.site_versions (version, config, status, published_at). This is the in-memory
// implementation used by tests and the demo page; a database-backed store implements the same SiteVersionStore interface.
import { isClaimableStoreSlug } from '../storefront/tenant.ts';
import { renderConfig, type RenderConfig } from '../storefront/render-config.ts';
import { STORE_SLUG_MESSAGE, validateStoreConfig, type StoreConfig, type ValidationResult } from '../storefront/schema.ts';
import { plainErrors } from './messages.ts';

export interface Actor { workspaceId: string; userId: string }

export type FailCode = 'invalid' | 'denied' | 'not_found' | 'conflict' | 'failed';
export type Result<T> = { ok: true; value: T } | { ok: false; code: FailCode; errors: string[] };

export type VersionSource = { kind: 'publish' } | { kind: 'rollback'; fromVersion: number };
export interface VersionSummary {
  version: number; publishedAt: string; publishedBy: string; note: string; source: VersionSource;
  /** AMP-145: present and true only when this version passed its publish check (recorded through `markChecked`). Absent means not recorded. */
  checkedOk?: true;
}
/** `config` is a deep-frozen snapshot: assigning to it (in strict mode) throws. */
export interface PublishedVersion extends VersionSummary { config: StoreConfig }

export interface DraftView {
  slug: string;
  config: StoreConfig;
  /** Increases on every accepted edit. Pass it as expectedRevision to publish what you previewed. */
  revision: number;
  updatedAt: string;
  liveVersion: number | null;
  paused: boolean;
  hasUnpublishedChanges: boolean;
}

export type SiteEvent = { at: string; by: string; kind: 'publish' | 'rollback' | 'pause' | 'unpause'; version?: number; note?: string };
export interface HistoryView { versions: VersionSummary[]; events: SiteEvent[]; liveVersion: number | null; paused: boolean }

export interface DraftPreview { config: StoreConfig; render: RenderConfig; revision: number }

/** What the public storefront gets. Nothing about drafts is ever included. */
export type PublicResolution =
  | { status: 'live'; version: number; publishedAt: string; config: StoreConfig }
  | { status: 'paused' }
  | { status: 'none' };

export interface CommitInfo { kind: 'publish' | 'rollback'; slug: string; version: number }
export interface SiteVersionStoreOptions {
  now?: () => Date;
  /** Replace the validator (tests use this to simulate stricter rules). Defaults to the storefront validator. */
  validate?: (input: unknown) => ValidationResult;
  /**
   * A step that must succeed before a version goes live (for example copying files or clearing a cache).
   * If it throws or rejects, the publish or rollback is abandoned and nothing changes.
   */
  beforeCommit?: (candidate: StoreConfig, info: CommitInfo) => void | Promise<void>;
}

export interface SiteVersionStore {
  readonly kind: 'memory';
  listSites(actor: Actor): Promise<Result<string[]>>;
  createSite(actor: Actor, config: StoreConfig): Promise<Result<DraftView>>;
  getDraft(actor: Actor, slug: string): Promise<Result<DraftView>>;
  editDraft(actor: Actor, slug: string, change: (draft: StoreConfig) => StoreConfig | void, opts?: { expectedRevision?: number }): Promise<Result<DraftView>>;
  previewDraft(actor: Actor, slug: string): Promise<Result<DraftPreview>>;
  /** If the draft equals the live version nothing is published: the live summary comes back with `unchanged: true`. */
  publish(actor: Actor, slug: string, opts?: { note?: string; expectedRevision?: number }): Promise<Result<VersionSummary & { unchanged?: true }>>;
  /** `expectedLive` (AMP-145): compare-and-set. If a different version is live (or none), nothing changes and the result is `conflict`. */
  pause(actor: Actor, slug: string, opts?: { expectedLive?: number }): Promise<Result<{ paused: boolean }>>;
  unpause(actor: Actor, slug: string): Promise<Result<{ paused: boolean }>>;
  /** `expectedLive` (AMP-145): compare-and-set. If a different version is live, nothing changes and the result is `conflict`. */
  rollback(actor: Actor, slug: string, toVersion: number, opts?: { note?: string; expectedLive?: number }): Promise<Result<VersionSummary>>;
  /**
   * AMP-145: record that `version` passed its publish check. Stored per version, so it survives a new caller or a restart of
   * whatever holds the publish-check state. Idempotent. The flag then shows as `checkedOk` on history/publish summaries.
   * A database-backed store needs a column for it (see D03); until it exists it may answer `failed` and callers carry on.
   */
  markChecked(actor: Actor, slug: string, version: number): Promise<Result<{ version: number; checkedOk: true }>>;
  history(actor: Actor, slug: string): Promise<Result<HistoryView>>;
  getVersion(actor: Actor, slug: string, version: number): Promise<Result<PublishedVersion>>;
  /** Public. Takes no actor and can only ever see live published snapshots. */
  resolvePublished(slug: string): Promise<PublicResolution>;
}

interface Site {
  workspaceId: string;
  slug: string;
  draft: StoreConfig;
  revision: number;
  updatedAt: string;
  versions: PublishedVersion[];
  paused: boolean;
  events: SiteEvent[];
  /** Version numbers that passed their publish check (AMP-145). Versions themselves are frozen, so the flag lives beside them. */
  checked: Set<number>;
}

const NOTE_MAX = 200;
const fail = (code: FailCode, ...errors: string[]): { ok: false; code: FailCode; errors: string[] } => ({ ok: false, code, errors });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const published = (c: StoreConfig): StoreConfig => ({ ...c, status: 'published' });
const summary = (v: PublishedVersion, checked?: Set<number>): VersionSummary => ({
  version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy, note: v.note, source: { ...v.source },
  ...(checked?.has(v.version) ? { checkedOk: true as const } : {}),
});
const validExpected = (n: unknown): boolean => n === undefined || (typeof n === 'number' && Number.isInteger(n));
const NOT_LIVE = (expected: number, current: number | null) => `Version ${current ?? 'none'} is live now, not version ${expected}, so nothing was changed.`;

export function createSiteVersionStore(options: SiteVersionStoreOptions = {}): SiteVersionStore {
  const now = options.now ?? (() => new Date());
  const validate = options.validate ?? validateStoreConfig;
  const sites = new Map<string, Site>();

  const checkActor = (a: Actor) => (a && typeof a.workspaceId === 'string' && a.workspaceId.length > 0 && typeof a.userId === 'string' && a.userId.length > 0);
  const DENIED = 'You do not have access to this store.';

  function access(actor: Actor, slug: string): { ok: true; site: Site } | { ok: false; code: FailCode; errors: string[] } {
    if (!checkActor(actor)) return fail('denied', 'Sign in to a workspace first.');
    const site = sites.get(slug);
    if (!site) return fail('not_found', 'That store does not exist.');
    if (site.workspaceId !== actor.workspaceId) return fail('denied', DENIED);
    return { ok: true, site };
  }

  const live = (s: Site): PublishedVersion | undefined => s.versions[s.versions.length - 1];
  const view = (s: Site): DraftView => {
    const l = live(s);
    return {
      slug: s.slug, config: structuredClone(s.draft), revision: s.revision, updatedAt: s.updatedAt,
      liveVersion: l ? l.version : null, paused: s.paused,
      hasUnpublishedChanges: !l || stable(published(s.draft)) !== stable(l.config),
    };
  };
  const checkNote = (note: string | undefined): { ok: true; note: string } | { ok: false; code: FailCode; errors: string[] } => {
    const n = (note ?? '').trim();
    if (n.length > NOTE_MAX) return fail('invalid', `The note must be at most ${NOTE_MAX} characters.`);
    if (/[<>]/.test(n)) return fail('invalid', 'The note cannot contain the < or > characters.');
    return { ok: true, note: n };
  };

  /** Shared commit path for publish and rollback. Everything that can fail runs before anything is written. */
  async function commit(site: Site, actor: Actor, candidate: StoreConfig, source: VersionSource, note: string): Promise<Result<VersionSummary>> {
    const checked = validate(candidate);
    if (!checked.ok) {
      // A rollback target passed the rules when it was published, so say the rules moved rather than "fix these".
      if (source.kind === 'rollback') return fail('invalid', `Version ${source.fromVersion} no longer meets the current store rules, so it cannot be restored.`, ...plainErrors(checked.errors));
      return fail('invalid', 'This version cannot go live yet. Fix these and try again:', ...plainErrors(checked.errors));
    }
    const versionsAtStart = site.versions.length;
    const revisionAtStart = site.revision;
    const number = versionsAtStart + 1;
    const snapshot = deepFreeze(structuredClone(candidate));
    if (options.beforeCommit) {
      try { await options.beforeCommit(structuredClone(candidate), { kind: source.kind, slug: site.slug, version: number }); }
      catch { return fail('failed', 'Publishing did not finish, so your live store has not changed. Please try again.'); }
    }
    // Back in one synchronous stretch: re-check that nothing moved while a step was running, then write.
    if (site.versions.length !== versionsAtStart || (source.kind === 'publish' && site.revision !== revisionAtStart)) {
      return fail('conflict', 'The store changed while publishing, so nothing was published. Check the latest version and try again.');
    }
    const at = now().toISOString();
    // The whole record is frozen (not just the config), so nobody holding it can swap what gets served.
    const v: PublishedVersion = deepFreeze({ version: number, config: snapshot, publishedAt: at, publishedBy: actor.userId, note, source: { ...source } });
    site.versions.push(v);
    site.events.push({ at, by: actor.userId, kind: source.kind, version: number, ...(note ? { note } : {}) });
    return ok(summary(v));
  }

  return {
    kind: 'memory',

    async listSites(actor) {
      if (!checkActor(actor)) return fail('denied', 'Sign in to a workspace first.');
      return ok([...sites.values()].filter((s) => s.workspaceId === actor.workspaceId).map((s) => s.slug));
    },

    async createSite(actor, config) {
      if (!checkActor(actor)) return fail('denied', 'Sign in to a workspace first.');
      const slug = typeof config?.slug === 'string' ? config.slug : '';
      if (!isClaimableStoreSlug(slug)) return fail('invalid', `That store address is not allowed. Use ${STORE_SLUG_MESSAGE.replace('-', ' to ')}, and avoid reserved words.`);
      const existing = sites.get(slug);
      if (existing) return fail(existing.workspaceId === actor.workspaceId ? 'conflict' : 'denied', existing.workspaceId === actor.workspaceId ? 'You already have a store at that address.' : 'That store address is already taken.');
      let draft: StoreConfig;
      try { draft = { ...structuredClone(config), status: 'draft' }; } catch { return fail('invalid', 'The store settings could not be read.'); }
      const checked = validate(draft);
      if (!checked.ok) return fail('invalid', ...plainErrors(checked.errors));
      const site: Site = { workspaceId: actor.workspaceId, slug, draft, revision: 1, updatedAt: now().toISOString(), versions: [], paused: false, events: [], checked: new Set() };
      sites.set(slug, site);
      return ok(view(site));
    },

    async getDraft(actor, slug) {
      const a = access(actor, slug);
      return a.ok ? ok(view(a.site)) : a;
    },

    async editDraft(actor, slug, change, opts = {}) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const site = a.site;
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== site.revision) {
        return fail('conflict', 'The draft changed since you opened it. Reload it and try again.');
      }
      const working = structuredClone(site.draft);
      let next: StoreConfig;
      try { next = change(working) ?? working; } catch { return fail('invalid', 'That change could not be applied.'); }
      if (typeof next !== 'object' || next === null) return fail('invalid', 'That change could not be applied.');
      if (next.slug !== site.slug) return fail('invalid', 'The store address cannot be changed after the store is created.');
      if (next.status !== 'draft') return fail('invalid', 'Status is managed by Publish, so it cannot be edited here.');
      const checked = validate(next);
      if (!checked.ok) return fail('invalid', ...plainErrors(checked.errors));
      let stored: StoreConfig;
      try { stored = structuredClone(next); } catch { return fail('invalid', 'That change could not be applied.'); }
      site.draft = stored;
      site.revision += 1;
      site.updatedAt = now().toISOString();
      return ok(view(site));
    },

    async previewDraft(actor, slug) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const config = structuredClone(a.site.draft);
      const checked = validate(config);
      if (!checked.ok) return fail('invalid', 'The draft has problems, so it cannot be previewed:', ...plainErrors(checked.errors));
      // A preview is never indexed, whatever the store settings say.
      return ok({ config, render: { ...renderConfig(config), robots: { index: false, follow: false } as const }, revision: a.site.revision });
    },

    async publish(actor, slug, opts = {}) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const n = checkNote(opts.note);
      if (!n.ok) return n;
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== a.site.revision) {
        return fail('conflict', 'The draft changed after you previewed it. Preview it again before publishing.');
      }
      const l = live(a.site);
      if (l && !view(a.site).hasUnpublishedChanges) return ok({ ...summary(l, a.site.checked), unchanged: true });
      return commit(a.site, actor, published(structuredClone(a.site.draft)), { kind: 'publish' }, n.note);
    },

    async pause(actor, slug, opts = {}) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      if (!validExpected(opts?.expectedLive)) return fail('invalid', 'The expected live version is not a version number.');
      if (opts?.expectedLive !== undefined) {
        const cur = live(a.site)?.version ?? null;
        if (cur !== opts.expectedLive) return fail('conflict', NOT_LIVE(opts.expectedLive, cur));
      }
      if (!live(a.site)) return fail('conflict', 'Nothing is published yet, so there is nothing to pause.');
      if (!a.site.paused) { a.site.paused = true; a.site.events.push({ at: now().toISOString(), by: actor.userId, kind: 'pause' }); }
      return ok({ paused: true });
    },

    async unpause(actor, slug) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      if (a.site.paused) { a.site.paused = false; a.site.events.push({ at: now().toISOString(), by: actor.userId, kind: 'unpause' }); }
      return ok({ paused: false });
    },

    async rollback(actor, slug, toVersion, opts = {}) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const n = checkNote(opts.note);
      if (!n.ok) return n;
      if (!validExpected(opts?.expectedLive)) return fail('invalid', 'The expected live version is not a version number.');
      const current = live(a.site);
      if (opts?.expectedLive !== undefined && (current?.version ?? null) !== opts.expectedLive) {
        return fail('conflict', NOT_LIVE(opts.expectedLive, current?.version ?? null));
      }
      if (!current) return fail('conflict', 'Nothing is published yet, so there is nothing to go back to.');
      const target = Number.isInteger(toVersion) ? a.site.versions[toVersion - 1] : undefined;
      if (!target) return fail('not_found', 'That version does not exist.');
      if (target.version === current.version) return fail('conflict', `Version ${target.version} is already the live version.`);
      return commit(a.site, actor, published(structuredClone(target.config)), { kind: 'rollback', fromVersion: target.version }, n.note || `Restored version ${target.version}`);
    },

    async markChecked(actor, slug, version) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const v = Number.isInteger(version) ? a.site.versions[version - 1] : undefined;
      if (!v) return fail('not_found', 'That version does not exist.');
      // Only the version that is live right now can be flagged as checked: an old or never-live version cannot be marked.
      const current = live(a.site);
      if (!current || current.version !== v.version) return fail('conflict', NOT_LIVE(v.version, current?.version ?? null));
      a.site.checked.add(v.version);
      return ok({ version: v.version, checkedOk: true as const });
    },

    async history(actor, slug) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const l = live(a.site);
      return ok({
        versions: a.site.versions.map((v) => summary(v, a.site.checked)).reverse(),
        events: a.site.events.map((e) => ({ ...e })).reverse(),
        liveVersion: l ? l.version : null,
        paused: a.site.paused,
      });
    },

    async getVersion(actor, slug, version) {
      const a = access(actor, slug);
      if (!a.ok) return a;
      const v = Number.isInteger(version) ? a.site.versions[version - 1] : undefined;
      return v ? ok(v) : fail('not_found', 'That version does not exist.');
    },

    async resolvePublished(slug) {
      const site = typeof slug === 'string' ? sites.get(slug) : undefined;
      if (!site || site.versions.length === 0) return { status: 'none' };
      if (site.paused) return { status: 'paused' };
      // Fail closed: a snapshot that no longer validates is never served. Fall back to the newest earlier version
      // that still validates, then to none. (Always the real storefront validator, so a stricter test validator can
      // never take a live store down.)
      for (let i = site.versions.length - 1; i >= 0; i--) {
        const v = site.versions[i];
        const checked = validateStoreConfig(v.config);
        if (checked.ok && v.config.status === 'published') return { status: 'live', version: v.version, publishedAt: v.publishedAt, config: v.config };
      }
      return { status: 'none' };
    },
  };
}
