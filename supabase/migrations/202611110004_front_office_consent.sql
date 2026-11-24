-- Per-channel consent records, task A-38 (follows 202611060003_front_office_setter.sql, which first defined
-- fo_contact_context). LOCAL / PGlite ONLY until the owner approves applying it anywhere else. Never `supabase db push` this.
--
-- A contact may have given explicit consent to be contacted by SMS or by email. Each grant is one row: when and where it
-- was given, and (later) when and where it was withdrawn. Rows are never deleted or rewritten except to close them, so the
-- table is the history. At most one open (not withdrawn) row per contact and channel.
--
-- fo_contact_context gains contact.consent = {sms, email}: true only while the contact has an open grant for that channel,
-- false without any record. Every other field and the argument signature are unchanged. Consent does not override
-- contact.optedOut: callers keep refusing opted-out contacts.
--
-- Re-apply safe: create table/index if not exists, drop policy/trigger if exists before create, create or replace for
-- functions; revoke and grant are idempotent.

create table if not exists public.fo_contact_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  granted_at timestamptz not null,
  granted_source text not null check (length(granted_source) between 1 and 200),
  withdrawn_at timestamptz,
  withdrawn_source text check (withdrawn_source is null or length(withdrawn_source) between 1 and 200),
  created_at timestamptz not null default now(),
  check ((withdrawn_at is null) = (withdrawn_source is null)),
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create unique index if not exists fo_contact_consents_open on public.fo_contact_consents(contact_id, channel) where withdrawn_at is null;
create index if not exists fo_contact_consents_contact on public.fo_contact_consents(contact_id, channel, granted_at desc);
create index if not exists fo_contact_consents_workspace on public.fo_contact_consents(workspace_id);
alter table public.fo_contact_consents enable row level security;
revoke all on public.fo_contact_consents from anon, authenticated;
grant select on public.fo_contact_consents to authenticated;
drop policy if exists fo_contact_consents_read on public.fo_contact_consents;
create policy fo_contact_consents_read on public.fo_contact_consents for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- A consent row always belongs to its contact's workspace (defence in depth; the RPCs below are the only writers).
create or replace function public.fo_contact_consents_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.fo_contacts c where c.id = new.contact_id and c.workspace_id = new.workspace_id) then
    raise exception 'Contact not found.';
  end if;
  if tg_op = 'UPDATE' and (new.workspace_id, new.contact_id, new.channel, new.granted_at, new.granted_source)
     is distinct from (old.workspace_id, old.contact_id, old.channel, old.granted_at, old.granted_source) then
    raise exception 'A consent record is only ever closed, never rewritten.';
  end if;
  return new;
end $$;
revoke all on function public.fo_contact_consents_guard() from public, anon, authenticated;
drop trigger if exists fo_contact_consents_guard on public.fo_contact_consents;
create trigger fo_contact_consents_guard before insert or update on public.fo_contact_consents for each row execute function public.fo_contact_consents_guard();

-- Shared checks for the grant/withdraw RPCs. Returns the trimmed source.
create or replace function public.fo_consent_input(consent_channel text, source text) returns text language plpgsql immutable set search_path='' as $$
declare s text := nullif(trim(coalesce(source, '')), '');
begin
  if consent_channel is null or consent_channel not in ('sms','email') then raise exception 'Consent channel must be sms or email.'; end if;
  if s is null then raise exception 'Consent source required.'; end if;
  if length(s) > 200 then raise exception 'Consent source too long.'; end if;
  return s;
end $$;
revoke all on function public.fo_consent_input(text,text) from public, anon, authenticated;

-- Agents/webhooks (channel key): record that the contact gave consent for one channel. given_at null = now; it may not be
-- in the future, nor before the latest withdrawal for that channel. Already consented: the open record is returned as is.
create or replace function public.fo_grant_consent(channel uuid, channel_key text, contact uuid, consent_channel text, source text, given_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; s text; t timestamptz := coalesce(given_at, now()); r public.fo_contact_consents; last_withdrawn timestamptz;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  s := public.fo_consent_input(consent_channel, source);
  perform 1 from public.fo_contacts c where c.id = contact and c.workspace_id = w for update;
  if not found then raise exception 'Contact not found.'; end if;
  if t > now() + interval '5 minutes' then raise exception 'Consent time cannot be in the future.'; end if;
  select * into r from public.fo_contact_consents k where k.contact_id = contact and k.channel = consent_channel and k.withdrawn_at is null;
  if found then
    return jsonb_build_object('id', r.id, 'channel', r.channel, 'granted', true, 'grantedAt', r.granted_at, 'grantedSource', r.granted_source, 'created', false);
  end if;
  select max(k.withdrawn_at) into last_withdrawn from public.fo_contact_consents k where k.contact_id = contact and k.channel = consent_channel;
  if last_withdrawn is not null and t < last_withdrawn then raise exception 'Consent time is before the latest withdrawal.'; end if;
  insert into public.fo_contact_consents(workspace_id, contact_id, channel, granted_at, granted_source)
  values (w, contact, consent_channel, t, s) returning * into r;
  return jsonb_build_object('id', r.id, 'channel', r.channel, 'granted', true, 'grantedAt', r.granted_at, 'grantedSource', r.granted_source, 'created', true);
end $$;

-- Agents/webhooks (channel key): record that the contact withdrew consent for one channel. withdrawn null = now.
-- No open consent: nothing to close, 'changed' is false (still not consented).
create or replace function public.fo_withdraw_consent(channel uuid, channel_key text, contact uuid, consent_channel text, source text, withdrawn timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; s text; t timestamptz := coalesce(withdrawn, now()); r public.fo_contact_consents;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  s := public.fo_consent_input(consent_channel, source);
  perform 1 from public.fo_contacts c where c.id = contact and c.workspace_id = w for update;
  if not found then raise exception 'Contact not found.'; end if;
  if t > now() + interval '5 minutes' then raise exception 'Withdrawal time cannot be in the future.'; end if;
  select * into r from public.fo_contact_consents k where k.contact_id = contact and k.channel = consent_channel and k.withdrawn_at is null for update;
  if not found then return jsonb_build_object('channel', consent_channel, 'granted', false, 'changed', false); end if;
  if t < r.granted_at then raise exception 'Withdrawal time is before the consent was given.'; end if;
  update public.fo_contact_consents set withdrawn_at = t, withdrawn_source = s where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'channel', r.channel, 'granted', false, 'changed', true, 'withdrawnAt', r.withdrawn_at, 'withdrawnSource', r.withdrawn_source);
end $$;

-- Same body as 202611060003_front_office_setter.sql, plus contact.consent {sms, email}.
create or replace function public.fo_contact_context(channel uuid, channel_key text, contact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into c from public.fo_contacts where id = contact and workspace_id = w;
  if not found then raise exception 'Contact not found.'; end if;
  return jsonb_build_object(
    'contact', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'answers', c.answers,
      'consent', jsonb_build_object(
        'sms', exists (select 1 from public.fo_contact_consents k where k.contact_id = c.id and k.workspace_id = w and k.channel = 'sms' and k.withdrawn_at is null),
        'email', exists (select 1 from public.fo_contact_consents k where k.contact_id = c.id and k.workspace_id = w and k.channel = 'email' and k.withdrawn_at is null))),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'body', m.body, 'agent', m.agent, 'at', m.created_at) order by m.created_at)
       from (select * from public.fo_messages where contact_id = c.id order by created_at desc limit 40) m), '[]'),
    'appointment', (select jsonb_build_object('id', a.id, 'starts', a.starts_at, 'ends', a.ends_at, 'status', a.status)
       from public.fo_appointments a where a.contact_id = c.id and a.status = 'booked' and a.ends_at > now() order by a.starts_at limit 1),
    'handoffs', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_agent, 'owner', h.owner, 'intent', h.intent, 'summary', h.summary) order by h.created_at)
       from public.fo_handoffs h where h.contact_id = c.id), '[]'));
end $$;

revoke all on function public.fo_contact_context(uuid,text,uuid),
  public.fo_grant_consent(uuid,text,uuid,text,text,timestamptz), public.fo_withdraw_consent(uuid,text,uuid,text,text,timestamptz) from public;
grant execute on function public.fo_contact_context(uuid,text,uuid),
  public.fo_grant_consent(uuid,text,uuid,text,text,timestamptz), public.fo_withdraw_consent(uuid,text,uuid,text,text,timestamptz) to anon, authenticated;
