-- AI front office, tracker 1.1, 1.4, 1.5: qualification answers on the contact, the context an agent reads before replying,
-- and scheduled jobs (follow-up ladder, pre-call reminders, no-show rescue). Jobs stop the moment the contact replies.

alter table public.fo_contacts add column answers jsonb not null default '{}'
  check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 8000);

create table public.fo_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  channel_id uuid not null references public.fo_channels(id) on delete cascade,
  kind text not null check (kind in ('follow-up','reminder-24h','reminder-2h','no-show-rescue')),
  step integer not null default 1 check (step between 1 and 50),
  appointment_id uuid references public.fo_appointments(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','running','done','cancelled','failed')),
  detail text check (detail is null or length(detail) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (kind not like 'reminder%' or appointment_id is not null)
);
create index fo_jobs_due on public.fo_jobs(channel_id, due_at) where status = 'pending';
create index fo_jobs_contact on public.fo_jobs(contact_id) where status = 'pending';
create unique index fo_jobs_one_reminder on public.fo_jobs(appointment_id, kind) where kind like 'reminder%' and status <> 'cancelled';
alter table public.fo_jobs enable row level security;
revoke all on public.fo_jobs from anon, authenticated;
grant select on public.fo_jobs to authenticated;
create policy fo_jobs_read on public.fo_jobs for select to authenticated using (public.workspace_role(workspace_id) is not null);

-- Same as 202611060001, plus: a reply cancels pending follow-ups and no-show rescues; an opt-out cancels every job.
create or replace function public.fo_ingest_sms(channel uuid, channel_key text, from_number text, to_number text, message text, msg_id text, opt_out boolean, opt_in boolean)
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
    update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Contact replied'
     where contact_id = c.id and status = 'pending' and kind in ('follow-up','no-show-rescue');
    if opt_out and c.opted_out_at is null then
      update public.fo_contacts set opted_out_at = now(), updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-out', 'sms');
      update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Opted out' where contact_id = c.id and status = 'pending';
    elsif opt_in and c.opted_out_at is not null then
      update public.fo_contacts set opted_out_at = null, updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-in', 'sms');
    end if;
  end if;
  return jsonb_build_object('workspace', w, 'contact', c.id, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'created', created, 'duplicate', dup);
end $$;

-- Agents: everything about a contact before replying (master plan: read the full history first).
create function public.fo_contact_context(channel uuid, channel_key text, contact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into c from public.fo_contacts where id = contact and workspace_id = w;
  if not found then raise exception 'Contact not found.'; end if;
  return jsonb_build_object(
    'contact', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'answers', c.answers),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'body', m.body, 'agent', m.agent, 'at', m.created_at) order by m.created_at)
       from (select * from public.fo_messages where contact_id = c.id order by created_at desc limit 40) m), '[]'),
    'appointment', (select jsonb_build_object('id', a.id, 'starts', a.starts_at, 'ends', a.ends_at, 'status', a.status)
       from public.fo_appointments a where a.contact_id = c.id and a.status = 'booked' and a.ends_at > now() order by a.starts_at limit 1),
    'handoffs', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_agent, 'owner', h.owner, 'intent', h.intent, 'summary', h.summary) order by h.created_at)
       from public.fo_handoffs h where h.contact_id = c.id), '[]'));
end $$;

-- Setter: merge qualification answers (keys are the client's question ids) and, optionally, the contact's name/email.
create function public.fo_save_answers(channel uuid, channel_key text, contact uuid, new_answers jsonb, contact_name text, contact_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; merged jsonb;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if jsonb_typeof(new_answers) <> 'object' then raise exception 'Answers must be an object.'; end if;
  update public.fo_contacts set
    answers = answers || new_answers,
    name = coalesce(nullif(left(trim(contact_name), 160), ''), name),
    email = coalesce(nullif(lower(trim(contact_email)), ''), email),
    updated_at = now()
  where id = contact and workspace_id = w returning answers into merged;
  if merged is null then raise exception 'Contact not found.'; end if;
  return merged;
end $$;

-- Jobs.
create function public.fo_schedule_job(channel uuid, channel_key text, contact uuid, job_kind text, job_step integer, due timestamptz, appointment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if not exists (select 1 from public.fo_contacts where fo_contacts.id = contact and workspace_id = w and opted_out_at is null) then raise exception 'Contact not found or opted out.'; end if;
  if appointment is not null and not exists (select 1 from public.fo_appointments a where a.id = appointment and a.contact_id = contact) then raise exception 'Appointment not found.'; end if;
  -- One pending ladder or rescue per contact: a new one replaces the old.
  if job_kind in ('follow-up','no-show-rescue') then
    update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Replaced' where contact_id = contact and kind = job_kind and status = 'pending';
  end if;
  insert into public.fo_jobs(workspace_id, contact_id, channel_id, kind, step, appointment_id, due_at)
  values (w, contact, channel, job_kind, job_step, appointment, due) on conflict do nothing returning fo_jobs.id into id;
  return id;
end $$;
-- Runner: claim due jobs for this channel. Claimed jobs are 'running' so two runners never send the same one.
create function public.fo_claim_jobs(channel uuid, channel_key text, max_jobs integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; claimed jsonb;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  with due as (
    select j.id from public.fo_jobs j where j.channel_id = channel and j.status = 'pending' and j.due_at <= now()
    order by j.due_at limit least(greatest(max_jobs, 1), 100) for update skip locked
  ), upd as (
    update public.fo_jobs j set status = 'running' from due where j.id = due.id returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'contact', u.contact_id, 'kind', u.kind, 'step', u.step, 'appointment', u.appointment_id, 'due', u.due_at)), '[]') into claimed from upd u;
  return claimed;
end $$;
create function public.fo_finish_job(channel uuid, channel_key text, job uuid, outcome text, note text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if outcome not in ('done','cancelled','failed') then raise exception 'Unknown outcome.'; end if;
  update public.fo_jobs set status = outcome, finished_at = now(), detail = left(note, 500) where id = job and channel_id = channel and status = 'running';
  if not found then raise exception 'Job not running.'; end if;
end $$;

revoke all on function public.fo_contact_context(uuid,text,uuid), public.fo_save_answers(uuid,text,uuid,jsonb,text,text),
  public.fo_schedule_job(uuid,text,uuid,text,integer,timestamptz,uuid), public.fo_claim_jobs(uuid,text,integer), public.fo_finish_job(uuid,text,uuid,text,text) from public;
grant execute on function public.fo_contact_context(uuid,text,uuid), public.fo_save_answers(uuid,text,uuid,jsonb,text,text),
  public.fo_schedule_job(uuid,text,uuid,text,integer,timestamptz,uuid), public.fo_claim_jobs(uuid,text,integer), public.fo_finish_job(uuid,text,uuid,text,text) to anon, authenticated;
