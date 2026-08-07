-- ============================================================
-- Three things, applied and verified Aug 2026:
--   1. a supplier lookup for the fuel log
--   2. a storage bucket for vessel certificate documents
--   3. a daily cron for the expiry alerts
-- ============================================================


-- ---- 1. Fuel suppliers ----------------------------------------------
-- Seven spellings of one firm made "who do we buy most fuel from"
-- unanswerable. Suppliers are now picked from a list, not typed — the
-- same lesson as crew_ranks. `kind` separates fuel merchants from
-- disposal contractors, since one column on the log serves both
-- directions.
create table if not exists public.fuel_suppliers (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  name       text not null,
  kind       text not null default 'supplier' check (kind in ('supplier','contractor')),
  aliases    text[],
  created_at timestamptz default now()
);
create unique index if not exists fuel_suppliers_unique
  on public.fuel_suppliers (fleet_id, lower(name));

alter table public.vessel_fuel_log
  add column if not exists supplier_id uuid references public.fuel_suppliers(id) on delete set null;

-- RLS and grants follow the same shape as the rest of the vessel tables:
-- read for skipper+viewer, writes for skipper, restrictive fleet isolation.
-- (Applied in the migration of the same name.)

-- Canonical names were taken from the FULLEST rendering that appears in the
-- log, and every variant kept in `aliases` so the tidy-up is auditable and
-- nothing is lost:
--   John A Smith & Sons  ← Smith · Smith's · Smith & Sons · Smith & sons
--                          Smiths &sons · Smith's & Sons · John a smith &sons
--                          · Smiths
-- If David would rather it read differently, it is one UPDATE on the name.
--
-- Result: 14 distinct fuel counterparties collapsed to 8, nothing unlinked,
-- and John A Smith & Sons resolves to 12 entries / 558,938 L — about 68% of
-- all fuel bunkered, which is the question that could not be answered before.

-- Grade spellings fixed at the same time: "Maropa 150" → "Meropa 150" (the
-- same Texaco gear oil typed two ways on the same day), and MGO/MDO to their
-- usual capitals.


-- ---- 2. Vessel certificate documents ---------------------------------
-- Path is {fleet_id}/{timestamp}-{filename}, so folder 1 is the fleet.
insert into storage.buckets (id, name, public)
values ('vessel-certs', 'vessel-certs', false)
on conflict (id) do nothing;

-- The object column is written as storage.objects.name throughout. It sits at
-- the top level here, so a bare `name` would bind correctly — but the su_docs
-- bug came from exactly this shape drifting into a subquery where su_boats
-- shadowed it. Qualify it always.
--   read   → own fleet, skipper or viewer
--   write  → own fleet, skipper only
-- (Policies applied in the migration of the same name.)


-- ---- 3. Daily expiry check -------------------------------------------
create extension if not exists pg_cron with schema cron;

-- generate_compliance_alerts() is SECURITY DEFINER and takes fleet_id from
-- each source row rather than current_fleet_id(), so it runs correctly with
-- no user session and covers EVERY fleet — not just whoever last logged in.
-- 06:00 UTC, and idempotent, so a missed or repeated run costs nothing.
select cron.schedule(
  'compliance-alerts-daily',
  '0 6 * * *',
  $$select public.generate_compliance_alerts(60);$$
);


-- ============================================================
-- VERIFY
-- ============================================================
select counterparty, count(*) n, sum(litres) l,
       count(*) filter (where supplier_id is null) as unlinked
  from public.vessel_fuel_log where kind='fuel'
 group by counterparty order by l desc;   -- 8 rows, unlinked all 0

select jobname, schedule, active from cron.job;   -- compliance-alerts-daily, 0 6 * * *

select id, public from storage.buckets where id = 'vessel-certs';   -- private
