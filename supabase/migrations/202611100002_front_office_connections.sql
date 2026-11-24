-- AI front office, task A-15: per-business connection records.
-- fo_connections says which business owns an inbound identifier (a phone number, a Meta page id, an inbox address,
-- a Vapi assistant id, a website chat widget id). A server route that receives an inbound event resolves the business
-- with fo_resolve_connection(kind, external id) instead of reading one business from global env.
--
-- NO SECRETS HERE. This table holds only public, non-secret identifiers. Access tokens, API keys, signing secrets and
-- passwords stay in env / the vault and are never stored in fo_connections. test/front-office-connections-db.test.ts
-- asserts the exact column list; adding a column means updating that test on purpose.
--
-- kind uses the same words as fo_channels.kind and contracts.ts connectionTargets (without 'google-calendar', which is
-- not an inbound channel). 'whatsapp' is allowed here only; fo_channels.kind is unchanged because contracts.ts
-- channelKinds and the ingest functions do not know WhatsApp yet (A-11).
-- One identifier maps to exactly one business: unique (kind, external_id), stored in one canonical form per kind.
-- Members read (RLS); only the owner writes, through SECURITY DEFINER functions with a revision check. The owner sets
-- not_connected, pending or disabled only; 'connected' and 'error' are set only by a server verification step
-- (service_role, fo_mark_connection_state), so an owner cannot claim an identifier is verified.

create table public.fo_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('web-chat','sms','email','voice','instagram','messenger','whatsapp')),
  -- Canonical form per kind (fo_connection_external_id): E.164 phone, lower-case email, numeric Meta id, lower-case
  -- uuid (Vapi), or a short widget id.
  external_id text not null,
  label text check (label is null or (length(label) between 1 and 80 and label !~ '[A-Za-z0-9_+/=.-]{33,}')),
  state text not null default 'not_connected' check (state in ('not_connected','pending','connected','error','disabled')),
  -- Plain-language reason for 'error' (never a provider response body or a credential).
  state_note text check (state_note is null or (length(state_note) between 1 and 300 and state_note !~ '[A-Za-z0-9_+/=.-]{33,}')),
  -- Optional link to the existing keyed channel row of the same business (set null if that channel is removed).
  channel_id uuid references public.fo_channels(id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  connected_at timestamptz,
  -- Last user who saved it; null after a server verification step or when that user is deleted.
  updated_by uuid references auth.users(id) on delete set null,
  unique (kind, external_id),
  constraint fo_connections_external_id_format check (case kind
    when 'sms' then external_id ~ '^\+[1-9][0-9]{6,14}$'
    when 'whatsapp' then external_id ~ '^\+[1-9][0-9]{6,14}$'
    when 'voice' then external_id ~ '^\+[1-9][0-9]{6,14}$' or external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when 'email' then external_id ~ '^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$' and length(external_id) <= 254
    when 'instagram' then external_id ~ '^[0-9]{5,30}$'
    when 'messenger' then external_id ~ '^[0-9]{5,30}$'
    when 'web-chat' then external_id ~ '^[A-Za-z0-9_-]{8,64}$'
    else false end),
  check ((state = 'error') = (state_note is not null)),
  check ((state = 'connected') = (connected_at is not null))
);
comment on table public.fo_connections is 'Per-business inbound identifiers (non-secret only). Never store tokens, keys, secrets or passwords here.';
comment on column public.fo_connections.external_id is 'Public identifier only (phone, page id, inbox, Vapi id, widget id). Not a credential.';
create index fo_connections_workspace on public.fo_connections(workspace_id, kind);
alter table public.fo_connections enable row level security;
revoke all on public.fo_connections from anon, authenticated;
grant select on public.fo_connections to authenticated;
create policy fo_connections_read on public.fo_connections for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- Not callable directly: the canonical form of an identifier for a kind, or null when it is not valid for that kind.
create function public.fo_connection_external_id(channel_kind text, raw text) returns text language plpgsql immutable set search_path='' as $$
declare v text := btrim(coalesce(raw, ''));
begin
  if channel_kind in ('sms','whatsapp') then
    v := regexp_replace(v, '[\s().-]', '', 'g');
    return case when v ~ '^\+[1-9][0-9]{6,14}$' then v end;
  elsif channel_kind = 'voice' then
    if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return lower(v); end if;
    v := regexp_replace(v, '[\s().-]', '', 'g');
    return case when v ~ '^\+[1-9][0-9]{6,14}$' then v end;
  elsif channel_kind = 'email' then
    v := lower(v);
    return case when v ~ '^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$' and length(v) <= 254 then v end;
  elsif channel_kind in ('instagram','messenger') then
    return case when v ~ '^[0-9]{5,30}$' then v end;
  elsif channel_kind = 'web-chat' then
    return case when v ~ '^[A-Za-z0-9_-]{8,64}$' then v end;
  end if;
  return null;
end $$;
revoke all on function public.fo_connection_external_id(text,text) from public, anon, authenticated;

-- Members: this business's connections, by kind then identifier.
create function public.fo_list_connections(w uuid) returns setof public.fo_connections language plpgsql stable security definer set search_path='' as $$
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  return query select * from public.fo_connections c where c.workspace_id = w order by c.kind, c.external_id;
end $$;

-- Owner: create (connection null, expected_revision 0) or update (expected_revision = current revision) one record.
-- connection_state: 'not_connected', 'pending' or 'disabled'. 'connected' and 'error' are refused (server verification
-- only, fo_mark_connection_state). null = keep the current state on update while the identifier is unchanged; a new
-- record, or a changed identifier, starts as 'not_connected' (it must be verified again).
-- An identifier held by another business, or a channel of another business, gets the same generic refusal
-- ('Could not save this connection.') so the function never confirms what another business holds.
create function public.fo_save_connection(w uuid, connection uuid, channel_kind text, external text, connection_state text,
  connection_label text, channel uuid, expected_revision integer) returns public.fo_connections
  language plpgsql security definer set search_path='' as $$
declare v text; lbl text; st text; cn text; cur public.fo_connections; r public.fo_connections; same_id boolean;
begin
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if channel_kind is null or channel_kind not in ('web-chat','sms','email','voice','instagram','messenger','whatsapp') then raise exception 'Unknown channel.'; end if;
  if connection_state in ('connected','error') then raise exception 'Only a server check can mark a connection connected or failed.'; end if;
  if connection_state is not null and connection_state not in ('not_connected','pending','disabled') then raise exception 'Unknown connection state.'; end if;
  v := public.fo_connection_external_id(channel_kind, external);
  if v is null then raise exception 'Identifier is not valid for this channel.'; end if;
  lbl := nullif(btrim(coalesce(connection_label, '')), '');
  if lbl is not null and (length(lbl) > 80 or lbl ~ '[A-Za-z0-9_+/=.-]{33,}') then raise exception 'Label is not valid.'; end if;
  if channel is not null and not exists (select 1 from public.fo_channels where id = channel and workspace_id = w) then raise exception 'Could not save this connection.'; end if;
  begin
    if connection is null then
      if coalesce(expected_revision, -1) <> 0 then raise exception 'Connection was changed elsewhere. Reload and try again.'; end if;
      insert into public.fo_connections(workspace_id, kind, external_id, label, state, channel_id, updated_by)
      values (w, channel_kind, v, lbl, coalesce(connection_state, 'not_connected'), channel, auth.uid()) returning * into r;
    else
      select * into cur from public.fo_connections c where c.id = connection and c.workspace_id = w for update;
      if not found then raise exception 'Connection not found.'; end if;
      if cur.revision is distinct from expected_revision then raise exception 'Connection was changed elsewhere. Reload and try again.'; end if;
      same_id := cur.kind = channel_kind and cur.external_id = v;
      st := coalesce(connection_state, case when same_id then cur.state else 'not_connected' end);
      update public.fo_connections c set kind = channel_kind, external_id = v, label = lbl, state = st, channel_id = channel,
        state_note = case when st = cur.state and same_id then cur.state_note end,
        connected_at = case when st = cur.state and same_id then cur.connected_at end,
        revision = c.revision + 1, updated_at = now(), updated_by = auth.uid()
       where c.id = cur.id returning * into r;
    end if;
  exception
    when unique_violation then
      if exists (select 1 from public.fo_connections where kind = channel_kind and external_id = v and workspace_id = w) then
        raise exception 'This business already has this identifier.';
      end if;
      raise exception 'Could not save this connection.';
    when check_violation then
      get stacked diagnostics cn = constraint_name;
      if cn = 'fo_connections_external_id_format' then raise exception 'Identifier is not valid for this channel.'; end if;
      raise;
  end;
  return r;
end $$;

-- Server verification step only (service_role): record the result of checking a connection with the provider.
-- new_state: 'connected', 'error', 'pending' or 'not_connected'. A disabled record stays disabled (the owner's choice).
-- note: plain-language reason, kept only for 'error'. Bumps the revision so an owner's stale save is refused.
create function public.fo_mark_connection_state(connection uuid, new_state text, note text) returns public.fo_connections
  language plpgsql security definer set search_path='' as $$
declare cur public.fo_connections; r public.fo_connections; nt text;
begin
  if new_state is null or new_state not in ('connected','error','pending','not_connected') then raise exception 'Unknown connection state.'; end if;
  select * into cur from public.fo_connections where id = connection for update;
  if not found then raise exception 'Connection not found.'; end if;
  if cur.state = 'disabled' then raise exception 'Connection is disabled.'; end if;
  nt := case when new_state = 'error' then coalesce(nullif(left(btrim(coalesce(note, '')), 300), ''), 'Connection error.') end;
  if nt is not null and nt ~ '[A-Za-z0-9_+/=.-]{33,}' then raise exception 'Note is not valid.'; end if;
  update public.fo_connections set state = new_state, state_note = nt,
    connected_at = case when new_state <> 'connected' then null when cur.state = 'connected' then cur.connected_at else now() end,
    revision = revision + 1, updated_at = now(), updated_by = null
   where id = cur.id returning * into r;
  return r;
end $$;

-- Owner: remove one record (revision must match).
create function public.fo_delete_connection(connection uuid, expected_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare w uuid; rev integer;
begin
  select workspace_id, revision into w, rev from public.fo_connections where id = connection;
  if not found or public.workspace_role(w) is null then raise exception 'Connection not found.'; end if;
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if rev is distinct from expected_revision then raise exception 'Connection was changed elsewhere. Reload and try again.'; end if;
  delete from public.fo_connections where id = connection and revision = expected_revision;
  return found;
end $$;

-- Server routes only (service_role): which business owns this inbound identifier. Only 'connected' records resolve;
-- unknown, invalid, pending, error, disabled and not_connected identifiers all return null (no reason given).
create function public.fo_resolve_connection(channel_kind text, external text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v text; r public.fo_connections;
begin
  v := public.fo_connection_external_id(channel_kind, external);
  if v is null then return null; end if;
  select * into r from public.fo_connections c where c.kind = channel_kind and c.external_id = v and c.state = 'connected';
  if not found then return null; end if;
  return jsonb_build_object('workspaceId', r.workspace_id, 'connectionId', r.id, 'channelId', r.channel_id, 'kind', r.kind, 'externalId', r.external_id);
end $$;

revoke all on function public.fo_list_connections(uuid), public.fo_save_connection(uuid,uuid,text,text,text,text,uuid,integer),
  public.fo_delete_connection(uuid,integer) from public, anon;
grant execute on function public.fo_list_connections(uuid), public.fo_save_connection(uuid,uuid,text,text,text,text,uuid,integer),
  public.fo_delete_connection(uuid,integer) to authenticated;
revoke all on function public.fo_resolve_connection(text,text), public.fo_mark_connection_state(uuid,text,text) from public, anon, authenticated;
grant execute on function public.fo_resolve_connection(text,text), public.fo_mark_connection_state(uuid,text,text) to service_role;
