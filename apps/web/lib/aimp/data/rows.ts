// Typed row mappers/validators for the AiMoneyPrinter commerce core (supabase/migrations/202611140001_aimp_commerce_core.sql).
// Pure functions: no network, no secrets. They turn untrusted DB/RPC rows into the camelCase shapes the app uses and throw
// AimpRowError on anything that does not match the contracts, so a bad row never flows into workflow code.
import {
  assetRoles, businessModels, engineFor, businessStatuses, domainStatuses, productStatuses, siteVersionStatuses,
  type AssetRole, type BusinessModel, type BusinessStatus, type DomainStatus, type ProductStatus, type ProductionEngine, type SiteVersionStatus,
} from '../contracts.ts';

export class AimpRowError extends Error {
  constructor(table: string, field: string, why: string) { super(`${table}.${field}: ${why}`); this.name = 'AimpRowError'; }
}

type Raw = Record<string, unknown>;
const engines = ['document', 'visual'] as const satisfies readonly ProductionEngine[];
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugRe = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;
const hostRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function obj(table: string, row: unknown): Raw {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new AimpRowError(table, '*', 'row must be an object');
  return row as Raw;
}
const id = (t: string, r: Raw, f: string): string => {
  const v = r[f];
  if (typeof v !== 'string' || !uuidRe.test(v)) throw new AimpRowError(t, f, 'must be a uuid');
  return v.toLowerCase();
};
const text = (t: string, r: Raw, f: string, min: number, max: number): string => {
  const v = r[f];
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new AimpRowError(t, f, `must be text of ${min}-${max} characters`);
  return v;
};
const int = (t: string, r: Raw, f: string, min: number, max = 2147483647): number => {
  const v = r[f];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new AimpRowError(t, f, `must be an integer ${min}-${max}`);
  return v;
};
function oneOf<T extends string>(t: string, r: Raw, f: string, list: readonly T[]): T {
  const v = r[f];
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new AimpRowError(t, f, `must be one of ${list.join(', ')}`);
  return v as T;
}
const when = (t: string, r: Raw, f: string): string => {
  const v = r[f];
  const s = v instanceof Date ? v.toISOString() : v;
  if (typeof s !== 'string' || Number.isNaN(Date.parse(s))) throw new AimpRowError(t, f, 'must be a timestamp');
  return new Date(s).toISOString();
};
const optWhen = (t: string, r: Raw, f: string): string | null => (r[f] === null || r[f] === undefined ? null : when(t, r, f));

export interface BusinessRow { id: string; workspaceId: string; blueprintId: string; blueprintVersion: number; niche: string; model: BusinessModel; status: BusinessStatus; createdAt: string }
export function mapBusiness(row: unknown): BusinessRow {
  const r = obj('businesses', row), t = 'businesses';
  return { id: id(t, r, 'id'), workspaceId: id(t, r, 'workspace_id'), blueprintId: text(t, r, 'blueprint_id', 1, 120), blueprintVersion: int(t, r, 'blueprint_version', 1),
    niche: text(t, r, 'niche', 1, 160), model: oneOf(t, r, 'model', businessModels), status: oneOf(t, r, 'status', businessStatuses), createdAt: when(t, r, 'created_at') };
}

export interface ProductRow { id: string; businessId: string; workspaceId: string; title: string; engine: ProductionEngine; status: ProductStatus; priceMinor: number; currency: 'AUD'; version: number; createdAt: string }
export function mapProduct(row: unknown): ProductRow {
  const r = obj('products', row), t = 'products';
  if (r.currency !== 'AUD') throw new AimpRowError(t, 'currency', 'must be AUD');
  return { id: id(t, r, 'id'), businessId: id(t, r, 'business_id'), workspaceId: id(t, r, 'workspace_id'), title: text(t, r, 'title', 1, 200),
    engine: oneOf(t, r, 'engine', engines), status: oneOf(t, r, 'status', productStatuses), priceMinor: int(t, r, 'price_minor', 0), currency: 'AUD',
    version: int(t, r, 'version', 1), createdAt: when(t, r, 'created_at') };
}

export interface ProductAssetRow { id: string; productId: string; workspaceId: string; productVersion: number; role: AssetRole; storagePath: string; sha256: string; bytes: number; qaStatus: 'pending' | 'pass' | 'fail' }
export function mapProductAsset(row: unknown): ProductAssetRow {
  const r = obj('product_assets', row), t = 'product_assets';
  const sha = text(t, r, 'sha256', 64, 64);
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new AimpRowError(t, 'sha256', 'must be lowercase hex sha-256');
  // bigint arrives as a string (REST) or a bigint (some drivers); values beyond 2^53 are rejected by int() below.
  const bytes = typeof r.bytes === 'bigint' ? Number(r.bytes) : typeof r.bytes === 'string' && /^[0-9]+$/.test(r.bytes) ? Number(r.bytes) : r.bytes;
  return { id: id(t, r, 'id'), productId: id(t, r, 'product_id'), workspaceId: id(t, r, 'workspace_id'), productVersion: int(t, r, 'product_version', 1),
    role: oneOf(t, r, 'role', assetRoles), storagePath: text(t, r, 'storage_path', 1, 500), sha256: sha,
    bytes: int(t, { bytes }, 'bytes', 1, Number.MAX_SAFE_INTEGER), qaStatus: oneOf(t, r, 'qa_status', ['pending', 'pass', 'fail'] as const) };
}

export interface SiteRow { id: string; businessId: string; workspaceId: string; slug: string }
export function mapSite(row: unknown): SiteRow {
  const r = obj('sites', row), t = 'sites';
  const slug = text(t, r, 'slug', 3, 42);
  if (!slugRe.test(slug)) throw new AimpRowError(t, 'slug', 'must be lowercase letters, digits and hyphens');
  return { id: id(t, r, 'id'), businessId: id(t, r, 'business_id'), workspaceId: id(t, r, 'workspace_id'), slug };
}

export interface SiteVersionRow { id: string; siteId: string; workspaceId: string; version: number; config: Record<string, unknown>; status: SiteVersionStatus; publishedAt: string | null }
export function mapSiteVersion(row: unknown): SiteVersionRow {
  const r = obj('site_versions', row), t = 'site_versions';
  const config = r.config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new AimpRowError(t, 'config', 'must be an object');
  const status = oneOf(t, r, 'status', siteVersionStatuses);
  const publishedAt = optWhen(t, r, 'published_at');
  if ((status === 'published') !== (publishedAt !== null)) throw new AimpRowError(t, 'published_at', 'set exactly when status is published');
  return { id: id(t, r, 'id'), siteId: id(t, r, 'site_id'), workspaceId: id(t, r, 'workspace_id'), version: int(t, r, 'version', 1), config: config as Record<string, unknown>, status, publishedAt };
}

export interface DomainRow { id: string; siteId: string; workspaceId: string; hostname: string; kind: 'subdomain' | 'custom'; status: DomainStatus }
export function mapDomain(row: unknown): DomainRow {
  const r = obj('domains', row), t = 'domains';
  const hostname = text(t, r, 'hostname', 3, 253);
  if (hostname !== hostname.toLowerCase() || !hostRe.test(hostname)) throw new AimpRowError(t, 'hostname', 'must be a lowercase hostname');
  return { id: id(t, r, 'id'), siteId: id(t, r, 'site_id'), workspaceId: id(t, r, 'workspace_id'), hostname, kind: oneOf(t, r, 'kind', ['subdomain', 'custom'] as const), status: oneOf(t, r, 'status', domainStatuses) };
}

/** Public (anon) shapes: what the storefront may see. Deliberately has no workspaceId and no master file paths. */
export interface PublicProduct { id: string; businessId: string; title: string; engine: ProductionEngine; priceMinor: number; currency: 'AUD'; version: number }
export function mapPublicProduct(row: unknown): PublicProduct {
  const r = obj('products', row), t = 'products';
  if (r.currency !== 'AUD') throw new AimpRowError(t, 'currency', 'must be AUD');
  return { id: id(t, r, 'id'), businessId: id(t, r, 'business_id'), title: text(t, r, 'title', 1, 200), engine: oneOf(t, r, 'engine', engines),
    priceMinor: int(t, r, 'price_minor', 0), currency: 'AUD', version: int(t, r, 'version', 1) };
}

/** Input shapes for the owner RPCs, validated before they reach the database. */
export interface NewBusiness { workspaceId: string; blueprintId: string; blueprintVersion: number; niche: string; model: BusinessModel }
export function checkNewBusiness(input: unknown): NewBusiness {
  const r = obj('create_business', input), t = 'create_business';
  return { workspaceId: id(t, r, 'workspaceId'), blueprintId: text(t, r, 'blueprintId', 1, 120), blueprintVersion: int(t, r, 'blueprintVersion', 1),
    niche: text(t, r, 'niche', 1, 160), model: oneOf(t, r, 'model', businessModels) };
}
export interface NewProduct { businessId: string; title: string; engine: ProductionEngine; priceMinor: number }
/** `businessModel` is the model of the business the product is for; the engine must be one engineFor() allows for it. */
export function checkNewProduct(input: unknown, businessModel: BusinessModel): NewProduct {
  const r = obj('create_product', input), t = 'create_product';
  const engine = oneOf(t, r, 'engine', engines);
  if (!engineFor[businessModel]?.includes(engine)) throw new AimpRowError(t, 'engine', `${engine} is not allowed for ${businessModel}`);
  return { businessId: id(t, r, 'businessId'), title: text(t, r, 'title', 1, 200), engine, priceMinor: int(t, r, 'priceMinor', 0) };
}
