-- AI front office, tracker 1.2 and 1.3: appointments booked by the Setter on the one calendar provider (Google Calendar).
-- The calendar event is created first with a deterministic id; fo_book then records it and moves the contact to booked in
-- one transaction. A retried booking returns the existing appointment instead of creating a second one.

create table public.fo_appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  provider text not null check (provider in ('google')),
  provider_event_id text not null check (provider_event_id ~ '^[0-9a-v]+$' and length(provider_event_id) between 5 and 1024),
  status text not null default 'booked' check (status in ('booked','attended','no-show','cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  unique (provider, provider_event_id)
);
create index fo_appointments_contact on public.fo_appointments(contact_id, starts_at);
create index fo_appointments_upcoming on public.fo_appointments(workspace_id, starts_at) where status = 'booked';
alter table public.fo_appointments enable row level security;
revoke all on public.fo_appointments from anon, authenticated;
grant select on public.fo_appointments to authenticated;
create policy fo_appointments_read on public.fo_appointments for select to authenticated using (public.workspace_role(workspace_id) is not null);

create function public.fo_book(channel uuid, channel_key text, contact uuid, starts timestamptz, ends timestamptz, calendar_provider text, event_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; c public.fo_contacts; a public.fo_appointments;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into a from public.fo_appointments where provider = calendar_provider and provider_event_id = event_id;
  if found then
    if a.workspace_id <> w or a.contact_id <> contact then raise exception 'Booking id belongs to another contact.'; end if;
    return jsonb_build_object('appointment', a.id, 'state', (select state from public.fo_contacts where id = contact), 'duplicate', true);
  end if;
  select * into c from public.fo_contacts where id = contact and workspace_id = w for update;
  if not found then raise exception 'Contact not found.'; end if;
  if c.opted_out_at is not null then raise exception 'Contact opted out.'; end if;
  if not public.fo_transition_ok(c.state, 'booked') then raise exception 'Contact cannot move from % to booked.', c.state; end if;
  insert into public.fo_appointments(workspace_id, contact_id, starts_at, ends_at, provider, provider_event_id)
  values (w, contact, starts, ends, calendar_provider, event_id) returning * into a;
  update public.fo_contacts set state = 'booked', updated_at = now() where id = contact;
  insert into public.fo_events(workspace_id, contact_id, kind, from_state, to_state, agent, detail)
  values (w, contact, 'state', c.state, 'booked', 'setter', 'Booked ' || to_char(starts at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
  return jsonb_build_object('appointment', a.id, 'state', 'booked', 'duplicate', false);
end $$;
revoke all on function public.fo_book(uuid,text,uuid,timestamptz,timestamptz,text,text) from public;
grant execute on function public.fo_book(uuid,text,uuid,timestamptz,timestamptz,text,text) to anon, authenticated;

-- Setter: has this calendar event already been recorded? (Idempotent retries.)
create function public.fo_booking_for_event(channel uuid, channel_key text, calendar_provider text, event_id text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare w uuid; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select a.id into id from public.fo_appointments a where a.workspace_id = w and a.provider = calendar_provider and a.provider_event_id = event_id;
  return id;
end $$;
revoke all on function public.fo_booking_for_event(uuid,text,text,text) from public;
grant execute on function public.fo_booking_for_event(uuid,text,text,text) to anon, authenticated;
