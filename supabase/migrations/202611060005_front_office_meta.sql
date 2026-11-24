-- AI front office, tracker 2.1: Instagram and Facebook Messenger DMs through Meta's official APIs, with a
-- human-approve queue. Contacts are keyed by Meta's scoped user id (IGSID / PSID). Replies are only allowed inside
-- Meta's 24-hour window after the person's last message; the app checks fo_social_window before sending.

alter table public.fo_channels drop constraint fo_channels_kind_check;
alter table public.fo_channels add constraint fo_channels_kind_check check (kind in ('sms','web-chat','email','voice','instagram','messenger'));
alter table public.fo_handoffs drop constraint fo_handoffs_channel_check;
alter table public.fo_handoffs add constraint fo_handoffs_channel_check check (channel in ('sms','web-chat','email','voice','form','instagram','messenger'));
alter table public.fo_contacts add column instagram_id text check (instagram_id is null or instagram_id ~ '^[0-9]{5,30}$');
alter table public.fo_contacts add column messenger_id text check (messenger_id is null or messenger_id ~ '^[0-9]{5,30}$');
alter table public.fo_contacts add constraint fo_contacts_instagram_unique unique (workspace_id, instagram_id);
alter table public.fo_contacts add constraint fo_contacts_messenger_unique unique (workspace_id, messenger_id);
alter table public.fo_contacts drop constraint fo_contacts_reachable;
alter table public.fo_contacts add constraint fo_contacts_reachable check (phone is not null or email is not null or web_visitor is not null or instagram_id is not null or messenger_id is not null);

-- Same as 202611060004, plus instagram and messenger senders.
create or replace function public.fo_ingest(channel uuid, channel_key text, sender text, message text, msg_id text, opt_out boolean, opt_in boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; ch public.fo_channels; c public.fo_contacts; who text; created boolean := false; dup boolean := false;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into ch from public.fo_channels where id = channel;
  if ch.kind not in ('web-chat','email','instagram','messenger') then raise exception 'Channel not recognised.'; end if;
  if msg_id is null or length(msg_id) not between 8 and 200 then raise exception 'Message id required.'; end if;
  who := case when ch.kind = 'email' then lower(trim(sender)) else trim(sender) end;
  if ch.kind = 'email' and (who !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(who) > 254) then raise exception 'Sender email is not valid.'; end if;
  if ch.kind = 'web-chat' and who !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'Visitor id is not valid.'; end if;
  if ch.kind in ('instagram','messenger') and who !~ '^[0-9]{5,30}$' then raise exception 'Sender id is not valid.'; end if;
  if ch.kind = 'email' then select * into c from public.fo_contacts where workspace_id = w and email = who for update;
  elsif ch.kind = 'web-chat' then select * into c from public.fo_contacts where workspace_id = w and web_visitor = who for update;
  elsif ch.kind = 'instagram' then select * into c from public.fo_contacts where workspace_id = w and instagram_id = who for update;
  else select * into c from public.fo_contacts where workspace_id = w and messenger_id = who for update; end if;
  if not found then
    if ch.kind = 'email' then insert into public.fo_contacts(workspace_id, email) values (w, who) on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and email = who for update;
    elsif ch.kind = 'web-chat' then insert into public.fo_contacts(workspace_id, web_visitor) values (w, who) on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and web_visitor = who for update;
    elsif ch.kind = 'instagram' then insert into public.fo_contacts(workspace_id, instagram_id, source) values (w, who, 'organic') on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and instagram_id = who for update;
    else insert into public.fo_contacts(workspace_id, messenger_id, source) values (w, who, 'organic') on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and messenger_id = who for update; end if;
    created := true;
    insert into public.fo_events(workspace_id, contact_id, kind, to_state, detail) values (w, c.id, 'created', c.state, 'First ' || ch.kind);
  end if;
  insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, provider_id)
  values (w, c.id, channel, 'inbound', left(coalesce(message,''), 4000), msg_id) on conflict (channel_id, provider_id) do nothing;
  if not found then dup := true;
  else
    insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'inbound', ch.kind);
    update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Contact replied'
     where contact_id = c.id and status = 'pending' and kind in ('follow-up','no-show-rescue');
    if opt_out and c.opted_out_at is null then
      update public.fo_contacts set opted_out_at = now(), updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-out', ch.kind);
      update public.fo_jobs set status = 'cancelled', finished_at = now(), detail = 'Opted out' where contact_id = c.id and status = 'pending';
      update public.fo_outbox set status = 'cancelled', decided_at = now() where contact_id = c.id and status = 'queued';
    elsif opt_in and c.opted_out_at is not null then
      update public.fo_contacts set opted_out_at = null, updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-in', ch.kind);
    end if;
  end if;
  return jsonb_build_object('workspace', w, 'contact', c.id, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'created', created, 'duplicate', dup);
end $$;

-- Meta's 24-hour rule: when did this person last message us on this channel, and what is their scoped id?
create function public.fo_social_window(channel uuid, channel_key text, contact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid; ch public.fo_channels; c public.fo_contacts;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into ch from public.fo_channels where id = channel;
  select * into c from public.fo_contacts where id = contact and workspace_id = w;
  if not found then raise exception 'Contact not found.'; end if;
  return jsonb_build_object(
    'recipient', case ch.kind when 'instagram' then c.instagram_id when 'messenger' then c.messenger_id end,
    'optedOut', c.opted_out_at is not null,
    'lastInbound', (select max(m.created_at) from public.fo_messages m where m.contact_id = c.id and m.channel_id = channel and m.direction = 'inbound'));
end $$;

-- Human-approve queue (master plan: social DMs go through approval first). The AI's reply is logged (fo_log_outbound)
-- and queued here; a workspace member approves or rejects it; only an approved reply is sent.
create table public.fo_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.fo_contacts(id) on delete cascade,
  channel_id uuid not null references public.fo_channels(id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  prompt_version text not null check (length(prompt_version) between 1 and 120),
  status text not null default 'queued' check (status in ('queued','approved','sent','rejected','failed','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz, decided_by uuid references auth.users(id), note text check (note is null or length(note) <= 500)
);
create index fo_outbox_queued on public.fo_outbox(workspace_id, created_at) where status = 'queued';
alter table public.fo_outbox enable row level security;
revoke all on public.fo_outbox from anon, authenticated;
grant select on public.fo_outbox to authenticated;
create policy fo_outbox_read on public.fo_outbox for select to authenticated using (public.workspace_role(workspace_id) is not null);

create function public.fo_queue_outbound(channel uuid, channel_key text, contact uuid, message text, prompt text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; id uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if not exists (select 1 from public.fo_contacts where fo_contacts.id = contact and workspace_id = w and opted_out_at is null) then raise exception 'Contact not found or opted out.'; end if;
  insert into public.fo_outbox(workspace_id, contact_id, channel_id, body, prompt_version) values (w, contact, channel, message, prompt) returning fo_outbox.id into id;
  return id;
end $$;
-- A member approves or rejects. Returns what the sender needs; the app then sends and calls fo_outbox_sent.
create function public.fo_decide_outbox(w uuid, item uuid, decision text, edited text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.fo_outbox; c public.fo_contacts; ch public.fo_channels;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  if decision not in ('approved','rejected') then raise exception 'Unknown decision.'; end if;
  select * into o from public.fo_outbox where id = item and workspace_id = w and status = 'queued' for update;
  if not found then raise exception 'Nothing to decide.'; end if;
  select * into c from public.fo_contacts where id = o.contact_id;
  if decision = 'approved' and c.opted_out_at is not null then raise exception 'Contact opted out.'; end if;
  update public.fo_outbox set status = decision, decided_at = now(), decided_by = auth.uid(),
    body = case when decision = 'approved' and nullif(trim(edited), '') is not null then left(trim(edited), 1000) else body end
  where id = item returning * into o;
  select * into ch from public.fo_channels where id = o.channel_id;
  return jsonb_build_object('id', o.id, 'status', o.status, 'body', o.body, 'kind', ch.kind,
    'recipient', case ch.kind when 'instagram' then c.instagram_id when 'messenger' then c.messenger_id end,
    'lastInbound', (select max(m.created_at) from public.fo_messages m where m.contact_id = c.id and m.channel_id = ch.id and m.direction = 'inbound'));
end $$;
create function public.fo_outbox_sent(w uuid, item uuid, ok boolean, info text) returns void language plpgsql security definer set search_path='' as $$
declare o public.fo_outbox;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  update public.fo_outbox set status = case when ok then 'sent' else 'failed' end, note = left(info, 500) where id = item and workspace_id = w and status = 'approved' returning * into o;
  if not found then raise exception 'Not approved.'; end if;
  -- Booking confirmations were already logged by fo_book's caller; everything else is logged now, as sent.
  if ok and o.prompt_version <> 'setter/booking-confirmation@1' then
    insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, agent, prompt_version) values (w, o.contact_id, o.channel_id, 'outbound', o.body, 'setter', o.prompt_version || '+approved');
  end if;
end $$;

revoke all on function public.fo_social_window(uuid,text,uuid), public.fo_queue_outbound(uuid,text,uuid,text,text) from public;
grant execute on function public.fo_social_window(uuid,text,uuid), public.fo_queue_outbound(uuid,text,uuid,text,text) to anon, authenticated;
revoke all on function public.fo_decide_outbox(uuid,uuid,text,text), public.fo_outbox_sent(uuid,uuid,boolean,text) from public, anon;
grant execute on function public.fo_decide_outbox(uuid,uuid,text,text), public.fo_outbox_sent(uuid,uuid,boolean,text) to authenticated;
