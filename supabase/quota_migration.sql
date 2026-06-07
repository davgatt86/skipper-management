-- ============================================================
-- QUOTA MODULE — run once in Supabase SQL editor
-- AFPO holdings snapshots + mcatch trip-report catches.
-- Skipper-only RLS (same pattern as sales_*), fleet-scoped from
-- day one (fleet_id default = current_fleet_id(), restrictive
-- isolation policy layered on top like multi_tenancy.sql).
-- Safe to re-run (idempotent).
-- ============================================================

-- Outstanding from multi-tenancy checklist: each vessel is its
-- own business, so David's fleet row is the boat, not Don Fishing.
update public.fleets
set name = 'AUDACIOUS BF83'
where id = '00000000-0000-4000-8000-000000000001'
  and name <> 'AUDACIOUS BF83';

-- ------------------------------------------------------------
-- 1. AFPO holdings: one snapshot per uploaded statement
-- ------------------------------------------------------------
create table if not exists public.quota_snapshots (
  id                uuid primary key default gen_random_uuid(),
  fleet_id          uuid not null references public.fleets(id) default public.current_fleet_id(),
  year              int  not null,                 -- quota year, e.g. 2026
  vessel            text not null default '',      -- e.g. AUDACIOUS
  last_landing_date date,                          -- statement "DATE OF LAST LANDING"
  last_updated      timestamptz,                   -- statement "LAST UPDATED"
  filename          text default '',
  fqa_grand_total   numeric,                       -- printed bottom-right FQA total
  reconcile_ok      boolean,                       -- FQA section subtotals match line sums
  created_at        timestamptz default now()
);
create unique index if not exists quota_snapshots_unique
  on public.quota_snapshots (fleet_id, year, last_updated);
create index if not exists quota_snapshots_fleet_idx on public.quota_snapshots (fleet_id);

create table if not exists public.quota_lines (
  id           uuid primary key default gen_random_uuid(),
  snapshot_id  uuid not null references public.quota_snapshots(id) on delete cascade,
  fleet_id     uuid not null references public.fleets(id) default public.current_fleet_id(),
  section      text not null,        -- North Sea | West Coast | Area VII | Area VIII
  stock        text not null,        -- e.g. 'NS Cod', 'Haddock Area VIb'
  tac_share    numeric,              -- tonnes, all columns below likewise
  aq           numeric,
  banking      numeric,
  lease        numeric,              -- internal lease
  swaps        numeric,              -- external swaps
  allocation   numeric,              -- total allocation
  flexibility  numeric,              -- scientific / flexibility
  catch_uk     numeric,
  catch_nor    numeric,
  catch_total  numeric,
  balance      numeric,              -- balance remaining
  fqa_units    numeric,
  fqa_side     numeric,              -- col-N side note (Norway Ling, WS Sole)
  sci_quota    numeric               -- 2026+ Scientific Quota column
);
create index if not exists quota_lines_snapshot_idx on public.quota_lines (snapshot_id);
create index if not exists quota_lines_fleet_idx on public.quota_lines (fleet_id);

-- ------------------------------------------------------------
-- 2. mcatch trip reports: one row per trip + per catch entry
-- ------------------------------------------------------------
create table if not exists public.quota_trips (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.fleets(id) default public.current_fleet_id(),
  trip_nr        text not null,                 -- dedup key, e.g. C2100420260002
  vessel         text not null default '',
  departure_port text default '',
  departure_at   timestamptz,
  arrival_port   text default '',
  arrival_at     timestamptz,
  captain        text default '',
  total_live_kg  numeric default 0,             -- parsed sum of catch detail rows
  printed_total_kg numeric,                     -- printed "Totals" on the report
  reconcile_ok   boolean,
  filename       text default '',
  created_at     timestamptz default now()
);
create unique index if not exists quota_trips_unique on public.quota_trips (fleet_id, trip_nr);
create index if not exists quota_trips_fleet_idx on public.quota_trips (fleet_id);

create table if not exists public.quota_trip_catches (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.quota_trips(id) on delete cascade,
  fleet_id    uuid not null references public.fleets(id) default public.current_fleet_id(),
  catch_date  date not null,         -- FAR activity date -> year-straddle split per row
  species_fao text not null,         -- FAO 3-alpha, e.g. POK
  fao_area    text not null,         -- e.g. 27.4.a / 27.6.a.s / 27.6.b.2
  sr          text default '',       -- statistical rectangle, e.g. 48F1
  eez         text default '',       -- GBR | NOR
  live_kg     numeric not null default 0
);
create index if not exists quota_trip_catches_trip_idx on public.quota_trip_catches (trip_id);
create index if not exists quota_trip_catches_fleet_idx on public.quota_trip_catches (fleet_id);
create index if not exists quota_trip_catches_date_idx on public.quota_trip_catches (catch_date);

-- ------------------------------------------------------------
-- 3. RLS: skipper-only, plus restrictive fleet isolation
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['quota_snapshots','quota_lines','quota_trips','quota_trip_catches']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_skipper', t);
    execute format(
      'create policy %I on public.%I for all
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))
         with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_skipper', t);

    execute format('drop policy if exists %I on public.%I', 'fleet_isolation_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (fleet_id = public.current_fleet_id())
         with check (fleet_id = public.current_fleet_id())',
      'fleet_isolation_' || t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. Verify
-- ------------------------------------------------------------
select 'fleets' as what, name as detail from public.fleets
union all
select 'table', relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relkind = 'r'
  and rel.relname like 'quota_%';
