-- ============================================================
-- QUOTA RESET — wipe AUDACIOUS BF83 quota data for a fresh start
-- Run once in the Supabase SQL editor.
--
-- Scoped to this fleet only (00000000-0000-4000-8000-000000000001),
-- so no other skipper's quota data is touched. Children cascade from
-- their parents: quota_lines from snapshots, quota_trip_catches from
-- trips, quota_manual_entries from manual_stocks. Tables that only
-- exist once quota_manual.sql has been run are guarded, so this is
-- safe to run either way, and safe to re-run.
--
-- Want to KEEP your AFPO statement and only redo trips? Comment out
-- the quota_snapshots delete below before running.
-- ============================================================

do $$
declare
  fid uuid := '00000000-0000-4000-8000-000000000001';   -- AUDACIOUS BF83
begin
  -- what-if swaps & rentals
  if to_regclass('public.quota_adjustments') is not null then
    delete from public.quota_adjustments where fleet_id = fid;
  end if;

  -- manual stocks (+ their typed entries via cascade)
  if to_regclass('public.quota_manual_stocks') is not null then
    delete from public.quota_manual_stocks where fleet_id = fid;
  end if;

  -- mcatch trip reports (+ their catches via cascade)
  if to_regclass('public.quota_trips') is not null then
    delete from public.quota_trips where fleet_id = fid;
  end if;

  -- AFPO holdings statements (+ their lines via cascade)
  if to_regclass('public.quota_snapshots') is not null then
    delete from public.quota_snapshots where fleet_id = fid;
  end if;
end $$;

-- ------------------------------------------------------------
-- Verify — every count should now read 0
-- ------------------------------------------------------------
select 'quota_snapshots'    as table_name, count(*) as rows from public.quota_snapshots    where fleet_id = '00000000-0000-4000-8000-000000000001'
union all
select 'quota_lines',        count(*) from public.quota_lines        where fleet_id = '00000000-0000-4000-8000-000000000001'
union all
select 'quota_trips',        count(*) from public.quota_trips        where fleet_id = '00000000-0000-4000-8000-000000000001'
union all
select 'quota_trip_catches', count(*) from public.quota_trip_catches where fleet_id = '00000000-0000-4000-8000-000000000001'
order by table_name;
