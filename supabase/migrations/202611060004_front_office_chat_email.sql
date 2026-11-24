-- AI front office, tracker 1.8 and 1.9: web chat and email channels. A web chat visitor is a contact before they share
-- a phone or email (an anonymous visitor id from the widget). One generic ingest for chat and email; SMS keeps fo_ingest_sms.

alter table public.fo_contacts add column web_visitor text check (web_visitor is null or web_visitor ~ '^[A-Za-z0-9_-]{16,64}$');
alter table public.fo_contacts add constraint fo_contacts_visitor_unique unique (workspace_id, web_visitor);
alter table public.fo_contacts drop constraint fo_contacts_check;
alter table public.fo_contacts add constraint fo_contacts_reachable check (phone is not null or email is not null or web_visitor is not null);

create function public.fo_ingest(channel uuid, channel_key text, sender text, message text, msg_id text, opt_out boolean, opt_in boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; ch public.fo_channels; c public.fo_contacts; who text; created boolean := false; dup boolean := false;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select * into ch from public.fo_channels where id = channel;
  if ch.kind not in ('web-chat','email') then raise exception 'Channel not recognised.'; end if;
  if msg_id is null or length(msg_id) not between 8 and 200 then raise exception 'Message id required.'; end if;
  who := case when ch.kind = 'email' then lower(trim(sender)) else trim(sender) end;
  if ch.kind = 'email' and (who !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(who) > 254) then raise exception 'Sender email is not valid.'; end if;
  if ch.kind = 'web-chat' and who !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'Visitor id is not valid.'; end if;
  if ch.kind = 'email' then select * into c from public.fo_contacts where workspace_id = w and email = who for update;
  else select * into c from public.fo_contacts where workspace_id = w and web_visitor = who for update; end if;
  if not found then
    if ch.kind = 'email' then insert into public.fo_contacts(workspace_id, email) values (w, who) on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and email = who for update;
    else insert into public.fo_contacts(workspace_id, web_visitor) values (w, who) on conflict do nothing;
      select * into c from public.fo_contacts where workspace_id = w and web_visitor = who for update; end if;
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
    elsif opt_in and c.opted_out_at is not null then
      update public.fo_contacts set opted_out_at = null, updated_at = now() where id = c.id returning * into c;
      insert into public.fo_events(workspace_id, contact_id, kind, detail) values (w, c.id, 'opt-in', ch.kind);
    end if;
  end if;
  return jsonb_build_object('workspace', w, 'contact', c.id, 'state', c.state, 'optedOut', c.opted_out_at is not null, 'created', created, 'duplicate', dup);
end $$;

-- Setter: answers plus contact details. A phone or email already on another contact is not moved (no silent merge);
-- the result says so, and a person can merge later.
create function public.fo_save_details(channel uuid, channel_key text, contact uuid, new_answers jsonb, contact_name text, contact_email text, contact_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; merged jsonb; skipped text[] := '{}';
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if jsonb_typeof(coalesce(new_answers, '{}')) <> 'object' then raise exception 'Answers must be an object.'; end if;
  update public.fo_contacts set answers = answers || coalesce(new_answers, '{}'), name = coalesce(nullif(left(trim(contact_name), 160), ''), name), updated_at = now()
   where id = contact and workspace_id = w returning answers into merged;
  if merged is null then raise exception 'Contact not found.'; end if;
  if nullif(trim(contact_email), '') is not null then
    begin
      update public.fo_contacts set email = lower(trim(contact_email)) where id = contact and email is distinct from lower(trim(contact_email));
    exception when unique_violation or check_violation then skipped := array_append(skipped, 'email'); end;
  end if;
  if nullif(trim(contact_phone), '') is not null then
    begin
      update public.fo_contacts set phone = trim(contact_phone) where id = contact and phone is distinct from trim(contact_phone);
    exception when unique_violation or check_violation then skipped := array_append(skipped, 'phone'); end;
  end if;
  return jsonb_build_object('answers', merged, 'skipped', to_jsonb(skipped));
end $$;

-- Chat widget: the visitor's own conversation, to redraw the chat after a reload.
create function public.fo_chat_history(channel uuid, channel_key text, visitor text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid; cid uuid;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  select id into cid from public.fo_contacts where workspace_id = w and web_visitor = visitor;
  if cid is null then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'body', m.body, 'at', m.created_at) order by m.created_at)
    from (select * from public.fo_messages where contact_id = cid and channel_id = channel order by created_at desc limit 40) m), '[]');
end $$;

revoke all on function public.fo_ingest(uuid,text,text,text,text,boolean,boolean), public.fo_save_details(uuid,text,uuid,jsonb,text,text,text), public.fo_chat_history(uuid,text,text) from public;
grant execute on function public.fo_ingest(uuid,text,text,text,text,boolean,boolean), public.fo_save_details(uuid,text,uuid,jsonb,text,text,text), public.fo_chat_history(uuid,text,text) to anon, authenticated;
