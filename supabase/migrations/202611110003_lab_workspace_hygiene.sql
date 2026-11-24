-- Lab sandbox hygiene, task A-35 (follows 202611110001_front_office_lab.sql and 202611110002_front_office_lab_hardening.sql).
-- LOCAL / PGlite ONLY until the owner approves applying it anywhere else. Never `supabase db push` this.
--
-- A lab sandbox (workspaces.kind = 'lab') is for the Setter Lab and the Receptionist Lab only. Every fo_* table and
-- memberships already cascade from workspaces, so a deleted sandbox leaves nothing behind there. The other tables that
-- carry a workspace_id reference workspaces WITHOUT on delete, so a row in any of them would both put non-lab data into a
-- sandbox and block deleting the sandbox (and with it the user, see 202611110002).
--
-- Choice per table: REFUSE writes for lab workspaces (any insert or update of a row whose workspace is a lab). This is
-- the smaller safe option for every table below: no foreign key changes, so deleting a BUSINESS workspace keeps exactly
-- today's protective behaviour (refused while it still holds a profile, drafts, courses or orders), and a sandbox can
-- never hold such a row, so deleting it never meets one.
--   business_profiles  (save_profile, import_drafts)      refuse
--   offers             (save_offer, import_drafts)        refuse (already impossible without a profile; guarded anyway)
--   draft_imports      (import_drafts)                    refuse
--   launcher_drafts    (save_launcher_draft)              refuse
--   course_drafts      (save_course)                      refuse
--   orders             (record_test_order, server only)   refuse; record_test_order audits it as 'rejected' instead of
--                                                         raising, like any other unacceptable webhook event.
-- The guard runs for every role, including the database owner, like the other lab guards.
-- Re-apply safe (A-39): create or replace for functions, drop trigger if exists before each create trigger; revoke and
-- grant are idempotent.

create or replace function public.lab_workspace_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) then raise exception 'A lab sandbox only holds front office lab data.'; end if;
  return new;
end $$;
revoke all on function public.lab_workspace_write_guard() from public, anon, authenticated;

drop trigger if exists lab_workspace_write_guard on public.business_profiles;
create trigger lab_workspace_write_guard before insert or update on public.business_profiles for each row execute function public.lab_workspace_write_guard();
drop trigger if exists lab_workspace_write_guard on public.offers;
create trigger lab_workspace_write_guard before insert or update on public.offers for each row execute function public.lab_workspace_write_guard();
drop trigger if exists lab_workspace_write_guard on public.draft_imports;
create trigger lab_workspace_write_guard before insert or update on public.draft_imports for each row execute function public.lab_workspace_write_guard();
drop trigger if exists lab_workspace_write_guard on public.launcher_drafts;
create trigger lab_workspace_write_guard before insert or update on public.launcher_drafts for each row execute function public.lab_workspace_write_guard();
drop trigger if exists lab_workspace_write_guard on public.course_drafts;
create trigger lab_workspace_write_guard before insert or update on public.course_drafts for each row execute function public.lab_workspace_write_guard();
drop trigger if exists lab_workspace_write_guard on public.orders;
create trigger lab_workspace_write_guard before insert or update on public.orders for each row execute function public.lab_workspace_write_guard();

-- Same body as 202611030011_orders.sql, plus one rejection reason: a lab workspace never records an order.
create or replace function public.record_test_order(w uuid, event_id text, session_id text, amount integer, cur text, status text, email text)
returns text language plpgsql security definer set search_path='' as $$
declare oid uuid; why text; ev text := coalesce(nullif(left(event_id, 255), ''), 'unknown');
begin
  select id into oid from public.orders where stripe_event_id = event_id;
  if found then
    insert into public.order_audit(order_id, stripe_event_id, outcome) values (oid, ev, 'duplicate');
    return 'duplicate';
  end if;
  why := case
    when event_id is null or length(event_id) not between 1 and 255 then 'bad event id'
    when session_id is null or length(session_id) not between 1 and 255 then 'bad session id'
    when w is null or not exists (select 1 from public.workspaces where id = w) then 'unknown workspace'
    when public.fo_is_lab(w) then 'lab workspace'
    when amount is null or amount <= 0 then 'amount must be positive'
    when cur is null or cur !~ '^[A-Z]{3}$' then 'bad currency'
    when status is null or status not in ('paid','unpaid','refunded','failed') then 'bad payment status'
    when email is not null and length(email) > 254 then 'email too long'
    end;
  if why is not null then
    insert into public.order_audit(stripe_event_id, outcome, reason) values (ev, 'rejected', why);
    return 'rejected';
  end if;
  begin
    insert into public.orders(workspace_id, stripe_event_id, stripe_session_id, amount_minor, currency, payment_status, customer_email)
    values (w, event_id, session_id, amount, cur, status, email) returning id into oid;
  exception when unique_violation then
    insert into public.order_audit(stripe_event_id, outcome, reason) values (ev, 'rejected', 'session already recorded');
    return 'rejected';
  end;
  insert into public.order_audit(order_id, stripe_event_id, outcome) values (oid, ev, 'recorded');
  return 'recorded';
end $$;
revoke all on function public.record_test_order(uuid,text,text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.record_test_order(uuid,text,text,integer,text,text,text) to service_role;
