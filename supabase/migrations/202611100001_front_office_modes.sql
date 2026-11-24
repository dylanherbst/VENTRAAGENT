-- AI front office, task A-2: operating modes and the owner approval queue.
-- 1. Per-business modes for the Setter and the Receptionist, stored on the existing per-business settings row
--    (fo_agent_settings) with their own revision, so saving modes never conflicts with saving the settings text.
--    No settings row, or modes never saved: both 'enquiry_only' (contracts.ts DEFAULT_OPERATING_MODE), revision 0.
-- 2. fo_pending_actions: actions the AI prepared in 'owner_approval' mode. Members read under RLS; only the workspace
--    owner approves or rejects; all writes go through SECURITY DEFINER functions. The app (lib/front-office/
--    pending-actions.ts) performs an approved action exactly once and records the result with fo_finish_action.
-- Value lists match apps/web/lib/front-office/contracts.ts (operatingModes, products, pendingActionKinds,
-- pendingActionStatuses); test/front-office-modes-db.test.ts compares them.

alter table public.fo_agent_settings
  add column setter_mode text not null default 'enquiry_only' check (setter_mode in ('automatic','owner_approval','enquiry_only')),
  add column receptionist_mode text not null default 'enquiry_only' check (receptionist_mode in ('automatic','owner_approval','enquiry_only')),
  add column modes_revision integer not null default 0 check (modes_revision >= 0),
  add column modes_updated_at timestamptz,
  add column modes_updated_by uuid references auth.users(id);

-- Any member reads the modes (the UI shows them); never saved: both enquiry_only, revision 0.
create function public.fo_get_operating_modes(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.fo_agent_settings;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  select * into s from public.fo_agent_settings where workspace_id = w;
  if not found then
    return jsonb_build_object('modes', jsonb_build_object('setter','enquiry_only','receptionist','enquiry_only'), 'revision', 0, 'updatedAt', null);
  end if;
  return jsonb_build_object('modes', jsonb_build_object('setter', s.setter_mode, 'receptionist', s.receptionist_mode),
    'revision', s.modes_revision, 'updatedAt', s.modes_updated_at);
end $$;

-- Owner saves both modes. expected_revision must match (0 = never saved); someone else saved first = conflict.
-- The business settings must be saved first (the AI does not run without them). Actions already held stay held.
create function public.fo_save_operating_modes(w uuid, setter text, receptionist text, expected_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare r integer;
begin
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if setter is null or setter not in ('automatic','owner_approval','enquiry_only')
     or receptionist is null or receptionist not in ('automatic','owner_approval','enquiry_only') then raise exception 'Unknown operating mode.'; end if;
  if not exists (select 1 from public.fo_agent_settings where workspace_id = w) then raise exception 'Save the business settings first.'; end if;
  update public.fo_agent_settings set setter_mode = setter, receptionist_mode = receptionist, modes_revision = modes_revision + 1,
    modes_updated_at = now(), modes_updated_by = auth.uid()
   where workspace_id = w and modes_revision = expected_revision returning modes_revision into r;
  if r is null then raise exception 'Modes were changed elsewhere. Reload and try again.'; end if;
  return r;
end $$;

-- Not callable directly: the mode in force for one product.
create function public.fo_mode_for(w uuid, product_name text) returns text language sql stable security definer set search_path='' as $$
select coalesce((select case product_name when 'setter' then s.setter_mode when 'receptionist' then s.receptionist_mode end
                   from public.fo_agent_settings s where s.workspace_id = w), 'enquiry_only') $$;
revoke all on function public.fo_mode_for(uuid,text) from public, anon, authenticated;

-- Webhooks (no user session): the modes of the workspace that owns this channel.
create function public.fo_channel_modes(channel uuid, channel_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  return jsonb_build_object('setter', public.fo_mode_for(w, 'setter'), 'receptionist', public.fo_mode_for(w, 'receptionist'));
end $$;

-- The approval queue. status: pending -> approved -> performed | failed; pending -> rejected | expired | cancelled.
-- decided_at is set exactly when the item leaves 'pending'; committed_at exactly when it was performed.
create table public.fo_pending_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product text not null check (product in ('setter','receptionist')),
  kind text not null check (kind in ('book','reschedule','cancel','send','follow_up','transfer')),
  -- set null, not cascade: deleting a contact keeps the record of what was held and decided.
  contact_id uuid references public.fo_contacts(id) on delete set null,
  call_id uuid references public.fo_calls(id) on delete set null,
  channel_id uuid references public.fo_channels(id) on delete set null,
  mode text not null default 'owner_approval' check (mode = 'owner_approval'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8000),
  summary text not null check (length(summary) between 1 and 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','performed','failed','cancelled')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_.-]{8,120}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  committed_at timestamptz,
  note text check (note is null or length(note) <= 500),
  unique (workspace_id, idempotency_key),
  check (payload->>'kind' = kind),
  check (expires_at > created_at),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'performed') = (committed_at is not null))
);
create index fo_pending_actions_queue on public.fo_pending_actions(workspace_id, status, created_at desc);
alter table public.fo_pending_actions enable row level security;
revoke all on public.fo_pending_actions from anon, authenticated;
grant select on public.fo_pending_actions to authenticated;
create policy fo_pending_actions_read on public.fo_pending_actions for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- Webhooks (channel key): hold one action. Only in owner_approval mode for that product (automatic performs and
-- enquiry_only refuses; the app asks permissions.ts decide() first, this is the database's own guard). Idempotent per
-- workspace and key: a retried webhook gets the item it already created. ttl_minutes: 5 minutes to 30 days.
create function public.fo_request_action(channel uuid, channel_key text, product_name text, contact uuid, call uuid, action_payload jsonb,
  action_summary text, idem_key text, ttl_minutes integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; a public.fo_pending_actions; k text;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if product_name is null or product_name not in ('setter','receptionist') then raise exception 'Unknown product.'; end if;
  k := action_payload->>'kind';
  if jsonb_typeof(action_payload) is distinct from 'object' or k is null or k not in ('book','reschedule','cancel','send','follow_up','transfer') then raise exception 'Unknown action.'; end if;
  if public.fo_mode_for(w, product_name) <> 'owner_approval' then raise exception 'Not in owner approval mode.'; end if;
  if ttl_minutes is null or ttl_minutes not between 5 and 43200 then raise exception 'Expiry must be 5 minutes to 30 days.'; end if;
  if contact is not null and not exists (select 1 from public.fo_contacts where id = contact and workspace_id = w) then raise exception 'Contact not found.'; end if;
  if call is not null and not exists (select 1 from public.fo_calls where id = call and workspace_id = w) then raise exception 'Call not found.'; end if;
  insert into public.fo_pending_actions(workspace_id, product, kind, contact_id, call_id, channel_id, payload, summary, idempotency_key, expires_at)
  values (w, product_name, k, contact, call, channel, action_payload, left(trim(action_summary), 300), idem_key, now() + make_interval(mins => ttl_minutes))
  on conflict (workspace_id, idempotency_key) do nothing returning * into a;
  if found then return jsonb_build_object('item', to_jsonb(a), 'created', true); end if;
  select * into a from public.fo_pending_actions where workspace_id = w and idempotency_key = idem_key;
  return jsonb_build_object('item', to_jsonb(a), 'created', false);
end $$;

-- Members: the queue, newest first. status null = all.
create function public.fo_list_actions(w uuid, status_filter text, max_items integer) returns setof public.fo_pending_actions language plpgsql stable security definer set search_path='' as $$
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  return query select * from public.fo_pending_actions a where a.workspace_id = w and (status_filter is null or a.status = status_filter)
    order by a.created_at desc, a.id limit least(greatest(coalesce(max_items, 100), 1), 500);
end $$;

-- Members (and the app's housekeeping): pending items past their expiry become 'expired'. They never commit.
create function public.fo_expire_actions(w uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  update public.fo_pending_actions set status = 'expired', decided_at = now(), note = 'Expired before a decision.'
   where workspace_id = w and status = 'pending' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Owner: approve or reject one pending item. Exactly one caller moves it out of 'pending' (row lock); any later call,
-- or a call on an item past its expiry, changes nothing and returns the item as it is ('changed': false).
create function public.fo_decide_action(action uuid, decision text, decision_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions;
begin
  if decision is null or decision not in ('approve','reject') then raise exception 'Decision must be approve or reject.'; end if;
  select * into a from public.fo_pending_actions where id = action for update;
  if not found or public.workspace_role(a.workspace_id) is null then raise exception 'Action not found.'; end if;
  if public.workspace_role(a.workspace_id) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if a.status = 'pending' and a.expires_at <= now() then
    update public.fo_pending_actions set status = 'expired', decided_at = now(), note = 'Expired before a decision.' where id = a.id returning * into a;
    return jsonb_build_object('item', to_jsonb(a), 'changed', false);
  end if;
  if a.status <> 'pending' then return jsonb_build_object('item', to_jsonb(a), 'changed', false); end if;
  update public.fo_pending_actions set status = case decision when 'approve' then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), note = nullif(left(trim(coalesce(decision_note,'')), 500), '')
   where id = a.id returning * into a;
  return jsonb_build_object('item', to_jsonb(a), 'changed', true);
end $$;

-- Owner: record what happened when the approved item was performed. Only an 'approved' item can finish, once.
create function public.fo_finish_action(action uuid, succeeded boolean, result_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions;
begin
  select * into a from public.fo_pending_actions where id = action for update;
  if not found or public.workspace_role(a.workspace_id) is null then raise exception 'Action not found.'; end if;
  if public.workspace_role(a.workspace_id) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if a.status in ('performed','failed') then return jsonb_build_object('item', to_jsonb(a), 'changed', false); end if;
  if a.status <> 'approved' then raise exception 'Action is not approved.'; end if;
  update public.fo_pending_actions set status = case when succeeded then 'performed' else 'failed' end,
    committed_at = case when succeeded then now() end, note = nullif(left(trim(coalesce(result_note,'')), 500), '')
   where id = a.id returning * into a;
  return jsonb_build_object('item', to_jsonb(a), 'changed', true);
end $$;

revoke all on function public.fo_get_operating_modes(uuid), public.fo_save_operating_modes(uuid,text,text,integer),
  public.fo_list_actions(uuid,text,integer), public.fo_expire_actions(uuid), public.fo_decide_action(uuid,text,text),
  public.fo_finish_action(uuid,boolean,text) from public, anon;
grant execute on function public.fo_get_operating_modes(uuid), public.fo_save_operating_modes(uuid,text,text,integer),
  public.fo_list_actions(uuid,text,integer), public.fo_expire_actions(uuid), public.fo_decide_action(uuid,text,text),
  public.fo_finish_action(uuid,boolean,text) to authenticated;
revoke all on function public.fo_channel_modes(uuid,text), public.fo_request_action(uuid,text,text,uuid,uuid,jsonb,text,text,integer) from public;
grant execute on function public.fo_channel_modes(uuid,text), public.fo_request_action(uuid,text,text,uuid,uuid,jsonb,text,text,integer) to anon, authenticated;
