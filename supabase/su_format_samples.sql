-- ============================================================
-- Format samples — a skipper whose settling sheet is not yet
-- readable can send one in so the reader can be built for it.
--
-- Run in the Supabase SQL editor. Creates a new bucket, a new
-- table and one helper function. Touches nothing that exists.
--
-- WHY
--   su-parse-document has prompts for two layouts only: the
--   Audacious posting report and the Beryl one-page sheet. Any
--   other agent's sheet needs its own prompt, and a prompt written
--   without ever seeing the sheet is the same mistake as a parser
--   written blind. This is how a real file gets to the person
--   writing the prompt.
--
-- THE PRIVACY POINT — read before running
--   A settling sheet carries CREW WAGES: names, gross, net, tax.
--   Those crew are third parties who have not agreed to anything.
--   The skipper uploading is their employer and can pass it on,
--   but that makes the app owner a processor of another business's
--   payroll. So this table is built to be defensible:
--     * upload is an explicit, per-file act — never a standing grant
--     * consent is recorded with a timestamp and the wording version
--     * the sender can withdraw and delete at any time
--     * it is deleted once their format is supported
--     * nobody but the sender's fleet and the app owner can read it
--   The upload screen tells them to black out crew names if they
--   would rather. The reader needs the layout, not who is on it.
--
--   This is a plain-English arrangement, not legal advice. If it
--   needs to be watertight, have the wording checked.
-- ============================================================


-- ============================================================
-- STEP 1 — create
-- ============================================================

-- Private bucket, separate from su-documents so a sample can never
-- be confused with a real settlement document.
insert into storage.buckets (id, name, public)
values ('su-format-samples', 'su-format-samples', false)
on conflict (id) do nothing;

-- Is the signed-in user the app owner? app_users.is_owner already
-- drives the "Add Boat" screen; this reuses it rather than inventing
-- a second idea of who runs the app.
create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select is_owner from public.app_users where id = auth.uid()), false);
$function$;

revoke all on function public.is_app_owner() from anon;
grant execute on function public.is_app_owner() to authenticated;

create table if not exists public.su_format_samples (
  id              uuid primary key default gen_random_uuid(),
  fleet_id        uuid not null references public.fleets(id) on delete cascade
                    default public.current_fleet_id(),
  uploaded_by     uuid references public.app_users(id) on delete set null,
  uploader_email  text,

  vessel_name     text,     -- whose sheet it is
  agent           text,     -- who issues it: Don, LHD, Scrabster, ...
  file_path       text not null,
  note            text,

  status          text not null default 'pending'
                    check (status in ('pending','in_progress','supported','withdrawn')),

  -- Consent is recorded, not assumed. The version pins which wording
  -- was on screen when they agreed, so it can be shown again later.
  consent_at      timestamptz not null default now(),
  consent_version text not null default '2026-08-a',

  created_at      timestamptz not null default now()
);

create index if not exists su_format_samples_fleet_idx  on public.su_format_samples (fleet_id);
create index if not exists su_format_samples_status_idx on public.su_format_samples (status, created_at desc);

grant select, insert, update, delete on public.su_format_samples to authenticated;
alter table public.su_format_samples enable row level security;

-- The sender's fleet sees its own. The app owner sees all — that is the
-- whole point of the feature, and it is the ONLY cross-fleet read here.
drop policy if exists su_format_samples_read on public.su_format_samples;
create policy su_format_samples_read on public.su_format_samples
  for select to authenticated
  using (fleet_id = public.current_fleet_id() or public.is_app_owner());

-- You may only submit for your own fleet.
drop policy if exists su_format_samples_insert on public.su_format_samples;
create policy su_format_samples_insert on public.su_format_samples
  for insert to authenticated
  with check (fleet_id = public.current_fleet_id());

-- Owner marks progress; the sender can amend their own note.
drop policy if exists su_format_samples_update on public.su_format_samples;
create policy su_format_samples_update on public.su_format_samples
  for update to authenticated
  using      (fleet_id = public.current_fleet_id() or public.is_app_owner())
  with check (fleet_id = public.current_fleet_id() or public.is_app_owner());

-- Withdrawal has to work, or the consent is not real.
drop policy if exists su_format_samples_delete on public.su_format_samples;
create policy su_format_samples_delete on public.su_format_samples
  for delete to authenticated
  using (fleet_id = public.current_fleet_id() or public.is_app_owner());


-- ---- storage: path is {fleet_id}/{ts}_{filename} ---------------------
-- The folder is compared as text against current_fleet_id(), never cast,
-- so an odd folder name can only fail to match — it cannot error the
-- policy and lock people out.
drop policy if exists su_samples_insert on storage.objects;
create policy su_samples_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'su-format-samples'
    and (storage.foldername(name))[1] = public.current_fleet_id()::text
  );

drop policy if exists su_samples_read on storage.objects;
create policy su_samples_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'su-format-samples'
    and (
      (storage.foldername(name))[1] = public.current_fleet_id()::text
      or public.is_app_owner()
    )
  );

drop policy if exists su_samples_delete on storage.objects;
create policy su_samples_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'su-format-samples'
    and (
      (storage.foldername(name))[1] = public.current_fleet_id()::text
      or public.is_app_owner()
    )
  );


-- ============================================================
-- STEP 2 — VERIFY (reads only)
-- ============================================================

select id, public from storage.buckets where id = 'su-format-samples';
-- expect: su-format-samples, public = false

select policyname, cmd from pg_policies
 where schemaname='public' and tablename='su_format_samples' order by policyname;
-- expect 4: read / insert / update / delete

select policyname, cmd from pg_policies
 where schemaname='storage' and tablename='objects' and policyname like 'su_samples%'
 order by policyname;
-- expect 3

-- Who counts as the app owner (this read is owner-visible only in the app,
-- but the SQL editor runs as the project owner so it always shows).
select email, is_owner from public.app_users where is_owner is true;

select count(*) as samples from public.su_format_samples;
-- expect 0


-- ============================================================
-- DELETING A SAMPLE ONCE THE FORMAT IS SUPPORTED
-- The row goes when the file goes. Storage has a protect_delete
-- trigger, so remove the object through the Storage API (or the
-- dashboard), not with a direct SQL delete on storage.objects:
--
--   update public.su_format_samples set status='supported' where id = '...';
--   -- then delete the file in Storage, then:
--   delete from public.su_format_samples where id = '...';
--
-- ROLLBACK
--   drop policy if exists su_samples_insert on storage.objects;
--   drop policy if exists su_samples_read   on storage.objects;
--   drop policy if exists su_samples_delete on storage.objects;
--   drop table if exists public.su_format_samples;
--   drop function if exists public.is_app_owner();
--   delete from storage.buckets where id='su-format-samples';  -- only if empty
-- ============================================================
