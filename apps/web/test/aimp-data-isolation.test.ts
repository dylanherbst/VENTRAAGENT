import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { assetRoles, businessModels, businessStatuses, domainStatuses, productStatuses, siteVersionStatuses } from '../lib/aimp/contracts.ts';
import { mapBusiness, mapDomain, mapProduct, mapProductAsset, mapPublicProduct, mapSite, mapSiteVersion } from '../lib/aimp/data/index.ts';

// Fresh PostgreSQL migration (real DB roles, fixture Auth claims, NOT Supabase integration). Two tenants share one engine.
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const SA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HASH = 'a'.repeat(64);
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

test('AiMoneyPrinter commerce core: two businesses share one engine, private data stays scoped to its owner', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    // The whole chain (create_business/create_product call fo_is_lab from the lab migration).
    for (const f of (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
    await db.query('insert into auth.users values ($1),($2)', [A, B]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [SA, A, SB, B]);
    const actor = async (uid: string, session: string) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: uid, session_id: session })]);
      await db.exec('set role authenticated');
    };
    const anon = async () => { await db.exec('reset role'); await db.exec('set role anon'); };
    const one = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, p)).rows[0]?.result;
    const rows = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, p)).rows;
    const count = async (table: string) => one(`select count(*)::int as result from public.${table}`);

    // Same engine, two tenants: each owner creates a workspace, a business and a product through the owner RPCs.
    await actor(A, SA);
    const wa = (await one("select public.create_workspace('Alpha') as result")) as string;
    const ba = (await one("select public.create_business($1,'planner-pack',1,'Teacher planners','digital-templates') as result", [wa])) as string;
    const pa = (await one("select public.create_product($1,'Weekly planner','document',1900) as result", [ba])) as string;
    await actor(B, SB);
    const wb = (await one("select public.create_workspace('Beta') as result")) as string;
    const bb = (await one("select public.create_business($1,'wall-art',1,'Nursery prints','printable-art') as result", [wb])) as string;
    const pb = (await one("select public.create_product($1,'Moon print','visual',1200) as result", [bb])) as string;

    // Private rows are written by the server role (here: the fixture superuser): master file, preview, order, merchant, site, domain.
    await db.exec('reset role');
    for (const [w, p, tag] of [[wa, pa, 'a'], [wb, pb, 'b']] as const) {
      await db.query("insert into public.product_assets(product_id,workspace_id,product_version,role,storage_path,sha256,bytes) values ($1,$2,1,'master',$3,$4,2048)", [p, w, `private/${tag}/master.pdf`, HASH]);
      await db.query("insert into public.product_assets(product_id,workspace_id,product_version,role,storage_path,sha256,bytes) values ($1,$2,1,'preview',$3,$4,512)", [p, w, `public/${tag}/preview.webp`, HASH]);
      await db.query("update public.product_assets set qa_status='pass' where product_id=$1 and role='preview'", [p]);
      // A mockup that has not passed QA must not be public even for an active product of a live business.
      await db.query("insert into public.product_assets(product_id,workspace_id,product_version,role,storage_path,sha256,bytes) values ($1,$2,1,'mockup',$3,$4,512)", [p, w, `public/${tag}/mockup-unchecked.webp`, HASH]);
    }
    const bizOf: Record<string, string> = { [wa]: ba, [wb]: bb };
    for (const [w, tag, p] of [[wa, 'a', pa], [wb, 'b', pb]] as const) {
      const o = (await db.query<{ id: string }>("insert into public.orders(workspace_id,business_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status,customer_email) values ($1,$2,$3,$4,1900,'AUD','paid',$5) returning id",
        [w, bizOf[w], `evt_${tag}`, `cs_${tag}`, `buyer-${tag}@example.test`])).rows[0]!.id;
      await db.query("insert into public.order_items(order_id,workspace_id,product_id,product_version,title_snapshot,unit_minor,quantity) values ($1,$2,$3,1,'snap',1900,1)", [o, w, p]);
      await db.query("insert into public.merchant_accounts(business_id,workspace_id,stripe_account_id) values ($1,$2,$3)", [bizOf[w], w, `acct_${tag}`]);
      await db.query("insert into public.usage_ledger(workspace_id,business_id,provider,operation,units,cost_micro_usd,idempotency_key) values ($1,$2,'openai','draft',1,100,$3)", [w, bizOf[w], `u-${tag}`]);
      const s = (await db.query<{ id: string }>("insert into public.sites(business_id,workspace_id,slug) values ($1,$2,$3) returning id", [bizOf[w], w, `shop-${tag}x`])).rows[0]!.id;
      await db.query("insert into public.site_versions(site_id,workspace_id,version,config,status,published_at) values ($1,$2,1,'{\"theme\":\"calm\"}','published',now())", [s, w]);
      await db.query("insert into public.site_versions(site_id,workspace_id,version,config) values ($1,$2,2,'{\"theme\":\"draft-secret\"}')", [s, w]);
      await db.query("insert into public.domains(site_id,workspace_id,hostname,status) values ($1,$2,$3,'verified')", [s, w, `shop-${tag}x.example.test`]);
      await db.query("insert into public.domains(site_id,workspace_id,hostname,kind,status) values ($1,$2,$3,'custom','pending')", [s, w, `pending-${tag}.example.test`]);
    }
    // A's business is live with an active product (public); B stays draft (nothing of B is public).
    await db.query("update public.businesses set status='live' where id=$1", [ba]);
    await db.query("update public.products set status='active' where id=$1", [pa]);

    // Composite FKs also tie order items, fulfilments and usage rows to one tenant.
    const oa = (await db.query<{ id: string }>('select id from public.orders where workspace_id=$1', [wa])).rows[0]!.id;
    await assert.rejects(db.query("insert into public.order_items(order_id,workspace_id,product_id,product_version,title_snapshot,unit_minor,quantity) values ($1,$2,$3,1,'x',1,1)", [oa, wa, pb]), /foreign key/, "A's order cannot hold B's product");
    await assert.rejects(db.query("insert into public.order_items(order_id,workspace_id,product_id,product_version,title_snapshot,unit_minor,quantity) values ($1,$2,$3,1,'x',1,1)", [oa, wb, pa]), /foreign key/, "B's workspace cannot hang on A's order");
    const itemA = (await db.query<{ id: string }>('select id from public.order_items where workspace_id=$1', [wa])).rows[0]!.id;
    await assert.rejects(db.query("insert into public.fulfilments(order_item_id,workspace_id) values ($1,$2)", [itemA, wb]), /foreign key/, "fulfilment workspace must be its order item's");
    await db.query("insert into public.fulfilments(order_item_id,workspace_id) values ($1,$2)", [itemA, wa]);
    await assert.rejects(db.query("insert into public.usage_ledger(workspace_id,business_id,provider,operation,units,cost_micro_usd,idempotency_key) values ($1,$2,'openai','x',1,1,'cross')", [wa, bb]), /foreign key/, "usage cannot name another tenant's business");
    // Composite foreign keys: a row can never mix one tenant's workspace with another tenant's parent.
    await assert.rejects(db.query("insert into public.products(business_id,workspace_id,title,engine,price_minor) values ($1,$2,'x','document',1)", [bb, wa]), /foreign key/);
    await assert.rejects(db.query("insert into public.orders(workspace_id,business_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status) values ($1,$2,'e','s',1,'AUD','paid')", [wa, bb]), /foreign key/);

    // Owner A sees exactly A's rows, mapped by the typed data layer.
    await actor(A, SA);
    for (const t of ['businesses', 'products', 'orders', 'order_items', 'merchant_accounts', 'usage_ledger', 'sites']) assert.equal(await count(t), 1, `A sees one ${t}`);
    assert.equal(await count('product_assets'), 3);
    assert.equal(await count('site_versions'), 2);
    assert.equal(mapBusiness((await rows('select * from public.businesses'))[0]).niche, 'Teacher planners');
    assert.equal(mapProduct((await rows('select * from public.products'))[0]).priceMinor, 1900);
    assert.deepEqual((await rows('select * from public.product_assets order by role')).map((r) => mapProductAsset(r).role), ['master', 'mockup', 'preview']);
    mapSite((await rows('select * from public.sites'))[0]); mapDomain((await rows('select * from public.domains'))[0]);
    for (const v of await rows('select * from public.site_versions')) mapSiteVersion(v);
    assert.equal(await one('select count(*)::int as result from public.products where id=$1', [pb]), 0);
    assert.equal(await one('select count(*)::int as result from public.product_assets where product_id=$1', [pb]), 0);
    assert.equal(await one('select count(*)::int as result from public.orders where workspace_id=$1', [wb]), 0);

    // ...cannot write B's data through RPCs, direct inserts, updates or deletes.
    await assert.rejects(db.query("select public.create_business($1,'x',1,'Intruder','digital-templates')", [wb]), /Owner access required/);
    await assert.rejects(db.query("select public.create_product($1,'Intruder','document',1)", [bb]), /Owner access required/);
    await assert.rejects(db.query("select public.create_business($1,'x',1,'Bad model','membership')", [wa]), /constraint/);
    await assert.rejects(db.query("insert into public.businesses(workspace_id,blueprint_id,blueprint_version,niche,model) values ($1,'x',1,'n','digital-templates')", [wb]), /permission denied/);
    await assert.rejects(db.query("insert into public.products(business_id,workspace_id,title,engine,price_minor) values ($1,$2,'x','document',1)", [bb, wb]), /permission denied/);
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status) values ($1,'e2','s2',1,'AUD','paid')", [wb]), /permission denied/);
    await assert.rejects(db.query("update public.products set price_minor=1 where id=$1", [pb]), /permission denied/);
    await assert.rejects(db.query("update public.products set price_minor=1 where id=$1", [pa]), /permission denied/); // owners cannot write directly either
    await assert.rejects(db.query("update public.orders set payment_status='refunded'"), /permission denied/);
    await assert.rejects(db.query("delete from public.product_assets"), /permission denied/);
    await assert.rejects(db.query("insert into public.audit_events(workspace_id,actor,action,target,policy_version) values ($1,'a','x','y',1)", [wb]), /permission denied/);
    await assert.rejects(db.query('select * from public.stripe_events'), /permission denied/);

    // Owner B: mirror image.
    await actor(B, SB);
    for (const t of ['businesses', 'products', 'orders', 'merchant_accounts', 'usage_ledger']) assert.equal(await count(t), 1, `B sees one ${t}`);
    assert.equal((await rows('select * from public.businesses')).map(mapBusiness)[0]!.model, 'printable-art');
    assert.equal(await one('select count(*)::int as result from public.products where id=$1', [pa]), 0);
    assert.equal(await one("select count(*)::int as result from public.product_assets where role='master' and workspace_id=$1", [wa]), 0);
    await assert.rejects(db.query("select public.create_product($1,'Intruder','document',1)", [ba]), /Owner access required/);
    await assert.rejects(db.query("update public.businesses set niche='hijack' where id=$1", [ba]), /permission denied/);

    // Staff in A's workspace read products/orders but not owner-only money and audit tables.
    await db.exec('reset role');
    await db.query("insert into public.memberships values ($1,$2,'staff',true)", [wa, B]);
    await actor(B, SB);
    assert.equal(await one('select count(*)::int as result from public.products where workspace_id=$1', [wa]), 1);
    assert.equal(await one('select count(*)::int as result from public.merchant_accounts where workspace_id=$1', [wa]), 0);
    assert.equal(await one('select count(*)::int as result from public.usage_ledger where workspace_id=$1', [wa]), 0);
    await assert.rejects(db.query("select public.create_product($1,'Staff product','document',1)", [ba]), /Owner access required/);
    await db.exec('reset role');
    await db.query('delete from public.memberships where workspace_id=$1 and user_id=$2', [wa, B]);

    // Anonymous: no private table, no workspace ids, no master files, no unpublished data.
    await anon();
    for (const t of ['businesses', 'orders', 'order_items', 'merchant_accounts', 'fulfilments', 'usage_ledger', 'audit_events', 'stripe_events', 'memberships']) {
      await assert.rejects(db.query(`select * from public.${t}`), /permission denied/, `anon reads ${t}`);
    }
    await assert.rejects(db.query('select * from public.products'), /permission denied/);
    await assert.rejects(db.query('select workspace_id from public.products'), /permission denied/);
    await assert.rejects(db.query('select workspace_id from public.sites'), /permission denied/);
    await assert.rejects(db.query("insert into public.products(business_id,workspace_id,title,engine,price_minor) values ($1,$2,'x','document',1)", [ba, wa]), /permission denied/);
    await assert.rejects(db.query("select public.create_business($1,'x',1,'Anon','digital-templates')", [wa]), /permission denied/);
    const pub = await rows('select id, business_id, title, engine, price_minor, currency, version from public.products');
    assert.equal(pub.length, 1, 'only the active product of the live business is public');
    assert.equal(mapPublicProduct(pub[0]).id, pa);
    assert.deepEqual(Object.keys(mapPublicProduct(pub[0])).sort(), ['businessId', 'currency', 'engine', 'id', 'priceMinor', 'title', 'version']);
    const assets = await rows('select id, product_id, product_version, role, storage_path from public.product_assets');
    assert.deepEqual(assets.map((r) => [r.role, r.storage_path]), [['preview', 'public/a/preview.webp']], 'master files are never public');
    assert.equal((await rows('select id from public.product_assets where product_id=$1', [pb])).length, 0, 'B (draft business) has no public assets');
    await assert.rejects(db.query('select * from public.product_assets'), /permission denied/, 'anon cannot select private asset columns');
    const versions = await rows('select id, site_id, version, config, published_at from public.site_versions');
    assert.deepEqual(versions.map((r) => (r.config as { theme: string }).theme), ['calm'], 'drafts and B (not live) stay hidden');
    assert.deepEqual((await rows('select hostname from public.domains')).map((r) => r.hostname), ['shop-ax.example.test'], 'only verified domains of published live sites');
    assert.equal((await rows('select id, business_id, slug from public.sites')).length, 1);

    // The migration's value lists equal contracts.ts (every contract value is accepted, a foreign value is refused).
    await db.exec('reset role');
    const accepted = async (sql: string, vals: readonly string[], fix: string) => {
      for (const v of vals) { await db.query(sql, [v, fix]); }
    };
    await accepted('update public.businesses set status=$1 where id=$2', businessStatuses, ba);
    await accepted('update public.businesses set model=$1 where id=$2', businessModels, ba);
    await accepted('update public.products set status=$1 where id=$2', productStatuses, pa);
    await accepted('update public.domains set status=$1 where site_id=(select id from public.sites where business_id=$2) and kind=\'custom\'', domainStatuses, ba);
    await db.query("update public.site_versions set status='draft', published_at=null where status='published' and site_id=(select id from public.sites where business_id=$1)", [ba]);
    await accepted("update public.site_versions set status=$1, published_at=case when $1='published' then now() end where version=2 and site_id=(select id from public.sites where business_id=$2)", siteVersionStatuses, ba);
    for (const role of assetRoles) await db.query("insert into public.product_assets(product_id,workspace_id,product_version,role,storage_path,sha256,bytes) values ($1,$2,1,$3,$4,$5,1)", [pa, wa, role, `x/${role}`, HASH]);
    await assert.rejects(db.query("update public.businesses set status='deleted' where id=$1", [ba]), /constraint/);
    await assert.rejects(db.query("update public.products set status='sold' where id=$1", [pa]), /constraint/);
    await assert.rejects(db.query("insert into public.product_assets(product_id,workspace_id,product_version,role,storage_path,sha256,bytes) values ($1,$2,1,'secret','x/s',$3,1)", [pa, wa, HASH]), /constraint/);
    await assert.rejects(db.query("update public.products set currency='USD' where id=$1", [pa]), /constraint/);
    await assert.rejects(db.query("insert into public.domains(site_id,workspace_id,hostname) select id,workspace_id,'UPPER.example.test' from public.sites limit 1"), /constraint/);
  } finally { await db.close(); }
});
