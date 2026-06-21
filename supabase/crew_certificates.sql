-- ============================================================
-- Crew certificates — store each crewman's tickets/medicals with
-- expiry dates and the original scan, scoped per fleet.
--
-- Run once in the Supabase SQL editor. Mirrors the quota tables'
-- access model: skipper-only writes + restrictive fleet isolation.
-- Also creates a PRIVATE storage bucket for the cert files, locked
-- to each fleet by the first folder of the object path
-- (path convention: {fleet_id}/{crew_id}/{timestamp}-{filename}).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
create table if not exists public.crew_certificates (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) default public.current_fleet_id(),
  crew_id     uuid not null references public.crew(id) on delete cascade,
  cert_type   text not null,
  cert_number text,
  holder_name text,
  issuer      text,
  issue_date  date,
  expiry_date date,
  file_path   text,                 -- storage object path in the crew-certs bucket
  file_name   text,                 -- original filename, for display
  notes       text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists crew_certificates_fleet_idx  on public.crew_certificates (fleet_id);
create index if not exists crew_certificates_crew_idx   on public.crew_certificates (crew_id);
create index if not exists crew_certificates_expiry_idx on public.crew_certificates (expiry_date);

grant select, insert, update, delete on public.crew_certificates to authenticated;

-- ------------------------------------------------------------
-- 2. RLS — skipper-only, plus restrictive fleet isolation
-- ------------------------------------------------------------
alter table public.crew_certificates enable row level security;

drop policy if exists crew_certificates_skipper on public.crew_certificates;
create policy crew_certificates_skipper on public.crew_certificates for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_crew_certificates on public.crew_certificates;
create policy fleet_isolation_crew_certificates on public.crew_certificates as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- ------------------------------------------------------------
-- 3. Private storage bucket for the cert scans
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('crew-certs', 'crew-certs', false)
on conflict (id) do nothing;

-- Each policy is scoped to this bucket and to the fleet that owns the
-- first path segment. Reads allowed to any fleet member; writes/deletes
-- to skippers only (matches the table policy).
drop policy if exists crew_certs_read on storage.objects;
create policy crew_certs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'crew-certs'
    and (storage.foldername(name))[1] = public.current_fleet_id()::text
  );

drop policy if exists crew_certs_insert on storage.objects;
create policy crew_certs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'crew-certs'
    and (storage.foldername(name))[1] = public.current_fleet_id()::text
    and exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper')
  );

drop policy if exists crew_certs_update on storage.objects;
create policy crew_certs_update on storage.objects for update to authenticated
  using (
    bucket_id = 'crew-certs'
    and (storage.foldername(name))[1] = public.current_fleet_id()::text
    and exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper')
  );

drop policy if exists crew_certs_delete on storage.objects;
create policy crew_certs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'crew-certs'
    and (storage.foldername(name))[1] = public.current_fleet_id()::text
    and exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper')
  );

-- ------------------------------------------------------------
-- 4. Verify
-- ------------------------------------------------------------
select 'table' as what, 'crew_certificates' as detail
union all
select 'bucket', id from storage.buckets where id = 'crew-certs';
