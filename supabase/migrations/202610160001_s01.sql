-- Isolated development only. No service-role client is required by the app.
begin;
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 160));
create table public.memberships (workspace_id uuid references public.workspaces(id) on delete cascade, user_id uuid references auth.users(id), role text not null check (role in ('owner','staff')), active boolean not null default true, primary key(workspace_id,user_id));
create table public.business_profiles (workspace_id uuid primary key references public.workspaces(id), data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=32000), revision integer not null default 1 check(revision>0));
create table public.offers (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.business_profiles(workspace_id), data jsonb not null, revision integer not null default 1 check(revision>0), check(jsonb_typeof(data)='object' and octet_length(data::text)<=16000), check(data->>'kind' in ('service','education','product')), check(data->>'currency' in ('AUD','USD','GBP','EUR','NZD','CAD')), check((data->>'amountMinor')::numeric between 0 and 9007199254740991 and (data->>'amountMinor')::numeric=trunc((data->>'amountMinor')::numeric)), check(length(trim(data->>'name')) between 1 and 160));
create table public.draft_imports (workspace_id uuid primary key references public.workspaces(id), payload jsonb not null, imported_at timestamptz not null default now());
create function public.session_active() returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())) $$;
revoke all on function public.session_active() from public, anon;
grant execute on function public.session_active() to authenticated;
-- SECURITY DEFINER helpers avoid recursive membership policies; no caller controls actor.
create function public.workspace_role(w uuid) returns text language sql stable security definer set search_path='' as $$ select role from public.memberships where workspace_id=w and user_id=auth.uid() and active and public.session_active() $$;
revoke all on function public.workspace_role(uuid) from public, anon;
grant execute on function public.workspace_role(uuid) to authenticated;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.business_profiles enable row level security;
alter table public.offers enable row level security;
alter table public.draft_imports enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.workspace_role(id) is not null);
create policy member_read on public.memberships for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy profile_read on public.business_profiles for select to authenticated using(public.workspace_role(workspace_id) is not null);
create policy offer_read on public.offers for select to authenticated using(public.workspace_role(workspace_id) is not null);
-- No direct writes, membership mutation, deletes, or import reads granted. RPC is the write boundary.
revoke all on public.workspaces, public.memberships, public.business_profiles, public.offers, public.draft_imports from anon, authenticated;
grant select on public.workspaces, public.memberships, public.business_profiles, public.offers to authenticated;
create function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; begin
if not public.session_active() then raise exception 'Sign in required'; end if;
insert into public.workspaces(name) values(workspace_name) returning id into w;
insert into public.memberships values(w,auth.uid(),'owner',true); return w; end $$;
create function public.save_profile(w uuid, payload jsonb, expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
perform 1 from public.workspaces where id=w for update;
if exists(select 1 from public.offers where workspace_id=w and not (payload->'pathways' ? (case when data->>'kind'='education' then 'education' else 'business' end))) then raise exception 'Existing offers require their active pathways'; end if;
if expected_revision=0 then insert into public.business_profiles(workspace_id,data) values(w,payload);
else update public.business_profiles set data=payload, revision=revision+1 where workspace_id=w and revision=expected_revision;
if not found then raise exception 'Profile changed. Refresh before saving'; end if; end if; end $$;
create function public.save_offer(w uuid, offer_id uuid, payload jsonb, expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
perform 1 from public.workspaces where id=w for update;
if not exists(select 1 from public.business_profiles where workspace_id=w and data->'pathways' ? (case when payload->>'kind'='education' then 'education' else 'business' end)) then raise exception 'Activate the offer pathway first'; end if;
if expected_revision=0 then insert into public.offers(id,workspace_id,data) values(offer_id,w,payload);
else update public.offers set data=payload,revision=revision+1 where id=offer_id and workspace_id=w and revision=expected_revision;
if not found then raise exception 'Offer changed. Refresh before saving'; end if; end if; end $$;
create function public.import_drafts(w uuid, payload jsonb) returns text language plpgsql security definer set search_path='' as $$
declare previous jsonb; item jsonb; begin
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
perform 1 from public.workspaces where id=w for update;
select d.payload into previous from public.draft_imports d where workspace_id=w;
if found then if previous=payload then return 'already_imported'; else raise exception 'A different import already exists. No records changed'; end if; end if;
if exists(select 1 from public.business_profiles where workspace_id=w) then raise exception 'Import needs an empty workspace. No records changed'; end if;
if jsonb_typeof(payload->'offers') is distinct from 'array' or jsonb_array_length(payload->'offers')>100 then raise exception 'Invalid import'; end if;
if (select count(distinct value->>'id') from jsonb_array_elements(payload->'offers'))<>jsonb_array_length(payload->'offers') then raise exception 'Duplicate import offer IDs'; end if;
insert into public.business_profiles(workspace_id,data) values(w,payload->'profile');
for item in select value from jsonb_array_elements(payload->'offers') loop
if not (payload->'profile'->'pathways' ? (case when item->>'kind'='education' then 'education' else 'business' end)) then raise exception 'Offer pathway is not active'; end if;
insert into public.offers(workspace_id,data) values(w,item); end loop;
insert into public.draft_imports(workspace_id,payload) values(w,payload); return 'imported'; end $$;
revoke all on function public.create_workspace(text), public.save_profile(uuid,jsonb,integer), public.save_offer(uuid,uuid,jsonb,integer), public.import_drafts(uuid,jsonb) from public, anon;
grant execute on function public.create_workspace(text), public.save_profile(uuid,jsonb,integer), public.save_offer(uuid,uuid,jsonb,integer), public.import_drafts(uuid,jsonb) to authenticated;
-- Constraints also apply to callers bypassing the application and using RPC directly.
create function public.valid_profile(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; begin
if jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from '1' or p->>'id' is distinct from 'local-business' or not coalesce(p->>'primary' in ('business','education'),false) or not coalesce(p->>'stage' in ('idea','existing'),false) then return false; end if;
if jsonb_typeof(p->'pathways') is distinct from 'array' then return false; end if;
if jsonb_array_length(p->'pathways') not between 1 and 2 or not (p->'pathways' ? (p->>'primary')) or (select count(distinct x) from jsonb_array_elements_text(p->'pathways') x)<>jsonb_array_length(p->'pathways') or exists(select 1 from jsonb_array_elements_text(p->'pathways') x where x not in ('business','education')) then return false; end if;
foreach k in array array['name','industry','location','audience','goal','expertise','website','channels'] loop
if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>500 then return false; end if; end loop;
foreach k in array array['name','audience','goal'] loop if length(trim(p->>k))=0 then return false; end if; end loop;
if p->'pathways' ? 'education' and length(trim(p->>'expertise'))=0 then return false; end if;
if p->'pathways' ? 'business' and length(trim(p->>'industry'))=0 then return false; end if;
if length(trim(p->>'website'))>0 and p->>'website' !~ '^https?://[^[:space:]/]+' then return false; end if;
if not coalesce(p->>'educationOffer' in ('Course','1:1 coaching','Mentorship','Group program','Workshop','In-person training'),false) or not coalesce(p->>'businessType' in ('Physical services','Physical products','Digital products & services'),false) then return false; end if;
if jsonb_typeof(p->'completed') is distinct from 'array' or jsonb_typeof(p->'toolNotes') is distinct from 'object' then return false; end if;
for v in select value from jsonb_array_elements(p->'completed') loop if jsonb_typeof(v)<>'string' then return false; end if; end loop;
for v in select value from jsonb_each(p->'toolNotes') loop if jsonb_typeof(v)<>'string' then return false; end if; end loop;
return true; end $$;
create function public.valid_offer(o jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; begin
if jsonb_typeof(o) is distinct from 'object' or o->>'version' is distinct from '1' or o->>'profileId' is distinct from 'local-business' then return false; end if;
foreach k in array array['id','name','audience','outcome','delivery','currency','kind'] loop
if jsonb_typeof(o->k) is distinct from 'string' or length(trim(o->>k))=0 then return false; end if; end loop;
return length(o->>'id')<=160 and length(o->>'name')<=160 and length(o->>'audience')<=500 and length(o->>'outcome')<=3000 and length(o->>'delivery')<=3000
and o->>'kind' in ('service','education','product') and o->>'currency' in ('AUD','USD','GBP','EUR','NZD','CAD')
and jsonb_typeof(o->'amountMinor')='number' and (o->>'amountMinor')::numeric between 0 and 9007199254740991 and (o->>'amountMinor')::numeric=trunc((o->>'amountMinor')::numeric);
end $$;
alter table public.business_profiles add constraint profile_valid check(public.valid_profile(data));
alter table public.offers add constraint offer_valid check(coalesce(public.valid_offer(data),false));
revoke all on function public.valid_profile(jsonb), public.valid_offer(jsonb) from public, anon;
grant execute on function public.valid_profile(jsonb), public.valid_offer(jsonb) to authenticated;
commit;
