-- VENTRA front office: create the message channels for the "Ventra" workspace.
--
-- Run this whole script at once in the Supabase SQL editor (Ventra AI project). The editor runs as the database owner,
-- so it inserts into public.fo_channels directly, storing only the SHA-256 hash of each key, exactly as
-- public.fo_create_channel does. The result table shows each channel's id and key ONCE: copy them straight into Vercel
-- (Settings > Environment Variables, type Secret), then redeploy. Lost keys cannot be recovered; delete the row in
-- public.fo_channels and run this again to get a new one.
--
-- Safe to run again: channels that already exist (same kind and address) are left alone and their key is not shown.
--
-- Which env vars each channel feeds:
--   web-chat -> FRONT_OFFICE_CHAT_CHANNEL_ID / FRONT_OFFICE_CHAT_CHANNEL_KEY   (website chat, /api/front-office/chat)
--   email    -> FRONT_OFFICE_EMAIL_CHANNEL_ID / FRONT_OFFICE_EMAIL_CHANNEL_KEY (job runner) and the ?channel=&key= of the
--               Postmark inbound webhook URL (/api/front-office/email/inbound)
--   sms      -> FRONT_OFFICE_CHANNEL_ID / FRONT_OFFICE_CHANNEL_KEY             (Twilio webhook + job runner)
--   voice    -> FRONT_OFFICE_VOICE_CHANNEL_ID / FRONT_OFFICE_VOICE_CHANNEL_KEY (AI Receptionist via Vapi + job runner).
--               The key is also the credential you give Vapi (Bearer token) for the Custom LLM and the Server URL.
-- The job runner (/api/front-office/jobs/run) works through every one of these pairs that is set, because follow-ups and
-- reminders are scheduled on the channel the lead came in on.
--
-- 1. Edit the values below. Leave a PASTE_ placeholder as it is to skip that channel for now.
drop table if exists pg_temp.fo_setup_cfg;
create temp table fo_setup_cfg as select
  'Ventra'::text                               as workspace_name,  -- the workspace you created at /workspace
  'www.aiventra.com.au'::text                  as chat_address,    -- the site the chat widget is on
  'PASTE_POSTMARK_INBOUND_ADDRESS_HERE'::text  as email_address,   -- your Postmark inbound address (Servers > Inbound)
  'PASTE_TWILIO_NUMBER_E164_HERE'::text        as sms_number,      -- e.g. +61400000000, once you have bought it
  'vapi-ventra'::text                          as voice_address;   -- a label for the Vapi phone line (any text, unique)

-- 2. Checks. Stops with a clear message if the workspace is missing or the name matches more than one.
do $$
declare n integer; nm text;
begin
  select workspace_name into nm from fo_setup_cfg;
  select count(*) into n from public.workspaces w where w.name = nm;
  if n = 0 then raise exception 'No workspace called "%". Sign in at https://www.aiventra.com.au/workspace and create it first.', nm; end if;
  if n > 1 then raise exception 'More than one workspace is called "%". Rename the extra one, then run this again.', nm; end if;
end $$;

-- 3. New keys: 48 hex characters each from the database's random UUID generator (no extension needed).
drop table if exists pg_temp.fo_setup_new;
create temp table fo_setup_new as
select v.kind, v.address, v.id_var, v.key_var,
       substr(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 48) as channel_key
from fo_setup_cfg c,
     lateral (values ('web-chat', c.chat_address,  'FRONT_OFFICE_CHAT_CHANNEL_ID',  'FRONT_OFFICE_CHAT_CHANNEL_KEY'),
                     ('email',    c.email_address, 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY'),
                     ('sms',      c.sms_number,    'FRONT_OFFICE_CHANNEL_ID',       'FRONT_OFFICE_CHANNEL_KEY'),
                     ('voice',    c.voice_address, 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY')) v(kind, address, id_var, key_var)
where v.address not like 'PASTE\_%';

-- 4. Create the channels and show what to copy into Vercel.
with ws as (
  select w.id from public.workspaces w join fo_setup_cfg c on w.name = c.workspace_name
), ins as (
  insert into public.fo_channels(workspace_id, kind, address, key_hash)
  select ws.id, n.kind, n.address, encode(sha256(convert_to(n.channel_key, 'UTF8')), 'hex') from fo_setup_new n, ws
  on conflict (kind, address) do nothing
  returning id, kind, address
)
select n.kind as channel,
       coalesce(i.id, e.id)::text as channel_id,
       case when i.id is not null then n.channel_key else 'already set up earlier, key not shown (keep using the old one)' end as channel_key,
       n.id_var || '  /  ' || n.key_var as vercel_env_names
from fo_setup_new n
left join ins i on i.kind = n.kind and i.address = n.address
left join public.fo_channels e on e.kind = n.kind and e.address = n.address
union all
select v.kind, null, 'skipped: edit the placeholder at the top to add it', null
from fo_setup_cfg c, lateral (values ('email', c.email_address), ('sms', c.sms_number), ('voice', c.voice_address)) v(kind, address)
where v.address like 'PASTE\_%'
order by 1;
