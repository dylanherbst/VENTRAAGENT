-- Account-backed Business Launcher drafts: one draft per kind per workspace, optimistic revisions, owner writes, member reads.
create table public.launcher_drafts (
 workspace_id uuid not null references public.workspaces(id),
 kind text not null check (kind in ('skill-assessment','market-evidence','offer-validation','pricing-scenario','brand-direction','business-plan')),
 data jsonb not null check (jsonb_typeof(data)='object' and length(data::text)<=128000),
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(workspace_id,kind)
);
alter table public.launcher_drafts enable row level security;
revoke all on public.launcher_drafts from anon, authenticated;
grant select on public.launcher_drafts to authenticated;
create policy launcher_read on public.launcher_drafts for select to authenticated using(public.workspace_role(workspace_id) is not null);

create function public.save_launcher_draft(w uuid, draft_kind text, payload jsonb, expected_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare next_revision integer;
begin
 if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
 if expected_revision is null or expected_revision < 0 then raise exception 'Refresh before saving'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or length(payload::text) > 128000 then raise exception 'Invalid draft'; end if;
 if expected_revision=0 then
  insert into public.launcher_drafts(workspace_id,kind,data) values(w,draft_kind,payload) returning revision into next_revision;
 else
  update public.launcher_drafts set data=payload,revision=revision+1,updated_at=now() where workspace_id=w and kind=draft_kind and revision=expected_revision returning revision into next_revision;
  if not found then raise exception 'Revision conflict'; end if;
 end if;
 return next_revision;
end $$;
revoke all on function public.save_launcher_draft(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.save_launcher_draft(uuid,text,jsonb,integer) to authenticated;

create function public.delete_launcher_draft(w uuid, draft_kind text, expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
 delete from public.launcher_drafts where workspace_id=w and kind=draft_kind and revision=expected_revision;
 if not found then raise exception 'Revision conflict'; end if;
end $$;
revoke all on function public.delete_launcher_draft(uuid,text,integer) from public,anon;
grant execute on function public.delete_launcher_draft(uuid,text,integer) to authenticated;
