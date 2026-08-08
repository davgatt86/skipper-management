-- ============================================================
-- Vessels — stage 1: schema, seed and backfill.
-- Applied and verified Aug 2026.
--
-- DELIBERATELY ADDITIVE. Nothing reads vessel_id yet and every column is
-- nullable, so no existing query or page changes behaviour. The cutover
-- (pages reading vessel_id, vessel_details moving off its fleet_id primary
-- key) is stage 2 and should be done page by page.
-- ============================================================

create table if not exists public.vessels (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null references public.fleets(id) on delete cascade,
  name       text not null,          -- 'AUDACIOUS'
  pln        text,                   -- 'BF83'
  label      text not null,          -- 'AUDACIOUS BF83'
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz default now()
);

-- `label` is the join key: it matches sales_landings.vessel exactly, which is
-- what makes the backfill a real join rather than a guess, and lets the old
-- text column keep working untouched.
create unique index if not exists vessels_fleet_label_uniq on public.vessels (fleet_id, lower(label));
create index if not exists vessels_fleet_idx on public.vessels (fleet_id);

-- RLS: the standard shape — read for skipper+viewer, writes for skipper,
-- restrictive fleet isolation on top. (Policies applied in the migration.)


-- ---- Seed ------------------------------------------------------------
-- Two sources unioned: the FLEET NAME (which encodes NAME REG, and both
-- sides of a pair around " + " or " & ") and the distinct
-- sales_landings.vessel labels actually seen. Only Audacious had a populated
-- vessel_details row, so the fleet name is the only source covering every
-- fleet. HANSTHOLM and TEST FLEET are excluded — neither is a vessel.
--
-- Result: 16 vessels across 12 fleets, name and PLN split correctly,
-- including OUR LASS WY241 & VICTORY ROSE WY34, which has no landings at all
-- but got both boats from its name.


-- ---- vessel_id columns ------------------------------------------------
-- Added ONLY to tables that are genuinely per-vessel:
--   sales_landings · landings · crew · crew_lists · rota_trips
--   quota_snapshots · quota_trips · quota_manual_stocks
--   vessel_details · vessel_certificates · vessel_fuel_log
--   engine_logs · garbage_log · stowage_plans · stowage_config
--   vessel_departures
--
-- Fleet-level tables deliberately do NOT get one — settings, alerts,
-- alert_settings, sales_buyer_flags, fuel_suppliers, app_users,
-- ingest_senders. A vessel column on those would be a lie.


-- ---- Backfill ---------------------------------------------------------
-- 1. sales_landings by exact label match: 316 of 316 filled.
-- 2. Everything else: where a fleet has exactly ONE vessel there is nothing
--    to decide, so every row is filled. Where a fleet has TWO the row is left
--    NULL on purpose — which boat a crewman, trip or quota line belongs to is
--    not knowable from the data, and guessing would put a man on the wrong
--    boat or split a quota wrongly.
--
-- Use (array_agg(id))[1], not min(id): there is no min() for uuid.


-- ============================================================
-- VERIFY
-- ============================================================
select f.name as fleet, v.label, v.name, v.pln
  from public.vessels v join public.fleets f on f.id = v.fleet_id
 order by f.name, v.sort;   -- expect 16 rows

select 'sales_landings' t, count(*) rows, count(vessel_id) filled from public.sales_landings
union all select 'crew', count(*), count(vessel_id) from public.crew
union all select 'quota_trips', count(*), count(vessel_id) from public.quota_trips
union all select 'vessel_fuel_log', count(*), count(vessel_id) from public.vessel_fuel_log;

-- Rows a pair fleet cannot have filled automatically — these need the skipper:
select 'crew' t, count(*) from public.crew c
  where c.vessel_id is null and (select count(*) from public.vessels v where v.fleet_id = c.fleet_id) > 1;


-- ============================================================
-- STAGE 2, NOT DONE
--   · pages read vessel_id instead of matching on the vessel text
--   · vessel_details moves off fleet_id as its primary key to one row per
--     vessel — that is the disruptive one and wants doing on its own
--   · a vessel picker on crew, quota and rota the way Fish Sales has one
--   · pair fleets assign their NULL rows: crew to a boat, rota trips to a
--     boat, quota per boat
-- ============================================================
