-- hidden_vessels.sql — ALREADY APPLIED to the live database (kept here for your records).
-- Per-fleet permanently-hidden vessels for the market forecast. Hiding a vessel
-- keeps it off the forecast even when the AIS importer re-adds it.
create table if not exists public.hidden_vessels (
  fleet_id uuid not null references public.fleets(id) default public.current_fleet_id(),
  vessel_name text not null,
  created_at timestamptz default now(),
  primary key (fleet_id, vessel_name)
);
-- RLS (applied live): skipper/viewer read own fleet; skipper insert+delete own fleet; fleet-isolated.
