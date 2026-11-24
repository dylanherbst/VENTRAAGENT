-- AI front office for client businesses (gyms first) and the AI Receptionist on the phone (Vapi).
-- 1. Per-workspace agent settings: what the Setter and Receptionist say and do for this business. Owners read and save
--    them; channel webhooks read them with their channel key.
-- 2. Voice calls: one fo_calls row per Vapi call, the caller as a contact (by phone), every spoken turn in fo_messages.
-- 3. Reschedule and cancel for appointments.

-- Settings. The app validates the shape (apps/web/lib/front-office/settings.ts); the database checks the essentials.
create table public.fo_agent_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 32000
    and data->>'template' in ('gym','ventra','custom') and length(trim(coalesce(data->>'businessName',''))) between 1 and 160),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.fo_agent_settings enable row level security;
revoke all on public.fo_agent_settings from anon, authenticated;
grant select on public.fo_agent_settings to authenticated;
create policy fo_agent_settings_read on public.fo_agent_settings for select to authenticated using (public.workspace_role(workspace_id) = 'owner');

create function public.fo_get_agent_settings(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.fo_agent_settings;
begin
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  select * into s from public.fo_agent_settings where workspace_id = w;
  if not found then return null; end if;
  return jsonb_build_object('data', s.data, 'revision', s.revision, 'updatedAt', s.updated_at);
end $$;
-- expected_revision 0 creates; otherwise it must match the stored revision (someone else saved first = conflict).
create function public.fo_save_agent_settings(w uuid, payload jsonb, expected_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare r integer;
begin
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if expected_revision = 0 then
    insert into public.fo_agent_settings(workspace_id, data, updated_by) values (w, payload, auth.uid()) on conflict (workspace_id) do nothing returning revision into r;
  else
    update public.fo_agent_settings set data = payload, revision = revision + 1, updated_at = now(), updated_by = auth.uid()
     where workspace_id = w and revision = expected_revision returning revision into r;
  end if;
  if r is null then raise exception 'Settings were changed elsewhere. Reload and try again.'; end if;
  return r;
end $$;
-- Webhooks (no user session): the settings of the workspace that owns this channel, or null.
create function public.fo_channel_settings(channel uuid, channel_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  return (select data from public.fo_agent_settings where workspace_id = w);
end $$;
revoke all on function public.fo_get_agent_settings(uuid), public.fo_save_agent_settings(uuid,jsonb,integer) from public, anon;
grant execute on function public.fo_get_agent_settings(uuid), public.fo_save_agent_settings(uuid,jsonb,integer) to authenticated;
revoke all on function public.fo_channel_settings(uuid,text) from public;
grant execute on function public.fo_channel_settings(uuid,text) to anon, authenticated;

-- New event kinds for calls, booking changes and messages taken.
alter table public.fo_events drop constraint fo_events_kind_check;
alter table public.fo_events add constraint fo_events_kind_check check (kind in ('created','inbound','state','dispatch','opt-out','opt-in','handoff','call','booking','message'));

-- Calls. provider_call_id is Vapi's call id. contact_id is null while the caller's number is withheld.
create table public.fo_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null references public.fo_channels(id) on delete cascade,
  contact_id uuid references public.fo_contacts(id) on delete set null,
  provider_call_id text not null check (provider_call_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  caller text check (caller is null or caller ~ '^\+[1-9][0-9]{6,14}$'),
  outcomes text[] not null default '{}',
  ended_reason text check (ended_reason is null or length(ended_reason) <= 120),
  summary text check (summary is null or length(summary) <= 4000),
  transcript text check (transcript is null or length(transcript) <= 20000),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (channel_id, provider_call_id)
);
create index fo_calls_workspace on public.fo_calls(workspace_id, started_at desc);
alter table public.fo_calls enable row level security;
revoke all on public.fo_calls from anon, authenticated;
grant select on public.fo_calls to authenticated;
create policy fo_calls_read on public.fo_calls for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- Not callable directly: the call row for this channel and call id, created on first sight, locked.
create function public.fo_voice_call_row(w uuid, ch uuid, call_id text, caller_number text) returns public.fo_calls language plpgsql security definer set search_path='' as $$
declare k public.fo_calls; c public.fo_contacts; who text;
begin
  if call_id is null or call_id !~ '^[A-Za-z0-9_-]{8,100}$' then raise exception 'Call id required.'; end if;
  who := case when caller_number ~ '^\+[1-9][0-9]{6,14}$' then caller_number end;
  insert into public.fo_calls(workspace_id, channel_id, provider_call_id, caller) values (w, ch, call_id, who) on conflict (channel_id, provider_call_id) do nothing;
  select * into k from public.fo_calls where channel_id = ch and provider_call_id = call_id for update;
  if k.contact_id is null and coalesce(k.caller, who) is not null then
    who := coalesce(k.caller, who);
    select * into c from public.fo_contacts where workspace_id = w and phone = who for update;
    if not found then
      insert into public.fo_contacts(workspace_id, phone) values (w, who) on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and phone = who for update;
      insert into public.fo_events(workspace_id, contact_id, kind, to_state, detail) values (w, c.id, 'created', c.state, 'First call');
    end if;
    update public.fo_calls set contact_id = c.id, caller = who where id = k.id returning * into k;
  end if;
  return k;
end $$;
revoke all on function public.fo_voice_call_row(uuid,uuid,text,text) from public, anon, authenticated;

-- One caller turn: record the call, the caller as a contact and what they just said (idempotent per call and turn).
create function public.fo_voice_turn(channel uuid, channel_key text, call_id text, caller text, turn integer, message text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; ch public.fo_channels; k public.fo_calls; c public.fo_contacts; dup boolean := false;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into ch from public.fo_channels where id = channel;
  if ch.kind <> 'voice' then raise exception 'Channel not recognised.'; end if;
  k := public.fo_voice_call_row(w, channel, call_id, caller);
  if k.contact_id is not null then
    select * into c from public.fo_contacts where id = k.contact_id;
    if turn is not null and turn between 1 and 500 and length(trim(coalesce(message,''))) > 0 then
      insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, provider_id)
      values (w, c.id, channel, 'inbound', left(message, 4000), 'vapi:' || call_id || ':' || turn) on conflict (channel_id, provider_id) do nothing;
      if not found then dup := true;
      else
        insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'inbound', 'voice');
        update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Contact called'
         where contact_id = c.id and status = 'pending' and kind in ('follow-up','no-show-rescue');
      end if;
    end if;
  end if;
  return jsonb_build_object('workspace', w, 'call', k.id, 'contact', k.contact_id, 'state', c.state, 'optedOut', c.opted_out_at is not null,
    'caller', k.caller, 'outcomes', to_jsonb(k.outcomes), 'duplicate', dup);
end $$;

-- The caller gave a number (theirs was withheld, or they want texts on another mobile): link the call to that contact.
create function public.fo_voice_contact(channel uuid, channel_key text, call_id text, phone_number text, contact_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; k public.fo_calls; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if phone_number !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Mobile number is not valid.'; end if;
  k := public.fo_voice_call_row(w, channel, call_id, null);
  select * into c from public.fo_contacts where workspace_id = w and phone = phone_number for update;
  if not found then
    insert into public.fo_contacts(workspace_id, phone) values (w, phone_number) on conflict do nothing;
    select * into c from public.fo_contacts where workspace_id = w and phone = phone_number for update;
    insert into public.fo_events(workspace_id, contact_id, kind, to_state, detail) values (w, c.id, 'created', c.state, 'Number given on a call');
  end if;
  if nullif(left(trim(contact_name), 160), '') is not null and c.name is null then update public.fo_contacts set name = left(trim(contact_name), 160), updated_at = now() where id = c.id; end if;
  update public.fo_calls set contact_id = c.id where id = k.id;
  return c.id;
end $$;

-- What the Receptionist said (logged with its prompt version). Answering a call is not marketing, so an earlier SMS
-- opt-out does not block it. No contact yet (number withheld): nothing to log against.
create function public.fo_voice_reply(channel uuid, channel_key text, call_id text, message text, prompt text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; k public.fo_calls; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if prompt is null or length(prompt) not between 1 and 120 then raise exception 'Prompt version required.'; end if;
  select * into k from public.fo_calls where channel_id = channel and provider_call_id = call_id and workspace_id = w;
  if not found or k.contact_id is null or length(trim(coalesce(message,''))) = 0 then return null; end if;
  insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, agent, prompt_version)
  values (w, k.contact_id, channel, 'outbound', left(message, 4000), 'receptionist', prompt) returning fo_messages.id into id;
  return id;
end $$;

create function public.fo_voice_outcome(channel uuid, channel_key text, call_id text, outcome text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if outcome not in ('faq','faq-miss','qualified','booked','rescheduled','cancelled','message','transfer','not-live') then raise exception 'Unknown outcome.'; end if;
  perform public.fo_voice_call_row(w, channel, call_id, null);
  update public.fo_calls set outcomes = case when outcome = any(outcomes) then outcomes else outcomes || outcome end
   where channel_id = channel and provider_call_id = call_id;
end $$;

-- Vapi's end-of-call report: when and why it ended, the summary and the transcript. A missed or withheld-number call
-- still gets a row; a caller with a number becomes a contact so nobody who rang is lost.
create function public.fo_voice_end(channel uuid, channel_key text, call_id text, caller text, reason text, call_summary text, call_transcript text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; k public.fo_calls;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  k := public.fo_voice_call_row(w, channel, call_id, caller);
  update public.fo_calls set ended_at = coalesce(ended_at, now()), ended_reason = left(reason, 120),
    summary = nullif(left(call_summary, 4000), ''), transcript = nullif(left(call_transcript, 20000), '')
   where id = k.id returning * into k;
  if k.contact_id is not null then
    insert into public.fo_events(workspace_id, contact_id, kind, agent, detail)
    values (w, k.contact_id, 'call', 'receptionist', left('Call ended (' || coalesce(nullif(reason,''), 'unknown') || ')' || coalesce(': ' || nullif(array_to_string(k.outcomes, ', '), ''), ''), 500));
  end if;
  return jsonb_build_object('call', k.id, 'contact', k.contact_id, 'outcomes', to_jsonb(k.outcomes));
end $$;

-- Move a booked appointment (the calendar event keeps its id; the app moves it first). Pending reminders for it are
-- cancelled; the app schedules new ones.
create function public.fo_reschedule(channel uuid, channel_key text, contact uuid, appointment uuid, starts timestamptz, ends timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; a public.fo_appointments;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into a from public.fo_appointments where id = appointment and contact_id = contact and workspace_id = w and status = 'booked' for update;
  if not found then raise exception 'No booking to move.'; end if;
  if ends <= starts or ends - starts > interval '8 hours' then raise exception 'Invalid time.'; end if;
  update public.fo_appointments set starts_at = starts, ends_at = ends where id = a.id;
  update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Booking moved' where appointment_id = a.id and status = 'pending';
  insert into public.fo_events(workspace_id, contact_id, kind, agent, detail)
  values (w, contact, 'booking', 'receptionist', 'Moved to ' || to_char(starts at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
  return jsonb_build_object('appointment', a.id, 'eventId', a.provider_event_id, 'provider', a.provider);
end $$;

-- Cancel a booked appointment: reminders stop and the contact goes back to qualified (so it can be rebooked).
create function public.fo_cancel_booking(channel uuid, channel_key text, contact uuid, appointment uuid, reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; a public.fo_appointments; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into a from public.fo_appointments where id = appointment and contact_id = contact and workspace_id = w and status = 'booked' for update;
  if not found then raise exception 'No booking to cancel.'; end if;
  update public.fo_appointments set status = 'cancelled' where id = a.id;
  update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Booking cancelled' where appointment_id = a.id and status = 'pending';
  select * into c from public.fo_contacts where id = contact for update;
  insert into public.fo_events(workspace_id, contact_id, kind, agent, detail) values (w, contact, 'booking', 'receptionist', left('Cancelled: ' || coalesce(nullif(trim(reason), ''), 'no reason given'), 500));
  if c.state = 'booked' then
    update public.fo_contacts set state = 'qualified', updated_at = now() where id = contact;
    insert into public.fo_events(workspace_id, contact_id, kind, from_state, to_state, agent, detail) values (w, contact, 'state', 'booked', 'qualified', 'receptionist', 'Booking cancelled');
  end if;
  return jsonb_build_object('appointment', a.id, 'eventId', a.provider_event_id, 'provider', a.provider);
end $$;

revoke all on function public.fo_voice_turn(uuid,text,text,text,integer,text), public.fo_voice_contact(uuid,text,text,text,text),
  public.fo_voice_reply(uuid,text,text,text,text), public.fo_voice_outcome(uuid,text,text,text), public.fo_voice_end(uuid,text,text,text,text,text,text),
  public.fo_reschedule(uuid,text,uuid,uuid,timestamptz,timestamptz), public.fo_cancel_booking(uuid,text,uuid,uuid,text) from public;
grant execute on function public.fo_voice_turn(uuid,text,text,text,integer,text), public.fo_voice_contact(uuid,text,text,text,text),
  public.fo_voice_reply(uuid,text,text,text,text), public.fo_voice_outcome(uuid,text,text,text), public.fo_voice_end(uuid,text,text,text,text,text,text),
  public.fo_reschedule(uuid,text,uuid,uuid,timestamptz,timestamptz), public.fo_cancel_booking(uuid,text,uuid,uuid,text) to anon, authenticated;
