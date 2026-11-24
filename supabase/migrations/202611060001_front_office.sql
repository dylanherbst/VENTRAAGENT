-- AI front office, Phase 0 (docs/agents/SCOPE_FREEZE.md; tracker 0.2 to 0.6).
-- One record per contact shared by every agent, a state machine, an append-only event log, a message log with the
-- prompt version on every automated send, and the handoff contract. Members read under RLS; all writes go through
-- SECURITY DEFINER functions. Channel webhooks have no user session, so they authenticate with a per-channel key
-- whose SHA-256 is stored (the key itself is never stored).

create table public.fo_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('sms','web-chat','email','voice')),
  address text not null check (length(address) between 3 and 254),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, address)
);
create table public.fo_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (email is null or length(email) <= 254),
  name text check (name is null or length(name) <= 160),
  state text not null default 'new' check (state in ('new','contacted','qualifying','qualified','booked','no-show','disqualified','nurture','customer')),
  source text not null default 'inbound' check (source in ('inbound','organic','import','manual')),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  unique (workspace_id, phone),
  unique (workspace_id, email)
);
create table public.fo_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  channel_id uuid references public.fo_channels(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null check (length(body) <= 4000),
  agent text check (agent in ('setter','sales','receptionist','onboarding','human','system')),
  prompt_version text check (prompt_version is null or length(prompt_version) between 1 and 120),
  provider_id text check (provider_id is null or length(provider_id) <= 120),
  created_at timestamptz not null default now(),
  -- Tracker 0.6: every automated send records the prompt version that produced it.
  check (direction = 'inbound' or agent = 'human' or prompt_version is not null),
  check (direction = 'inbound' or agent is not null),
  unique (channel_id, provider_id)
);
create table public.fo_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  kind text not null check (kind in ('created','inbound','state','dispatch','opt-out','opt-in','handoff')),
  from_state text, to_state text, agent text,
  detail text check (detail is null or length(detail) <= 500),
  created_at timestamptz not null default now()
);
create table public.fo_handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  from_agent text not null check (from_agent in ('setter','sales','receptionist','onboarding','human')),
  owner text not null check (owner in ('setter','sales','receptionist','onboarding','human')),
  channel text not null check (channel in ('sms','web-chat','email','voice','form')),
  intent text not null check (length(intent) between 1 and 200),
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  summary text not null check (length(summary) between 1 and 4000),
  next_action text not null check (length(next_action) between 1 and 500),
  created_at timestamptz not null default now(),
  check (from_agent <> owner)
);
create index fo_messages_contact on public.fo_messages(contact_id, created_at);
create index fo_events_contact on public.fo_events(contact_id, id);
create index fo_contacts_state on public.fo_contacts(workspace_id, state);

alter table public.fo_channels enable row level security;
alter table public.fo_contacts enable row level security;
alter table public.fo_messages enable row level security;
alter table public.fo_events enable row level security;
alter table public.fo_handoffs enable row level security;
revoke all on public.fo_channels, public.fo_contacts, public.fo_messages, public.fo_events, public.fo_handoffs from anon, authenticated;
grant select on public.fo_contacts, public.fo_messages, public.fo_events, public.fo_handoffs to authenticated;
-- Channel rows hold key hashes: owners read them through fo_list_channels only.
create policy fo_contacts_read on public.fo_contacts for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy fo_messages_read on public.fo_messages for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy fo_events_read on public.fo_events for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy fo_handoffs_read on public.fo_handoffs for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- Same list as apps/web/lib/front-office/state.ts (test/front-office-db.test.ts compares them).
create function public.fo_transition_ok(from_state text, to_state text) returns boolean language sql immutable set search_path='' as $$
select (from_state, to_state) in (
  ('new','contacted'),('new','qualifying'),('new','disqualified'),('new','nurture'),('new','customer'),
  ('contacted','qualifying'),('contacted','disqualified'),('contacted','nurture'),('contacted','customer'),
  ('qualifying','qualified'),('qualifying','disqualified'),('qualifying','nurture'),
  ('qualified','booked'),('qualified','nurture'),('qualified','disqualified'),
  ('booked','customer'),('booked','no-show'),('booked','qualified'),('booked','nurture'),('booked','disqualified'),
  ('no-show','booked'),('no-show','nurture'),('no-show','disqualified'),
  ('disqualified','nurture'),('disqualified','qualifying'),
  ('nurture','contacted'),('nurture','qualifying'),('nurture','qualified'),('nurture','booked'),('nurture','disqualified')) $$;

-- Channel key check. Not callable directly.
create function public.fo_channel_workspace(channel uuid, channel_key text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare w uuid;
begin
  select c.workspace_id into w from public.fo_channels c
   where c.id = channel and c.active and c.key_hash = encode(sha256(convert_to(coalesce(channel_key,''), 'UTF8')), 'hex');
  if w is null then raise exception 'Channel not recognised.'; end if;
  return w;
end $$;
revoke all on function public.fo_channel_workspace(uuid,text) from public, anon, authenticated;

-- Owner: connect a channel. The caller generates the key (32+ characters) and keeps it; only its hash is stored.
create function public.fo_create_channel(w uuid, channel_kind text, channel_address text, channel_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if length(coalesce(channel_key,'')) < 32 then raise exception 'Channel key must be at least 32 characters.'; end if;
  insert into public.fo_channels(workspace_id, kind, address, key_hash)
  values (w, channel_kind, channel_address, encode(sha256(convert_to(channel_key, 'UTF8')), 'hex')) returning fo_channels.id into id;
  return id;
end $$;
create function public.fo_list_channels(w uuid) returns table(id uuid, kind text, address text, active boolean, created_at timestamptz) language sql stable security definer set search_path='' as $$
select c.id, c.kind, c.address, c.active, c.created_at from public.fo_channels c where c.workspace_id = w and public.workspace_role(w) = 'owner' $$;
revoke all on function public.fo_create_channel(uuid,text,text,text), public.fo_list_channels(uuid) from public, anon;
grant execute on function public.fo_create_channel(uuid,text,text,text), public.fo_list_channels(uuid) to authenticated;

-- Webhook: record one inbound SMS. Idempotent by provider message id. Creates the contact (state new) when unknown.
create function public.fo_ingest_sms(channel uuid, channel_key text, from_number text, to_number text, message text, msg_id text, opt_out boolean, opt_in boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; ch public.fo_channels; c public.fo_contacts; created boolean := false; dup boolean := false;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into ch from public.fo_channels where id = channel;
  if ch.kind <> 'sms' or ch.address <> to_number then raise exception 'Channel not recognised.'; end if;
  if msg_id is null or length(msg_id) not between 10 and 64 then raise exception 'Message id required.'; end if;
  select * into c from public.fo_contacts where workspace_id = w and phone = from_number for update;
  if not found then
    insert into public.fo_contacts(workspace_id, phone) values (w, from_number) on conflict (workspace_id, phone) do nothing;
    select * into c from public.fo_contacts where workspace_id = w and phone = from_number for update;
    created := true;
    insert into public.fo_events(workspace_id, contact_id, kind, to_state, detail) values (w, c.id, 'created', c.state, 'First SMS');
  end if;
  insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, provider_id)
  values (w, c.id, channel, 'inbound', left(coalesce(message,''), 4000), msg_id) on conflict (channel_id, provider_id) do nothing;
  if not found then dup := true;
  else
    insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'inbound', 'sms');
    if opt_out and c.opted_out_at is null then
      update public.fo_contacts set opted_out_at = now(), updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-out', 'sms');
    elsif opt_in and c.opted_out_at is not null then
      update public.fo_contacts set opted_out_at = null, updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-in', 'sms');
    end if;
  end if;
  return jsonb_build_object('workspace', w, 'contact', c.id, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'created', created, 'duplicate', dup);
end $$;

-- Orchestrator: record which agent a contact was dispatched to.
create function public.fo_log_dispatch(channel uuid, channel_key text, contact uuid, agent_name text, reason text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if not exists (select 1 from public.fo_contacts where id = contact and workspace_id = w) then raise exception 'Contact not found.'; end if;
  if agent_name is not null and agent_name not in ('setter','sales','receptionist','onboarding','human') then raise exception 'Unknown agent.'; end if;
  insert into public.fo_events(workspace_id, contact_id, kind, agent, detail) values (w, contact, 'dispatch', agent_name, left(reason, 500));
end $$;

-- Agents: log an outbound message BEFORE sending it (tracker 0.6). Refused for opted-out contacts, except the single
-- opt-out confirmation.
create function public.fo_log_outbound(channel uuid, channel_key text, contact uuid, message text, agent_name text, prompt text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; c public.fo_contacts; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into c from public.fo_contacts where fo_contacts.id = contact and workspace_id = w;
  if not found then raise exception 'Contact not found.'; end if;
  if c.opted_out_at is not null and prompt is distinct from 'system/opt-out-confirmation@1' then raise exception 'Contact opted out.'; end if;
  insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, agent, prompt_version)
  values (w, contact, channel, 'outbound', message, agent_name, prompt) returning fo_messages.id into id;
  return id;
end $$;

-- Agents: move a contact along the state machine.
create function public.fo_set_state(channel uuid, channel_key text, contact uuid, new_state text, agent_name text, reason text) returns text language plpgsql security definer set search_path='' as $$
declare w uuid; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into c from public.fo_contacts where id = contact and workspace_id = w for update;
  if not found then raise exception 'Contact not found.'; end if;
  if not public.fo_transition_ok(c.state, new_state) then raise exception 'Contact cannot move from % to %.', c.state, new_state; end if;
  update public.fo_contacts set state = new_state, updated_at = now() where id = contact;
  insert into public.fo_events(workspace_id, contact_id, kind, from_state, to_state, agent, detail) values (w, contact, 'state', c.state, new_state, agent_name, left(reason, 500));
  return new_state;
end $$;

-- Agents: record a handoff (tracker 0.4). The app validates the object (lib/front-office/handoff.ts) first.
create function public.fo_record_handoff(channel uuid, channel_key text, contact uuid, handoff jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if not exists (select 1 from public.fo_contacts where fo_contacts.id = contact and workspace_id = w) then raise exception 'Contact not found.'; end if;
  insert into public.fo_handoffs(workspace_id, contact_id, from_agent, owner, channel, intent, answers, summary, next_action)
  values (w, contact, handoff->>'from', handoff->>'owner', handoff->>'channel', handoff->>'intent', coalesce(handoff->'answers','{}'), handoff->>'summary', handoff->>'nextAction')
  returning fo_handoffs.id into id;
  insert into public.fo_events(workspace_id, contact_id, kind, agent, detail) values (w, contact, 'handoff', handoff->>'owner', left(handoff->>'intent', 500));
  return id;
end $$;

revoke all on function public.fo_ingest_sms(uuid,text,text,text,text,text,boolean,boolean), public.fo_log_dispatch(uuid,text,uuid,text,text),
  public.fo_log_outbound(uuid,text,uuid,text,text,text), public.fo_set_state(uuid,text,uuid,text,text,text), public.fo_record_handoff(uuid,text,uuid,jsonb) from public;
grant execute on function public.fo_ingest_sms(uuid,text,text,text,text,text,boolean,boolean), public.fo_log_dispatch(uuid,text,uuid,text,text),
  public.fo_log_outbound(uuid,text,uuid,text,text,text), public.fo_set_state(uuid,text,uuid,text,text,text), public.fo_record_handoff(uuid,text,uuid,jsonb) to anon, authenticated;
revoke all on function public.fo_transition_ok(text,text) from public, anon;
grant execute on function public.fo_transition_ok(text,text) to authenticated;
