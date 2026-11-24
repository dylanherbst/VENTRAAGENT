// Files service (AMP-024): stores masters/previews, issues purchase-bound grants, redeems signed links, audits everything.
import { createHash, randomUUID } from 'node:crypto';
import { createMemoryGrantStore, fileKeyPath, safeContentType } from './storage.ts';
import { signToken, verifyToken } from './token.ts';
import { FilesError } from './types.ts';
import type { AuditEntry, AuditEvent, DenyReason, FileKey, FilesCtx, FileStorage, Grant, GrantStore, OrderBook, OrderItemRef, RedeemResult, StoredFile } from './types.ts';
import type { ProductStore, ProductVersion } from '../products/types.ts';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface FilesService {
  /** Store the private master for an APPROVED version. Its bytes must equal the version's pinned approvedHash. */
  storeMaster(ctx: FilesCtx, versionId: string, file: StoredFile): Promise<void>;
  /** Store the sample/watermarked preview for an APPROVED version. Never the master bytes. */
  storePreview(ctx: FilesCtx, versionId: string, file: StoredFile): Promise<void>;
  /** Public preview read. Served only for an approved version; reads the preview namespace only, never the master. */
  getPreview(ref: { workspaceId: string; versionId: string }): Promise<StoredFile>;
  /** Issue a link for a paid order line. Throws FilesError with a distinct code when it must not be issued. */
  issueGrant(ctx: FilesCtx, orderItemId: string): Promise<{ grant: Grant; token: string }>;
  revokeGrant(ctx: FilesCtx, grantId: string): Promise<void>;
  /** New grant + token for the same order line; every older grant for that line is revoked. */
  reissueGrant(ctx: FilesCtx, orderItemId: string): Promise<{ grant: Grant; token: string }>;
  listGrants(ctx: FilesCtx, orderItemId: string): Promise<Grant[]>;
  /** Verify a token and, when every check passes, count one download and return the master. Never throws on a deny. */
  redeem(token: unknown, opts?: { businessId?: string }): Promise<RedeemResult>;
  /** Audit entries for one workspace. */
  audit(ctx: FilesCtx): AuditEntry[];
  /** Every entry, including those from unverifiable tokens (no workspace). Operator view only. */
  auditAll(): AuditEntry[];
}

export interface FilesServiceDeps {
  storage: FileStorage;
  orders: OrderBook;
  products: Pick<ProductStore, 'getVersion' | 'listVersions'>;
  /** HMAC key (32+ chars) from resolveFilesConfig; tests pass a test secret. */
  secret: string;
  grants?: GrantStore;
  ttlMs?: number;
  maxDownloads?: number;
  now?: () => Date;
  newId?: () => string;
}

export const AUDIT_CAP = 1000;

export function createFilesService(deps: FilesServiceDeps): FilesService {
  if (typeof deps.secret !== 'string' || deps.secret.length < 32) throw new FilesError('invalid_input', 'The signing secret must be at least 32 characters.');
  const grants = deps.grants ?? createMemoryGrantStore();
  const ttlMs = deps.ttlMs ?? 72 * 3_600_000;
  const maxDownloads = deps.maxDownloads ?? 5;
  const now = () => (deps.now ?? (() => new Date()))();
  const newId = deps.newId ?? randomUUID;
  // Ring buffer: the newest AUDIT_CAP entries are kept in memory (the database table is the durable record).
  const log: AuditEntry[] = [];
  let seqNo = 0;

  const note = (event: AuditEvent, e: { reason?: DenyReason | null; grantId?: string | null; orderItemId?: string | null; workspaceId?: string | null; businessId?: string | null; note?: string | null }) => {
    if (log.length >= AUDIT_CAP) log.shift();
    log.push({ seq: ++seqNo, at: now().toISOString(), event, reason: e.reason ?? null, grantId: e.grantId ?? null, orderItemId: e.orderItemId ?? null, workspaceId: e.workspaceId ?? null, businessId: e.businessId ?? null, note: e.note ?? null });
  };
  const need = (ctx: FilesCtx) => {
    if (!ctx || typeof ctx.workspaceId !== 'string' || !ctx.workspaceId) throw new FilesError('wrong_tenant', 'No workspace.');
    if (typeof ctx.businessId !== 'string' || !ctx.businessId) throw new FilesError('wrong_tenant', 'No business.');
  };
  /** True when `businessId` is not the caller's business. */
  const otherBusiness = (ctx: FilesCtx, businessId: string) => ctx.businessId !== businessId;

  async function versionOf(ctx: FilesCtx, versionId: string): Promise<ProductVersion> {
    const v = await deps.products.getVersion(ctx.workspaceId, versionId);
    if (!v || otherBusiness(ctx, v.businessId)) throw new FilesError('wrong_tenant', 'That version was not found in this workspace.');
    return v;
  }
  const keyOf = (v: ProductVersion): FileKey => ({ workspaceId: v.workspaceId, businessId: v.businessId, productId: v.productId, version: v.version });
  const approvedOrThrow = (v: ProductVersion) => {
    if (v.status !== 'approved' || !v.approvedHash) throw new FilesError('version_not_approved', 'Only an approved version can have files released.');
  };

  /** Delivery rule: a paid buyer keeps the version they bought, even after a newer one is approved (superseded). Never-approved versions stay out. */
  const deliverableOrThrow = (v: ProductVersion) => {
    if ((v.status !== 'approved' && v.status !== 'superseded') || !v.approvedHash) throw new FilesError('version_not_approved', 'That version was never approved for release.');
  };

  /** The bought version, found inside the order's own workspace and business. */
  async function boughtVersion(item: OrderItemRef): Promise<ProductVersion | null> {
    const all = await deps.products.listVersions(item.workspaceId, item.productId);
    return all.find((v) => v.version === item.productVersion) ?? null;
  }

  /** Shared checks for issuing and redeeming. Returns the approved version and its master, or throws FilesError. */
  async function checkDeliverable(item: OrderItemRef, expect: { workspaceId: string; businessId: string }): Promise<{ version: ProductVersion; file: StoredFile }> {
    if (item.workspaceId !== expect.workspaceId || item.businessId !== expect.businessId) throw new FilesError('wrong_tenant', 'Not available.');
    if (item.orderStatus !== 'paid') throw new FilesError('order_not_paid', 'The order is not paid.');
    const v = await boughtVersion(item);
    if (!v || v.workspaceId !== item.workspaceId) throw new FilesError('version_not_approved', 'The purchased version is not available.');
    if (v.businessId !== item.businessId || v.productId !== item.productId) throw new FilesError('wrong_tenant', 'Not available.');
    deliverableOrThrow(v);
    const file = await deps.storage.getMaster(keyOf(v));
    if (!file) throw new FilesError('file_missing', 'The file is not stored.');
    if (sha256(file.bytes) !== v.approvedHash) throw new FilesError('file_changed', 'The stored file does not match the approved version.');
    return { version: v, file };
  }

  async function issue(ctx: FilesCtx, orderItemId: string, reissue: boolean): Promise<{ grant: Grant; token: string }> {
    need(ctx);
    const item = await deps.orders.getItem(orderItemId);
    // Another business's line in this workspace is answered exactly like a missing one.
    if (!item || (item.workspaceId === ctx.workspaceId && otherBusiness(ctx, item.businessId))) { note('download_denied', { reason: 'order_not_found', orderItemId, workspaceId: ctx.workspaceId, businessId: ctx.businessId, note: 'issue' }); throw new FilesError('order_not_found', 'That order line was not found.'); }
    try {
      await checkDeliverable(item, { workspaceId: ctx.workspaceId, businessId: item.businessId });
    } catch (e) {
      if (e instanceof FilesError && e.code !== 'invalid_input') note('download_denied', { reason: e.code, orderItemId, workspaceId: ctx.workspaceId, businessId: ctx.businessId, note: 'issue' });
      throw e;
    }
    const issuedAt = now();
    const draft: Grant = {
      id: newId(), orderItemId, workspaceId: item.workspaceId, businessId: item.businessId, issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(), maxDownloads, downloads: 0, revokedAt: null, replacesGrantId: null,
    };
    let grant = draft;
    if (reissue) {
      // One atomic store step: revoke every active grant for this line and insert the new one.
      const r = await grants.replaceActive(draft, issuedAt.toISOString());
      grant = r.grant;
      for (const id of r.revoked) note('grant_revoked', { grantId: id, orderItemId, workspaceId: grant.workspaceId, businessId: grant.businessId, note: 'replaced by reissue' });
    } else {
      await grants.put(draft);
    }
    const token = signToken(deps.secret, { g: grant.id, i: orderItemId, e: Date.parse(grant.expiresAt) });
    note(reissue ? 'grant_reissued' : 'grant_issued', { grantId: grant.id, orderItemId, workspaceId: grant.workspaceId, businessId: grant.businessId, note: grant.replacesGrantId ? `replaces ${grant.replacesGrantId}` : null });
    return { grant, token };
  }

  async function deny(reason: DenyReason, g: { grantId?: string | null; orderItemId?: string | null; workspaceId?: string | null; businessId?: string | null }): Promise<RedeemResult> {
    note('download_denied', { reason, ...g });
    return { ok: false, reason, grantId: g.grantId ?? null };
  }

  return {
    async storeMaster(ctx, versionId, file) {
      need(ctx);
      const v = await versionOf(ctx, versionId);
      approvedOrThrow(v);
      if (sha256(file.bytes) !== v.approvedHash) throw new FilesError('file_changed', 'The file does not match the approved version.');
      await deps.storage.putMaster(keyOf(v), { ...file, contentType: safeContentType(file.contentType) });
      note('master_stored', { workspaceId: v.workspaceId, businessId: v.businessId, note: `${fileKeyPath(keyOf(v))}` });
    },

    async storePreview(ctx, versionId, file) {
      need(ctx);
      const v = await versionOf(ctx, versionId);
      approvedOrThrow(v);
      await deps.storage.putPreview(keyOf(v), { ...file, contentType: safeContentType(file.contentType) });
      note('preview_stored', { workspaceId: v.workspaceId, businessId: v.businessId, note: `${fileKeyPath(keyOf(v))}` });
    },

    async getPreview(ref) {
      try {
        if (!ref || typeof ref.workspaceId !== 'string' || typeof ref.versionId !== 'string') throw new FilesError('wrong_tenant', 'Not available.');
        const v = await deps.products.getVersion(ref.workspaceId, ref.versionId);
        if (!v) throw new FilesError('wrong_tenant', 'Not available.');
        approvedOrThrow(v);
        const f = await deps.storage.getPreview(keyOf(v));
        if (!f) throw new FilesError('file_missing', 'No preview.');
        note('preview_served', { workspaceId: v.workspaceId, businessId: v.businessId, note: fileKeyPath(keyOf(v)) });
        return f;
      } catch (e) {
        if (e instanceof FilesError && e.code !== 'invalid_input') note('preview_denied', { reason: e.code, workspaceId: ref?.workspaceId ?? null });
        throw e;
      }
    },

    issueGrant: (ctx, orderItemId) => issue(ctx, orderItemId, false),

    async revokeGrant(ctx, grantId) {
      need(ctx);
      const g = await grants.get(grantId);
      if (!g || g.workspaceId !== ctx.workspaceId || otherBusiness(ctx, g.businessId)) throw new FilesError('wrong_tenant', 'That link was not found in this workspace.');
      await grants.revoke(grantId, now().toISOString());
      note('grant_revoked', { grantId, orderItemId: g.orderItemId, workspaceId: g.workspaceId, businessId: g.businessId });
    },

    async reissueGrant(ctx, orderItemId) {
      need(ctx);
      // Checks first: if the order is no longer deliverable, the old link is left as it was and the caller sees why.
      return issue(ctx, orderItemId, true);
    },

    async listGrants(ctx, orderItemId) {
      need(ctx);
      return (await grants.listByItem(orderItemId)).filter((g) => g.workspaceId === ctx.workspaceId && !otherBusiness(ctx, g.businessId));
    },

    async redeem(token, opts) {
      const p = verifyToken(deps.secret, token);
      if (!p) return deny('invalid_token', {});
      const ids = { grantId: p.g, orderItemId: p.i };
      if (p.e <= now().getTime()) return deny('expired', ids);
      const g = await grants.get(p.g);
      if (!g || g.orderItemId !== p.i || Date.parse(g.expiresAt) !== p.e) return deny('invalid_token', ids);
      const gi = { ...ids, workspaceId: g.workspaceId, businessId: g.businessId };
      if (g.revokedAt !== null) return deny('revoked', gi);
      if (g.downloads >= g.maxDownloads) return deny('limit_reached', gi);
      if (opts?.businessId !== undefined && opts.businessId !== g.businessId) return deny('wrong_tenant', gi);
      const item = await deps.orders.getItem(g.orderItemId);
      if (!item) return deny('order_not_found', gi);
      let checked;
      try {
        checked = await checkDeliverable(item, { workspaceId: g.workspaceId, businessId: g.businessId });
      } catch (e) {
        if (e instanceof FilesError && e.code !== 'invalid_input') return deny(e.code, gi);
        throw e;
      }
      // Re-check the order right before counting: a refund that landed while the file was loading must win.
      const again = await deps.orders.getItem(g.orderItemId);
      if (!again) return deny('order_not_found', gi);
      if (again.workspaceId !== g.workspaceId || again.businessId !== g.businessId) return deny('wrong_tenant', gi);
      if (again.orderStatus !== 'paid') return deny('order_not_paid', gi);
      // The only place a download is counted. One atomic store step: not revoked, not expired, under the cap.
      if (!(await grants.tryConsume(g.id, now().toISOString()))) {
        const cur = await grants.get(g.id);
        if (!cur || cur.revokedAt !== null) return deny('revoked', gi);
        if (Date.parse(cur.expiresAt) <= now().getTime()) return deny('expired', gi);
        return deny('limit_reached', gi);
      }
      note('download_allowed', { grantId: g.id, orderItemId: g.orderItemId, workspaceId: g.workspaceId, businessId: g.businessId });
      const used = (await grants.get(g.id))?.downloads ?? g.downloads + 1;
      return { ok: true, file: checked.file, grantId: g.id, remaining: Math.max(0, g.maxDownloads - used), sha256: checked.version.approvedHash as string };
    },

    audit: (ctx) => { need(ctx); return log.filter((e) => e.workspaceId === ctx.workspaceId && e.businessId === ctx.businessId).map((e) => ({ ...e })); },
    auditAll: () => log.map((e) => ({ ...e })),
  };
}
