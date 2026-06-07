-- ============================================================
-- PRE-EXPANSION UPDATES — run once in Supabase SQL editor
-- 1. landings.boxes -> numeric (Don sheets land part-boxes, e.g. 825.25)
-- 2. crew.crew_type -> 'contracted' | 'self_employed' (UK rotation guys,
--    no box bonus, listed for the rota)
-- 3. quota_adjustments -> what-if swaps & rentals on the Quota page
-- Safe to re-run.
-- ============================================================

-- 1. Decimal boxes
alter table public.landings
  alter column boxes type numeric using boxes::numeric;

-- 2. Crew type
alter table public.crew
  add column if not exists crew_type text not null default 'contracted';

-- 3. What-if swaps & rentals (skipper-only, fleet-scoped)
create table if not exists public.quota_adjustments (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null references public.fleets(id) default public.current_fleet_id(),
  year       int  not null,
  stock      text not null,                      -- AFPO stock label, e.g. 'NS Cod'
  direction  text not null check (direction in ('in','out')),
  tonnes     numeric not null check (tonnes > 0),
  note       text default '',
  created_at timestamptz default now()
);
create index if not exists quota_adjustments_fleet_idx on public.quota_adjustments (fleet_id);
create index if not exists quota_adjustments_year_idx on public.quota_adjustments (year);

alter table public.quota_adjustments enable row level security;

drop policy if exists quota_adjustments_skipper on public.quota_adjustments;
create policy quota_adjustments_skipper on public.quota_adjustments for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_quota_adjustments on public.quota_adjustments;
create policy fleet_isolation_quota_adjustments on public.quota_adjustments
  as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- Verify
select column_name, data_type from information_schema.columns
where table_name = 'landings' and column_name = 'boxes'
union all
select column_name, data_type from information_schema.columns
where table_name = 'crew' and column_name = 'crew_type'
union all
select 'quota_adjustments', 'created' from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'quota_adjustments';
