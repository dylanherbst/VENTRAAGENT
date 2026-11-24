-- AI front office, task A-25: a sandbox workspace for the Setter Lab and the Receptionist Lab.
-- LOCAL / PGlite ONLY until the owner approves applying it anywhere else. Never `supabase db push` this.
--
-- What it is: one ordinary workspace per signed-in user, marked workspaces.kind = 'lab', that the labs write into through
-- the REAL fo_* tables and RPCs (fo_ingest_sms, fo_book, fo_voice_*, fo_request_action ...), so a lab booking shows up in
-- that sandbox's CRM (fo_contacts / fo_appointments / fo_events) exactly as a real one would. Plus: reset (delete only
-- the sandbox's conversation rows) and named scenarios (save the lab state with a snapshot of the sandbox rows; load
-- = reset + restore that snapshot).
--
-- Isolation (RLS): the sandbox uses the same workspace_role() policies as every workspace, and its ONLY member is the
-- user it belongs to (fo_lab_sandboxes.owner_id; a trigger refuses any other membership). So no member of any other
-- workspace can read it, and its owner reads it only while signed in, like any workspace.
--
-- The "no real customer data by accident" rule, enforced in the database:
--   1. kind is set once, by fo_lab_ensure_sandbox, and can never change ('business' <-> 'lab' is refused).
--   2. A sandbox has exactly the channels fo_lab_ensure_sandbox makes, with addresses 'lab:<kind>:<workspace id>'.
--      No phone number, inbox, page id or widget id: no provider webhook can ever resolve to a sandbox. A business
--      workspace may never use a 'lab:' address.
--   3. A sandbox can never hold fo_connections rows (the per-business inbound identifiers), so inbound routing by
--      fo_resolve_connection never lands in it.
--   4. Contacts in a sandbox: email only on reserved test domains (example.com/.net/.org, *.example, *.test,
--      *.invalid, *.localhost; RFC 2606/6761) and never source 'import'. Phone numbers cannot be checked for "realness";
--      they only ever arrive through a lab channel, which only the lab (holding the channel key) can call.
--   5. Reset, scenario save and scenario load refuse any workspace that is not the caller's own sandbox, so they can
--      never touch a business workspace's rows (not even for that business's owner).
-- Scenario snapshots are captured by the database itself from the sandbox's rows; a client supplies only the lab's own
-- UI state (an opaque, size-capped JSON object). A client can never inject rows.

-- 1. The marker.
alter table public.workspaces add column kind text not null default 'business' check (kind in ('business','lab'));

create function public.fo_lab_kind_fixed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind is distinct from old.kind then raise exception 'A workspace kind cannot change.'; end if;
  return new;
end $$;
create trigger fo_lab_kind_fixed before update on public.workspaces for each row execute function public.fo_lab_kind_fixed();

create function public.fo_is_lab(w uuid) returns boolean language sql stable security definer set search_path='' as $$
select coalesce((select kind = 'lab' from public.workspaces where id = w), false) $$;

-- One sandbox per user, covering both labs.
create table public.fo_lab_sandboxes (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  owner_id uuid not null unique references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.fo_lab_sandboxes enable row level security;
revoke all on public.fo_lab_sandboxes from anon, authenticated;
grant select on public.fo_lab_sandboxes to authenticated;
create policy fo_lab_sandboxes_read on public.fo_lab_sandboxes for select to authenticated using (owner_id = auth.uid() and public.workspace_role(workspace_id) = 'owner');

create function public.fo_lab_sandbox_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.fo_is_lab(new.workspace_id) then raise exception 'Only a lab workspace can be a sandbox.'; end if;
  return new;
end $$;
create trigger fo_lab_sandbox_guard before insert or update on public.fo_lab_sandboxes for each row execute function public.fo_lab_sandbox_guard();

-- 2. Membership: a sandbox has exactly one member, its owner.
create function public.fo_lab_membership_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) and (new.role <> 'owner' or not exists (
       select 1 from public.fo_lab_sandboxes s where s.workspace_id = new.workspace_id and s.owner_id = new.user_id)) then
    raise exception 'A lab sandbox has no other members.';
  end if;
  return new;
end $$;
create trigger fo_lab_membership_guard before insert or update on public.memberships for each row execute function public.fo_lab_membership_guard();

-- 3. Channels: sandbox channels only on 'lab:' addresses; business channels never.
create function public.fo_lab_channel_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) then
    if new.address is distinct from 'lab:' || new.kind || ':' || new.workspace_id::text then raise exception 'A lab sandbox only has lab channels.'; end if;
  elsif new.address like 'lab:%' then
    raise exception 'Lab addresses are reserved for the lab sandbox.';
  end if;
  return new;
end $$;
create trigger fo_lab_channel_guard before insert or update on public.fo_channels for each row execute function public.fo_lab_channel_guard();

-- 4. No inbound identifiers in a sandbox.
create function public.fo_lab_connection_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) then raise exception 'A lab sandbox cannot be connected to a real channel.'; end if;
  return new;
end $$;
create trigger fo_lab_connection_guard before insert or update on public.fo_connections for each row execute function public.fo_lab_connection_guard();

-- 5. Contacts: test email domains only, no imports.
create function public.fo_lab_contact_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) then
    if new.source = 'import' then raise exception 'Contacts cannot be imported into the lab sandbox.'; end if;
    if new.email is not null and new.email !~* '@(([a-z0-9-]+\.)*example\.(com|net|org)|([a-z0-9-]+\.)+(example|test|invalid|localhost))$' then
      raise exception 'The lab sandbox only accepts test email addresses (for example name@example.com).';
    end if;
  end if;
  return new;
end $$;
create trigger fo_lab_contact_guard before insert or update on public.fo_contacts for each row execute function public.fo_lab_contact_guard();

revoke all on function public.fo_lab_kind_fixed(), public.fo_is_lab(uuid), public.fo_lab_sandbox_guard(), public.fo_lab_membership_guard(),
  public.fo_lab_channel_guard(), public.fo_lab_connection_guard(), public.fo_lab_contact_guard() from public, anon, authenticated;

-- Not callable directly: the caller's own sandbox, or an error that says nothing about other workspaces.
create function public.fo_lab_require(w uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if w is null or public.workspace_role(w) is distinct from 'owner' or not public.fo_is_lab(w)
     or not exists (select 1 from public.fo_lab_sandboxes s where s.workspace_id = w and s.owner_id = auth.uid()) then
    raise exception 'Lab sandbox not found.';
  end if;
  return w;
end $$;

-- The signed-in user's sandbox: created on first call (workspace, owner membership, one 'sms' and one 'voice' lab
-- channel), returned as is afterwards. channel_key (32 to 200 characters) becomes the key of both lab channels; only its
-- SHA-256 is stored. Pass the same key every time (derive it on the server, see lib/supabase/lab-sandbox.ts); a
-- different key replaces the old one.
create function public.fo_lab_ensure_sandbox(channel_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); w uuid; mine uuid; h text; created boolean := false; k text;
begin
  if not public.session_active() then raise exception 'Sign in required.'; end if;
  if length(coalesce(channel_key,'')) not between 32 and 200 then raise exception 'Channel key must be 32 to 200 characters.'; end if;
  h := encode(sha256(convert_to(channel_key, 'UTF8')), 'hex');
  select s.workspace_id into w from public.fo_lab_sandboxes s where s.owner_id = uid;
  if w is null then
    insert into public.workspaces(name, kind) values ('Lab sandbox', 'lab') returning id into mine;
    insert into public.fo_lab_sandboxes(workspace_id, owner_id) values (mine, uid) on conflict (owner_id) do nothing;
    if found then w := mine; created := true;
    else
      -- Another request made it first: drop ours, use theirs.
      delete from public.workspaces where id = mine;
      select s.workspace_id into w from public.fo_lab_sandboxes s where s.owner_id = uid;
    end if;
  end if;
  insert into public.memberships(workspace_id, user_id, role, active) values (w, uid, 'owner', true) on conflict (workspace_id, user_id) do nothing;
  foreach k in array array['sms','voice'] loop
    insert into public.fo_channels(workspace_id, kind, address, key_hash) values (w, k, 'lab:' || k || ':' || w::text, h)
    on conflict (kind, address) do update set key_hash = excluded.key_hash, active = true;
  end loop;
  return jsonb_build_object('workspace', w, 'created', created, 'channels',
    (select jsonb_object_agg(c.kind, jsonb_build_object('id', c.id, 'address', c.address)) from public.fo_channels c where c.workspace_id = w));
end $$;

-- Not callable directly: delete every conversation row of a sandbox (contacts and everything hanging off them, calls,
-- held actions, outbox). Channels, settings, modes and scenarios stay. Returns per-table counts.
create function public.fo_lab_clear(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n jsonb := '{}'; c integer;
begin
  if not public.fo_is_lab(w) then raise exception 'Lab sandbox not found.'; end if;
  delete from public.fo_pending_actions where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('pendingActions', c);
  delete from public.fo_outbox where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('outbox', c);
  delete from public.fo_jobs where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('jobs', c);
  delete from public.fo_calls where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('calls', c);
  delete from public.fo_handoffs where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('handoffs', c);
  delete from public.fo_appointments where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('appointments', c);
  delete from public.fo_messages where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('messages', c);
  delete from public.fo_events where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('events', c);
  delete from public.fo_contacts where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('contacts', c);
  return n;
end $$;

-- Owner of the sandbox: reset it.
create function public.fo_lab_reset(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.fo_lab_require(w);
  perform 1 from public.workspaces where id = w for update;
  return public.fo_lab_clear(w);
end $$;

-- Not callable directly: the sandbox's conversation rows as one JSON object (the tables fo_lab_clear empties).
create function public.fo_lab_snapshot(w uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('v', 1,
  'contacts', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_contacts t where t.workspace_id = w), '[]'),
  'calls', coalesce((select jsonb_agg(to_jsonb(t) order by t.started_at, t.id) from public.fo_calls t where t.workspace_id = w), '[]'),
  'messages', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_messages t where t.workspace_id = w), '[]'),
  'events', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.fo_events t where t.workspace_id = w), '[]'),
  'handoffs', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_handoffs t where t.workspace_id = w), '[]'),
  'appointments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_appointments t where t.workspace_id = w), '[]'),
  'jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_jobs t where t.workspace_id = w), '[]'),
  'outbox', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_outbox t where t.workspace_id = w), '[]'),
  'pendingActions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_pending_actions t where t.workspace_id = w), '[]')) $$;

-- Not callable directly: put a snapshot back into an EMPTY sandbox (call fo_lab_clear first). Only rows of this sandbox
-- are restored; event ids are kept so the activity feed order is the same as when it was saved.
create function public.fo_lab_restore(w uuid, snap jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n jsonb := '{}'; c integer;
begin
  if not public.fo_is_lab(w) then raise exception 'Lab sandbox not found.'; end if;
  if snap->>'v' is distinct from '1' then raise exception 'This scenario was saved by another version. Save it again.'; end if;
  begin
    insert into public.fo_contacts select * from jsonb_populate_recordset(null::public.fo_contacts, coalesce(snap->'contacts','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('contacts', c);
    insert into public.fo_calls select * from jsonb_populate_recordset(null::public.fo_calls, coalesce(snap->'calls','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('calls', c);
    insert into public.fo_messages select * from jsonb_populate_recordset(null::public.fo_messages, coalesce(snap->'messages','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('messages', c);
    insert into public.fo_events overriding system value select * from jsonb_populate_recordset(null::public.fo_events, coalesce(snap->'events','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('events', c);
    insert into public.fo_handoffs select * from jsonb_populate_recordset(null::public.fo_handoffs, coalesce(snap->'handoffs','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('handoffs', c);
    insert into public.fo_appointments select * from jsonb_populate_recordset(null::public.fo_appointments, coalesce(snap->'appointments','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('appointments', c);
    insert into public.fo_jobs select * from jsonb_populate_recordset(null::public.fo_jobs, coalesce(snap->'jobs','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('jobs', c);
    insert into public.fo_outbox select * from jsonb_populate_recordset(null::public.fo_outbox, coalesce(snap->'outbox','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('outbox', c);
    insert into public.fo_pending_actions select * from jsonb_populate_recordset(null::public.fo_pending_actions, coalesce(snap->'pendingActions','[]')) where workspace_id = w;
    get diagnostics c = row_count; n := n || jsonb_build_object('pendingActions', c);
  exception when not_null_violation or check_violation or foreign_key_violation or unique_violation or invalid_text_representation then
    raise exception 'This scenario could not be restored. Reset the lab and save it again.';
  end;
  return n;
end $$;

revoke all on function public.fo_lab_require(uuid), public.fo_lab_clear(uuid), public.fo_lab_snapshot(uuid), public.fo_lab_restore(uuid,jsonb) from public, anon, authenticated;

-- 6. Named scenarios, per sandbox and lab. Read and written only through the functions below.
create table public.fo_lab_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.fo_lab_sandboxes(workspace_id) on delete cascade,
  product text not null check (product in ('setter','receptionist')),
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9 _.,()-]{0,79}$'),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 512000),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 2000000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, product, name)
);
alter table public.fo_lab_scenarios enable row level security;
revoke all on public.fo_lab_scenarios from anon, authenticated;

-- Save the lab's state together with a snapshot of the sandbox rows taken now. expected_revision 0 creates (the name must
-- be free); otherwise it must match the stored revision (saved elsewhere first = conflict). At most 50 per lab.
create function public.fo_lab_save_scenario(w uuid, product_name text, scenario_name text, lab_state jsonb, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.fo_lab_scenarios; snap jsonb;
begin
  perform public.fo_lab_require(w);
  if product_name is null or product_name not in ('setter','receptionist') then raise exception 'Unknown lab.'; end if;
  if scenario_name is null or scenario_name !~ '^[A-Za-z0-9][A-Za-z0-9 _.,()-]{0,79}$' then raise exception 'Scenario name must be 1 to 80 letters, numbers or spaces.'; end if;
  if jsonb_typeof(lab_state) is distinct from 'object' or octet_length(lab_state::text) > 512000 then raise exception 'Lab state is not valid or too large.'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Revision required.'; end if;
  perform 1 from public.workspaces where id = w for update;
  snap := public.fo_lab_snapshot(w);
  if octet_length(snap::text) > 2000000 then raise exception 'The sandbox holds too much to save. Reset it first.'; end if;
  if expected_revision = 0 then
    if (select count(*) from public.fo_lab_scenarios where workspace_id = w and product = product_name) >= 50 then raise exception 'Too many saved scenarios. Delete one first.'; end if;
    insert into public.fo_lab_scenarios(workspace_id, product, name, state, snapshot) values (w, product_name, scenario_name, lab_state, snap)
    on conflict (workspace_id, product, name) do nothing returning * into s;
    if s.id is null then raise exception 'A scenario with this name already exists.'; end if;
  else
    update public.fo_lab_scenarios set state = lab_state, snapshot = snap, revision = revision + 1, updated_at = now()
     where workspace_id = w and product = product_name and name = scenario_name and revision = expected_revision returning * into s;
    if s.id is null then raise exception 'Scenario was changed elsewhere. Reload and try again.'; end if;
  end if;
  return jsonb_build_object('id', s.id, 'product', s.product, 'name', s.name, 'revision', s.revision, 'updatedAt', s.updated_at,
    'contacts', jsonb_array_length(snap->'contacts'), 'appointments', jsonb_array_length(snap->'appointments'));
end $$;

-- The saved scenarios of one lab, newest first (no state or snapshot bodies).
create function public.fo_lab_list_scenarios(w uuid, product_name text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.fo_lab_require(w);
  if product_name is null or product_name not in ('setter','receptionist') then raise exception 'Unknown lab.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'product', s.product, 'name', s.name, 'revision', s.revision, 'updatedAt', s.updated_at,
      'contacts', jsonb_array_length(s.snapshot->'contacts'), 'appointments', jsonb_array_length(s.snapshot->'appointments')) order by s.updated_at desc, s.name)
    from public.fo_lab_scenarios s where s.workspace_id = w and s.product = product_name), '[]');
end $$;

-- Load: reset the sandbox and restore the saved rows, in one transaction; returns the saved lab state.
create function public.fo_lab_load_scenario(w uuid, product_name text, scenario_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.fo_lab_scenarios; cleared jsonb; restored jsonb;
begin
  perform public.fo_lab_require(w);
  perform 1 from public.workspaces where id = w for update;
  select * into s from public.fo_lab_scenarios where workspace_id = w and product = product_name and name = scenario_name;
  if not found then raise exception 'Scenario not found.'; end if;
  cleared := public.fo_lab_clear(w);
  restored := public.fo_lab_restore(w, s.snapshot);
  return jsonb_build_object('id', s.id, 'product', s.product, 'name', s.name, 'revision', s.revision, 'updatedAt', s.updated_at,
    'state', s.state, 'cleared', cleared, 'restored', restored);
end $$;

create function public.fo_lab_delete_scenario(w uuid, product_name text, scenario_name text, expected_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.fo_lab_require(w);
  delete from public.fo_lab_scenarios where workspace_id = w and product = product_name and name = scenario_name and revision = expected_revision;
  if not found then raise exception 'Scenario was changed or removed elsewhere. Reload and try again.'; end if;
  return true;
end $$;

-- The lab switches operating modes freely (no revision check, sandbox only). The lab settings must be saved first with
-- fo_save_agent_settings, as for any workspace.
create function public.fo_lab_set_modes(w uuid, setter text, receptionist text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r integer;
begin
  perform public.fo_lab_require(w);
  if setter is null or setter not in ('automatic','owner_approval','enquiry_only')
     or receptionist is null or receptionist not in ('automatic','owner_approval','enquiry_only') then raise exception 'Unknown operating mode.'; end if;
  update public.fo_agent_settings set setter_mode = setter, receptionist_mode = receptionist, modes_revision = modes_revision + 1,
    modes_updated_at = now(), modes_updated_by = auth.uid() where workspace_id = w returning modes_revision into r;
  if r is null then raise exception 'Save the lab settings first.'; end if;
  return jsonb_build_object('modes', jsonb_build_object('setter', setter, 'receptionist', receptionist), 'revision', r);
end $$;

revoke all on function public.fo_lab_ensure_sandbox(text), public.fo_lab_reset(uuid), public.fo_lab_save_scenario(uuid,text,text,jsonb,integer),
  public.fo_lab_list_scenarios(uuid,text), public.fo_lab_load_scenario(uuid,text,text), public.fo_lab_delete_scenario(uuid,text,text,integer),
  public.fo_lab_set_modes(uuid,text,text) from public, anon;
grant execute on function public.fo_lab_ensure_sandbox(text), public.fo_lab_reset(uuid), public.fo_lab_save_scenario(uuid,text,text,jsonb,integer),
  public.fo_lab_list_scenarios(uuid,text), public.fo_lab_load_scenario(uuid,text,text), public.fo_lab_delete_scenario(uuid,text,text,integer),
  public.fo_lab_set_modes(uuid,text,text) to authenticated;
