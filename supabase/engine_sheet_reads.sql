/* THE ENGINE ROOM SHEET IS READ OFF A PHOTOGRAPH — and the read is KEPT. Sep 2026.
 *
 * David: *"build the photo reader for the sheet."* The engineer photographs the
 * printed Daily Engine Room Log, the AI reader fills the form, and nothing is
 * saved until he has checked it against the paper.
 *
 * WHY NOT su_parse_jobs, which every other read uses. That table is DENIED to the
 * officer (`officer_no_access`), and rightly: in the same fleet it carries the
 * settling sheets and invoice reads for 24 hours, and those are money. The man
 * who photographs the engine room sheet is the officer. So an engine sheet read
 * gets its own table he can read, and nothing about the money boundary moves.
 *
 * AND IT IS A RECORD, NOT A JOB. su_parse_jobs is swept after a day; these are
 * not. `result` is what the reader said the sheet reads, `engine_logs.
 * sheet_read_id` is the log that was saved from it — so what the reader got
 * wrong can be MEASURED, the thing CLAUDE.md says the certificate reader has
 * never had. The link lives on the LOG rather than the read because the log is
 * saved through the offline outbox: one insert carries it, where a second update
 * pointing at a log not yet synced would fail its foreign key.
 *
 * WRITTEN ONLY BY THE READER, on the service-role key. The authenticated role
 * holds SELECT and nothing else, so a read cannot be rewritten after the fact to
 * flatter the reader.
 *
 * THE PHOTO IS KEPT IN `engine-sheets/{fleet_id}/...`, and there is no update or
 * delete policy on it: it is the evidence of what the reader was shown.
 */

create table if not exists public.engine_sheet_reads (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  vessel_id     uuid,
  file_path     text not null,
  status        text not null default 'reading' check (status in ('reading', 'done', 'error')),
  result        jsonb,
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint engine_sheet_reads_vessel_same_fleet
    foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id)
);

create index if not exists engine_sheet_reads_fleet_idx on public.engine_sheet_reads (fleet_id, created_at desc);

alter table public.engine_sheet_reads enable row level security;

revoke all on public.engine_sheet_reads from anon;
revoke insert, update, delete, truncate on public.engine_sheet_reads from authenticated;
grant select on public.engine_sheet_reads to authenticated;

drop policy if exists fleet_isolation on public.engine_sheet_reads;
create policy fleet_isolation on public.engine_sheet_reads as restrictive
  for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- The two roles that keep the engine log. An allow-list of roles, so a role
-- added later sees nothing until somebody decides it should.
drop policy if exists engine_sheet_reads_keepers on public.engine_sheet_reads;
create policy engine_sheet_reads_keepers on public.engine_sheet_reads
  for select to authenticated
  using (
    (select public.is_officer())
    or exists (select 1 from public.app_users u where u.id = (select auth.uid()) and u.role = 'skipper')
  );

drop policy if exists cook_no_access on public.engine_sheet_reads;
create policy cook_no_access on public.engine_sheet_reads as restrictive
  for all to authenticated
  using (not (select public.is_cook()))
  with check (not (select public.is_cook()));

alter table public.engine_logs
  add column if not exists sheet_read_id uuid references public.engine_sheet_reads(id) on delete set null;


-- The bucket ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('engine-sheets', 'engine-sheets', false, 15000000,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- `storage.objects.name` qualified, the habit that fixes the su_docs_* bug.
drop policy if exists engine_sheets_read on storage.objects;
create policy engine_sheets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'engine-sheets'
    and (storage.foldername(storage.objects.name))[1] = public.current_fleet_id()::text
    and ((select public.is_officer())
         or exists (select 1 from public.app_users u where u.id = (select auth.uid()) and u.role = 'skipper'))
  );

drop policy if exists engine_sheets_insert on storage.objects;
create policy engine_sheets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'engine-sheets'
    and (storage.foldername(storage.objects.name))[1] = public.current_fleet_id()::text
    and ((select public.is_officer())
         or exists (select 1 from public.app_users u where u.id = (select auth.uid()) and u.role = 'skipper'))
  );

-- The officer's restrictive storage scope opens by this one bucket, in both
-- halves. Mirrored in officer_role.sql section 5 so a re-run keeps it.
drop policy if exists officer_storage_scope on storage.objects;
create policy officer_storage_scope on storage.objects as restrictive
  for all to authenticated
  using (not (select public.is_officer()) or bucket_id in ('crew-certs', 'vessel-certs', 'engine-sheets'))
  with check (not (select public.is_officer()) or bucket_id in ('crew-certs', 'engine-sheets'));
