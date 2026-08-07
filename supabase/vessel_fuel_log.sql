-- ============================================================
-- Fuel and oil log — Aegir's fuel/lubes log, copied.
-- Applied and verified Aug 2026.
--
-- One table for all four kinds, because they share every column that
-- matters and differ only in direction: fuel and lube oil come aboard,
-- dirty oil and waste go ashore.
--
-- The 34 rows of Audacious data were loaded by the Supabase migration
-- `vessel_fuel_log_aegir_migration` (read from Aegir 07-08-2026):
--   fuel 22 entries 896,378 L · lube_oil 9 entries 3,140 L
--   dirty_oil 2 entries 4,700 L · waste 1 entry 3,500 L
-- Each total matches Aegir's own to the litre, so nothing was dropped.
-- ============================================================

create table if not exists public.vessel_fuel_log (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  kind          text not null check (kind in ('fuel','lube_oil','dirty_oil','waste')),
  entry_date    date not null,
  litres        numeric not null check (litres > 0),
  grade         text,          -- MGO / MDO / Rando 46 / Meropa 150 / Mixed Waste
  location      text,          -- port bunkered, or disposal location
  counterparty  text,          -- supplier, or disposal contractor
  method        text,          -- disposals only: Shore Facility / Approved Contractor
  running_hours numeric,       -- fuel only, when recorded
  consumption_l numeric,       -- fuel only: Aegir's "consumption since last bunkering"
  recorded_by   text,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists vessel_fuel_log_fleet_idx on public.vessel_fuel_log (fleet_id);
create index if not exists vessel_fuel_log_date_idx  on public.vessel_fuel_log (entry_date);
create index if not exists vessel_fuel_log_kind_idx  on public.vessel_fuel_log (kind);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vessel_fuel_log to authenticated;

alter table public.vessel_fuel_log enable row level security;

create policy fleet_isolation_vessel_fuel_log on public.vessel_fuel_log
  as restrictive for all
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

create policy vessel_fuel_log_read on public.vessel_fuel_log for select
  using (exists (select 1 from app_users u
                  where u.id = auth.uid()
                    and u.role = any (array['skipper'::user_role,'viewer'::user_role])));

create policy vessel_fuel_log_write_ins on public.vessel_fuel_log for insert
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy vessel_fuel_log_write_upd on public.vessel_fuel_log for update
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role))
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy vessel_fuel_log_write_del on public.vessel_fuel_log for delete
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role));


-- ============================================================
-- su_settlements.fuel_used IS LITRES, NOT POUNDS
--
-- This had to be settled before anything on the page meant anything.
-- Across the twelve settlements that carry it, fuel_used averages 74%
-- of total_expenses (range 54–92%). Fuel is about HALF the expense
-- bill, so it cannot be a share of cost. And fuel_used ÷ days_at_sea
-- lands between 3,945 and 7,233, which is a working day's burn for
-- this boat. It is litres.
-- ============================================================


-- ============================================================
-- VERIFY
-- ============================================================
select kind, count(*) as entries, sum(litres) as total_l
  from public.vessel_fuel_log group by kind order by kind;
-- expect fuel 22 / 896378, lube_oil 9 / 3140, dirty_oil 2 / 4700, waste 1 / 3500

-- The loop, over the window the settlements cover.
with w as (select min(settling_date) f, max(settling_date) t,
                  sum(fuel_used) used, sum(days_at_sea) d
             from public.su_settlements where fuel_used is not null)
select w.f as from_date, w.t as to_date, w.used as settlement_litres,
       (select sum(litres) from public.vessel_fuel_log
         where kind='fuel' and entry_date between w.f and w.t) as log_bunkered,
       round((w.used / w.d)::numeric, 0) as avg_litres_per_day_at_sea
  from w;


-- ============================================================
-- WHAT THE LOOP SHOWS — the point of the exercise
--
--   08-01-2026 → 29-07-2026
--     settlements say used      1,093,158 L
--     this log says bunkered      821,432 L
--     gap                        -271,726 L
--
--   Some gap is expected: bunkered and used are different quantities,
--   fuel taken at the end of a period burns in the next, and tank
--   levels at each end are not recorded anywhere.
--
--   But 271,726 L is roughly 46 days of burn at 5,846 L/day — far more
--   than one bunkering's worth of timing slip. Something is wrong in
--   one of the three records:
--     · bunkerings missing from the Aegir log, or
--     · fuel_used on the settlements overstated or not purely litres, or
--     · fuel bought and burned that never reached either record.
--
--   That is the reconciliation this page exists to make visible. It is
--   not resolvable from the data alone — it needs the paper.
--
-- THE THIRD LEG IS STILL MISSING
--   su_worksheets and su_worksheet_lines are BOTH EMPTY (0 rows), so
--   "litres taken, where" from the Square Up worksheet cannot be
--   compared yet. That leg closes with the stage-2 worksheet rework.
-- ============================================================
