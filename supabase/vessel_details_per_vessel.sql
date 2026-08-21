-- VESSEL PARTICULARS, ONE ROW PER BOAT.
--
-- `vessel_details` had `fleet_id` as its primary key, so a pair team could
-- describe only ONE of its two boats — and four of the twelve fleets are pairs.
-- The name, registration, tonnage and dimensions of the second boat had nowhere
-- to live.
--
-- THIS IS THE DISRUPTIVE ONE, and it is done SECOND on purpose. All six readers
-- in the app called `.maybeSingle()`, which THROWS the moment a fleet has two
-- rows — so this migration on its own would have given a pair fleet six broken
-- pages rather than two boats. The current-vessel selection went in first so
-- every one of them has something to ask.
--
-- Nothing references vessel_details by foreign key — checked — so the key can
-- move without touching another table.

alter table public.vessel_details
  alter column vessel_id set not null;

-- (fleet_id, vessel_id): one set of particulars per boat, per fleet. A
-- composite natural key rather than a surrogate id, because nothing references
-- this table and a uuid nobody uses is another column to keep in step. It also
-- doubles as the uniqueness the upsert needs — the page now writes
-- `onConflict: 'fleet_id,vessel_id'`, and WITHOUT that a pair team's second
-- save would overwrite the first boat.
alter table public.vessel_details
  drop constraint if exists vessel_details_pkey;
alter table public.vessel_details
  add constraint vessel_details_pkey primary key (fleet_id, vessel_id);

comment on table public.vessel_details is
  'Vessel particulars, ONE ROW PER BOAT. Keyed (fleet_id, vessel_id) since Aug 2026 — it used to be one row per fleet, which left a pair team unable to describe its second boat. Readers must pick a vessel: see VesselContext and pickDetails().';

comment on column public.vessel_details.vessel_id is
  'Which boat these particulars describe. Required. The composite FK to vessels(id, fleet_id) keeps it inside the fleet.';

-- VERIFIED BY PROBE as a skipper of a pair fleet, inside an aborted
-- transaction:
--
--   a pair now holds 2 sets of particulars (was impossible before)
--   a second row for the same boat: refused
--   upsert on (fleet_id, vessel_id) updated in place, still 2 rows
--   particulars for another fleet's boat: refused by the composite FK
--   a row naming no boat: refused
--
-- THE SIX READERS, all changed from `.maybeSingle()` to reading the rows and
-- choosing with pickDetails():
--   VesselPlate.jsx (useVesselDetails), Dashboard, CrewList, VesselCerts,
--   EngineerHome, EngineLogs, VesselDetails.
--
-- pickDetails() returns NULL when a pair is showing ALL, deliberately. There is
-- no such thing as a pair's particulars: two boats have two registrations and
-- two tonnages, and picking one to stand for both would put the wrong PLN on a
-- FAL 5 crew list — a wrong official document, not a cosmetic slip.
