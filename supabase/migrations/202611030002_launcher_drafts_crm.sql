-- Allow CRM contacts and pipeline deals to use the same revisioned, owner-write, member-read draft store.
alter table public.launcher_drafts drop constraint launcher_drafts_kind_check;
alter table public.launcher_drafts add constraint launcher_drafts_kind_check check (kind in ('skill-assessment','market-evidence','offer-validation','pricing-scenario','brand-direction','business-plan','crm-contacts','crm-pipeline'));
