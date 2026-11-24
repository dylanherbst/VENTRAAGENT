-- AI front office, task A-33: hardening of the lab sandbox (202611110001_front_office_lab.sql, task A-25).
-- LOCAL / PGlite ONLY until the owner approves applying it anywhere else. Never `supabase db push` this.
--
-- Correction to the 202611110001 header, rule 4 ("phone numbers only ever arrive through a lab channel, which only the
-- lab (holding the channel key) can call"): that overstates it. fo_lab_ensure_sandbox accepts ANY 32 to 200 character
-- key from ANY signed-in user and sets it as the key of that user's own lab channels. So any signed-in user can choose
-- their own lab channel key and then write whatever phone numbers they like into THEIR OWN sandbox through the lab
-- channel RPCs. What still holds: the key only ever opens the caller's own sandbox channels (addresses are bound to the
-- workspace id and to kinds sms/voice, see below), a sandbox has no member but its owner, it can never hold
-- fo_connections, and no provider webhook resolves to a 'lab:' address. Blast radius: the caller's own sandbox only.
-- A server-only (service-role) path for setting the key is deliberately not added in this task.

-- 1. Deleting a user removes their sandbox. fo_lab_sandboxes.owner_id now cascades, and removing a sandbox row removes
--    its lab workspace (and with it the lab membership, channels, conversation rows and scenarios, all of which cascade
--    from workspaces). memberships.user_id still references auth.users without on delete (202610160001), so a user who
--    is a member of any BUSINESS workspace still cannot be deleted until those memberships go, exactly as before; the
--    sandbox never adds a blocker of its own, because its membership disappears with its workspace.
alter table public.fo_lab_sandboxes drop constraint fo_lab_sandboxes_owner_id_fkey;
alter table public.fo_lab_sandboxes add constraint fo_lab_sandboxes_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;

create function public.fo_lab_sandbox_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.workspaces where id = old.workspace_id and kind = 'lab';
  return old;
end $$;
create trigger fo_lab_sandbox_cleanup after delete on public.fo_lab_sandboxes for each row execute function public.fo_lab_sandbox_cleanup();

-- The sandbox's lab membership must be gone before auth.users' memberships check runs (that check is NO ACTION and is
-- evaluated before the cascade above reaches the workspace). So the lab workspace is also removed before the user row.
create function public.fo_lab_user_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.workspaces w using public.fo_lab_sandboxes s where s.owner_id = old.id and w.id = s.workspace_id and w.kind = 'lab';
  return old;
end $$;
create trigger fo_lab_user_cleanup before delete on auth.users for each row execute function public.fo_lab_user_cleanup();

-- 2. Lab channels: only kinds sms and voice (the two fo_lab_ensure_sandbox makes), on 'lab:<kind>:<workspace id>'.
create or replace function public.fo_lab_channel_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.fo_is_lab(new.workspace_id) then
    if new.kind is null or new.kind not in ('sms','voice')
       or new.address is distinct from 'lab:' || new.kind || ':' || new.workspace_id::text then
      raise exception 'A lab sandbox only has lab channels.';
    end if;
  elsif new.address like 'lab:%' then
    raise exception 'Lab addresses are reserved for the lab sandbox.';
  end if;
  return new;
end $$;

revoke all on function public.fo_lab_sandbox_cleanup(), public.fo_lab_user_cleanup(), public.fo_lab_channel_guard() from public, anon, authenticated;

-- 3. At most 20 saved scenarios per lab (was 50). Same body as 202611110001 otherwise.
create or replace function public.fo_lab_save_scenario(w uuid, product_name text, scenario_name text, lab_state jsonb, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.fo_lab_scenarios; snap jsonb;
begin
  perform public.fo_lab_require(w);
  if product_name is null or product_name not in ('setter','receptionist') then raise exception 'Unknown lab.'; end if;
  if scenario_name is null or scenario_name !~ '^[A-Za-z0-9][A-Za-z0-9 _.,()-]{0,79}$' then raise exception 'Scenario name must be 1 to 80 letters, numbers or spaces.'; end if;
  if jsonb_typeof(lab_state) is distinct from 'object' or octet_length(lab_state::text) > 512000 then raise exception 'Lab state is not valid or too large.'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Revision required.'; end if;
  perform 1 from public.workspaces where id = w for update;
  snap := public.fo_lab_snapshot(w);
  if octet_length(snap::text) > 2000000 then raise exception 'The sandbox holds too much to save. Reset it first.'; end if;
  if expected_revision = 0 then
    if (select count(*) from public.fo_lab_scenarios where workspace_id = w and product = product_name) >= 20 then raise exception 'Too many saved scenarios. Delete one first.'; end if;
    insert into public.fo_lab_scenarios(workspace_id, product, name, state, snapshot) values (w, product_name, scenario_name, lab_state, snap)
    on conflict (workspace_id, product, name) do nothing returning * into s;
    if s.id is null then raise exception 'A scenario with this name already exists.'; end if;
  else
    update public.fo_lab_scenarios set state = lab_state, snapshot = snap, revision = revision + 1, updated_at = now()
     where workspace_id = w and product = product_name and name = scenario_name and revision = expected_revision returning * into s;
    if s.id is null then raise exception 'Scenario was changed elsewhere. Reload and try again.'; end if;
  end if;
  return jsonb_build_object('id', s.id, 'product', s.product, 'name', s.name, 'revision', s.revision, 'updatedAt', s.updated_at,
    'contacts', jsonb_array_length(snap->'contacts'), 'appointments', jsonb_array_length(snap->'appointments'));
end $$;

-- 4. Honest documentation on the functions themselves.
comment on function public.fo_lab_ensure_sandbox(text) is
  'Makes or returns the caller''s lab sandbox and sets channel_key (any 32 to 200 characters chosen by the caller) as the key of its two lab channels. '
  'Any signed-in user can set any key, so lab channel data (including phone numbers) is whatever the caller writes into their OWN sandbox; '
  'the key opens no other workspace. Not a provenance guarantee.';
comment on function public.fo_lab_snapshot(uuid) is
  'Snapshot format v (currently 1) = the exact row shape of fo_contacts, fo_calls, fo_messages, fo_events, fo_handoffs, fo_appointments, fo_jobs, '
  'fo_outbox and fo_pending_actions. fo_lab_restore inserts with jsonb_populate_recordset + insert ... select *. '
  'BUMP v here AND in fo_lab_restore whenever any of those fo_* tables changes shape (column added, removed, renamed, retyped or reordered), '
  'so stale scenarios are refused with a clear message instead of restoring wrong data.';
comment on function public.fo_lab_restore(uuid, jsonb) is
  'Restores a fo_lab_snapshot into an emptied sandbox with insert ... select * per table. Accepts only snapshot v = 1: '
  'bump v in fo_lab_snapshot and here whenever any snapshotted fo_* table changes shape.';
comment on function public.fo_lab_save_scenario(uuid, text, text, jsonb, integer) is
  'Saves the lab state and a snapshot of the sandbox rows. expected_revision 0 creates; otherwise it must match. At most 20 scenarios per lab.';
