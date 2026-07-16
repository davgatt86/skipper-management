-- ============================================================
-- Engine logs — a parameterised engine-room logbook per vessel/fleet.
--
-- Modelled directly on Ægir's Engine Log: each entry is a dated set of
-- readings grouped by equipment (Main Engine, Generators, Gearboxes),
-- with the running-hours reading, who logged it, and an optional edit
-- reason. Readings are stored as jsonb so the parameter list can be
-- adjusted/extended (Ægir's "Adjust Parameters" / "Add Custom Parameter")
-- without a schema migration.
--
-- Run once in the Supabase SQL editor. Access model mirrors
-- crew_certificates / vessel_details: skipper-only writes + a
-- restrictive fleet-isolation policy on current_fleet_id().
-- ============================================================

create table if not exists public.engine_logs (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.fleets(id) on delete cascade default public.current_fleet_id(),
  log_date       date not null default current_date,
  running_hours  numeric,          -- main-engine running-hours reading (headline figure)
  -- readings: { "Main Engine 1": { "RPM": 880, "Charge Air Pressure": 1.8, ... },
  --             "Generator 1": { ... }, "Gearbox 1": { ... } }
  readings       jsonb not null default '{}'::jsonb,
  notes          text default '',
  logged_by      text,             -- name of the crewman who recorded it
  edited_at      timestamptz,      -- set when an entry is later corrected
  edit_reason    text,             -- why it was edited (Ægir shows this on the card)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists engine_logs_fleet_idx on public.engine_logs (fleet_id, log_date desc);

grant select, insert, update, delete on public.engine_logs to authenticated;

-- ------------------------------------------------------------
-- RLS — skipper-only writes, plus restrictive fleet isolation
-- ------------------------------------------------------------
alter table public.engine_logs enable row level security;

drop policy if exists engine_logs_skipper on public.engine_logs;
create policy engine_logs_skipper on public.engine_logs for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_engine_logs on public.engine_logs;
create policy fleet_isolation_engine_logs on public.engine_logs as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- ------------------------------------------------------------
-- Verify
-- ------------------------------------------------------------
select 'table' as what, 'engine_logs' as detail;
