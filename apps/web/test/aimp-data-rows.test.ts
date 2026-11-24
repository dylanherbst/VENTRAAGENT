import test from 'node:test';
import assert from 'node:assert/strict';
import { AimpRowError, checkNewBusiness, checkNewProduct, mapBusiness, mapDomain, mapProduct, mapProductAsset, mapPublicProduct, mapSite, mapSiteVersion } from '../lib/aimp/data/index.ts';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const business = { id: U(1), workspace_id: U(2), blueprint_id: 'planner', blueprint_version: 1, niche: 'Planners', model: 'digital-templates', status: 'draft', created_at: new Date('2026-11-14T00:00:00Z') };
const product = { id: U(3), business_id: U(1), workspace_id: U(2), title: 'Planner', engine: 'document', status: 'active', price_minor: 1900, currency: 'AUD', version: 1, created_at: '2026-11-14T00:00:00Z' };

test('row mappers convert snake_case rows and normalise timestamps', () => {
  assert.deepEqual(mapBusiness(business), { id: U(1), workspaceId: U(2), blueprintId: 'planner', blueprintVersion: 1, niche: 'Planners', model: 'digital-templates', status: 'draft', createdAt: '2026-11-14T00:00:00.000Z' });
  assert.equal(mapProduct(product).priceMinor, 1900);
  assert.equal(mapProductAsset({ id: U(4), product_id: U(3), workspace_id: U(2), product_version: 1, role: 'master', storage_path: 'p/m.pdf', sha256: 'a'.repeat(64), bytes: '2048', qa_status: 'pending' }).bytes, 2048);
  assert.equal(mapProductAsset({ id: U(4), product_id: U(3), workspace_id: U(2), product_version: 1, role: 'preview', storage_path: 'p/m.pdf', sha256: 'a'.repeat(64), bytes: 5n, qa_status: 'pass' }).bytes, 5);
  assert.equal(mapSite({ id: U(5), business_id: U(1), workspace_id: U(2), slug: 'slow-morning' }).slug, 'slow-morning');
  assert.equal(mapSiteVersion({ id: U(6), site_id: U(5), workspace_id: U(2), version: 1, config: { a: 1 }, status: 'published', published_at: '2026-11-14T00:00:00Z' }).status, 'published');
  assert.equal(mapDomain({ id: U(7), site_id: U(5), workspace_id: U(2), hostname: 'shop.example.com', kind: 'custom', status: 'verified' }).hostname, 'shop.example.com');
});

test('row mappers reject rows that break the contracts', () => {
  assert.throws(() => mapBusiness({ ...business, model: 'membership' }), AimpRowError);
  assert.throws(() => mapBusiness({ ...business, status: 'deleted' }), /status/);
  assert.throws(() => mapBusiness({ ...business, id: 'nope' }), /uuid/);
  assert.throws(() => mapBusiness(null), AimpRowError);
  assert.throws(() => mapProduct({ ...product, currency: 'USD' }), /AUD/);
  assert.throws(() => mapProduct({ ...product, price_minor: 1.5 }), /integer/);
  assert.throws(() => mapProduct({ ...product, engine: 'audio' }), /engine/);
  assert.throws(() => mapProductAsset({ id: U(4), product_id: U(3), workspace_id: U(2), product_version: 1, role: 'secret', storage_path: 'x', sha256: 'a'.repeat(64), bytes: 1, qa_status: 'pass' }), /role/);
  assert.throws(() => mapProductAsset({ id: U(4), product_id: U(3), workspace_id: U(2), product_version: 1, role: 'master', storage_path: 'x', sha256: 'XYZ', bytes: 1, qa_status: 'pass' }), /sha256|characters/);
  assert.throws(() => mapSite({ id: U(5), business_id: U(1), workspace_id: U(2), slug: 'Bad Slug' }), /slug/);
  assert.throws(() => mapSiteVersion({ id: U(6), site_id: U(5), workspace_id: U(2), version: 1, config: [], status: 'draft', published_at: null }), /config/);
  assert.throws(() => mapSiteVersion({ id: U(6), site_id: U(5), workspace_id: U(2), version: 1, config: {}, status: 'published', published_at: null }), /published_at/);
  assert.throws(() => mapDomain({ id: U(7), site_id: U(5), workspace_id: U(2), hostname: 'UPPER.example.com', kind: 'custom', status: 'verified' }), /hostname/);
});

test('public product shape carries no workspace id and ignores private extras', () => {
  const p = mapPublicProduct({ ...product, workspace_id: U(2), status: 'draft' });
  assert.equal('workspaceId' in p, false);
  assert.equal('status' in p, false);
});

test('owner RPC inputs are validated before reaching the database', () => {
  assert.equal(checkNewBusiness({ workspaceId: U(2), blueprintId: 'planner', blueprintVersion: 1, niche: 'Planners', model: 'printable-art' }).model, 'printable-art');
  assert.throws(() => checkNewBusiness({ workspaceId: 'x', blueprintId: 'planner', blueprintVersion: 1, niche: 'n', model: 'printable-art' }));
  assert.throws(() => checkNewBusiness({ workspaceId: U(2), blueprintId: 'planner', blueprintVersion: 0, niche: 'n', model: 'printable-art' }));
  assert.equal(checkNewProduct({ businessId: U(1), title: 'Planner', engine: 'document', priceMinor: 0 }, 'digital-templates').priceMinor, 0);
  assert.throws(() => checkNewProduct({ businessId: U(1), title: ' ', engine: 'document', priceMinor: 1 }, 'digital-templates'));
  assert.throws(() => checkNewProduct({ businessId: U(1), title: 'x', engine: 'document', priceMinor: -1 }, 'digital-templates'));
  // engineFor: a visual product on a digital-templates business is refused; marketing-assets takes both.
  assert.throws(() => checkNewProduct({ businessId: U(1), title: 'x', engine: 'visual', priceMinor: 1 }, 'digital-templates'), /not allowed/);
  assert.throws(() => checkNewProduct({ businessId: U(1), title: 'x', engine: 'document', priceMinor: 1 }, 'printable-art'), /not allowed/);
  assert.equal(checkNewProduct({ businessId: U(1), title: 'x', engine: 'visual', priceMinor: 1 }, 'marketing-assets').engine, 'visual');
});
