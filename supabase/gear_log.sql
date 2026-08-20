-- THE GEAR LOG — what was done to the nets, and when.
--
-- The third book the boat keeps and the app did not. Trawl gear is maintained
-- continuously and nothing recorded it, so "when did we last renew the codend"
-- was answered from memory.
--
-- THE UNIT IS THE NET, NOT THE BOAT (David, Aug 2026). Nets are named — Port
-- net, Starboard twin, Pair hopper, Pair discer — and each carries its own
-- ground gear, headline, bridles and legs. A pair team tows one net between
-- two boats, but BOTH boats carry nets, so a pair typically has FOUR aboard,
-- two per boat, and maintenance is done on each boat separately. Nothing is
-- shared. One boat shoots the net and bridles; the other comes alongside and
-- attaches to his partner's net with his own rope.
--
-- So `vessel_id` is REQUIRED here, not nullable-and-backfilled-later like the
-- eighteen tables that took it in the vessels stage-1 migration.
--
-- A COMPONENT IS A THING WITH A LIFE, NOT AN EVENT IN A STREAM.
--
-- "Add new ground gear to a net" and "retire a set of ground gear" are David's
-- own words, and they describe an object being fitted and removed — so a set of
-- ground gear is a ROW with a fitted date and a removed date, not two entries
-- in a log that some later query has to pair up. Its life is then
-- `removed_on - fitted_on`, read straight off, rather than inferred from a
-- stream of events that may be missing one end.
--
-- A RENEWAL is therefore: close the fitted component, open a new one.
-- A MEASUREMENT is an event ON a component, and its value is the SERIES — the
-- same headline measured over a year is how wear is seen coming, which a single
-- latest reading cannot show.

-- ------------------------------------------------------------------- nets
create table if not exists public.gear_nets (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  -- Required. A net belongs to one boat and is never shared, even in a pair.
  -- Composite FK, not a plain one: fleet_isolation checks only fleet_id, which
  -- left vessel_id free to point at ANOTHER fleet's boat. Found by probe.
  -- Needs unique (id, fleet_id) on vessels, added just below.
  --
  -- The other eighteen tables carrying vessel_id have the same hole. Out of
  -- scope here, but worth knowing before the vessels stage-2 work.
  vessel_id   uuid not null,
  name        text not null,              -- 'Port net', 'Pair hopper', 'Pair discer'
  -- The fallback clock. A part that has never been measured reports its age
  -- from the day the net came aboard, which is a different fact from "measured
  -- N days ago" and the page says so rather than showing a bare number.
  came_aboard date,
  retired_on  date,                       -- kept, not deleted: the history is the point
  notes       text,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.vessels drop constraint if exists vessels_id_fleet_uniq;
alter table public.vessels add constraint vessels_id_fleet_uniq unique (id, fleet_id);
alter table public.gear_nets drop constraint if exists gear_nets_vessel_same_fleet;
alter table public.gear_nets add constraint gear_nets_vessel_same_fleet
  foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id);

create index if not exists gear_nets_fleet on public.gear_nets (fleet_id, vessel_id, sort);

-- ------------------------------------------------------- the parts vocabulary
-- Only what a fleet ADDS, RENAMES or RETIRES. The shipped list lives in code
-- (src/lib/gear/parts.js) and resolveParts() merges the two — the same shape as
-- the market rules and the stores catalogue, and for the same reason: seed five
-- rows per fleet instead and a later correction reaches nobody.
--
-- A pair trawl and a single rig differ, so this must not be a closed list.
create table if not exists public.gear_parts (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  part_key    text not null,
  label       text,
  sort        int,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fleet_id, part_key)
);

-- ------------------------------------------------------------- components
-- One physical set fitted to one net. This is the row whose life the stats are
-- built from.
create table if not exists public.gear_components (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  net_id      uuid not null references public.gear_nets(id) on delete cascade,
  part_key    text not null,
  fitted_on   date,
  removed_on  date,                       -- null = still on the net
  -- Often unknown, and that is fine. A cost nobody has is better left null than
  -- guessed at — this would be the first real per-vessel cost in the database.
  cost        numeric,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint gear_components_dates check (removed_on is null or fitted_on is null or removed_on >= fitted_on)
);
create index if not exists gear_components_net on public.gear_components (net_id, part_key, fitted_on);

-- A net cannot carry two headlines at once. Partial, so the retired ones may
-- pile up as deep as the history goes.
create unique index if not exists gear_components_one_fitted
  on public.gear_components (net_id, part_key) where removed_on is null;

-- ----------------------------------------------------------- measurements
-- An event on a component. A renewal is NOT here — that is closing one
-- component and opening the next.
create table if not exists public.gear_measurements (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  component_id  uuid not null references public.gear_components(id) on delete cascade,
  kind          text not null default 'measured'
                check (kind in ('measured', 'inspected', 'repaired')),
  done_on       date not null,
  -- AS ENTERED, so it reads back the way it was written: 5 ft 6 in is stored
  -- as 5.5 with unit 'ft_in' and shown as 5' 6".
  value         numeric,
  unit          text check (unit is null or unit in ('fathom', 'ft_in', 'm')),
  -- AND CANONICAL. A series where one reading is in fathoms and the next in
  -- metres is unreadable, so every measurement also carries millimetres. Two
  -- columns because neither alone does the job: one is what the man wrote, the
  -- other is what can be compared.
  value_mm      numeric,
  notes         text,
  logged_by     uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists gear_measurements_component
  on public.gear_measurements (component_id, done_on desc);

-- --------------------------------------------------------------------- RLS
-- fleet_isolation FIRST on every one of them. The permissive policies in this
-- database carry no fleet check of their own, so without this a table is open
-- to every tenant from the moment it exists.
do $$
declare t text;
begin
  foreach t in array array['gear_nets','gear_parts','gear_components','gear_measurements'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists fleet_isolation on public.%I', t);
    execute format(
      'create policy fleet_isolation on public.%I as restrictive for all to authenticated
         using (fleet_id = (select public.current_fleet_id()))
         with check (fleet_id = (select public.current_fleet_id()))', t);

    execute format('drop policy if exists gear_read on public.%I', t);
    execute format('create policy gear_read on public.%I for select to authenticated using (true)', t);

    -- The skipper and the officer. Gear is deck work and a mate is an officer;
    -- the same men who keep the engine and garbage books keep this one.
    -- 'engineer' is the legacy value for officer and still honoured.
    execute format('drop policy if exists gear_write on public.%I', t);
    execute format(
      'create policy gear_write on public.%I for all to authenticated
         using (exists (select 1 from public.app_users u
                         where u.id = (select auth.uid())
                           and u.role in (''skipper'', ''officer'', ''engineer'')))
         with check (exists (select 1 from public.app_users u
                              where u.id = (select auth.uid())
                                and u.role in (''skipper'', ''officer'', ''engineer'')))', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant usage on schema public to authenticated;


-- ------------------------------------------------------- trips, not just days
-- How many trips a vessel made between two dates.
--
-- SECURITY DEFINER FOR A REASON. `quota_trips` is NOT in the officer allow-list
-- — he is denied it like every other table outside that list — so an officer
-- reading it directly gets zero rows, and "0 trips" looks exactly like "no
-- trips" rather than like a permission wall. The man keeping the gear log would
-- have been the one person unable to see the trip count in it.
--
-- Same shape and same argument as crew_aboard_count(): hand out the number, not
-- the table. Scoped to the caller's own fleet, so it cannot be used to count
-- another business's trips.
create or replace function public.gear_trips_between(
  p_vessel_id uuid, p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
    from public.quota_trips t
   where t.fleet_id = (select public.current_fleet_id())
     and t.vessel_id = p_vessel_id
     and t.arrival_at is not null
     and t.arrival_at::date >= p_from
     and t.arrival_at::date <= coalesce(p_to, current_date)
$$;

comment on function public.gear_trips_between(uuid, date, date) is
  'Trips a vessel completed between two dates, for the gear log''s "days and trips since" figures. SECURITY DEFINER so an officer gets the count without being granted quota_trips, which he is denied along with every other table outside his allow-list.';

grant execute on function public.gear_trips_between(uuid, date, date) to authenticated;

-- And the whole list of dates, for counting many windows at once.
--
-- STAGE 2 (Aug 2026). The matrix asked the database once per CELL, which is
-- nets x parts round trips for one screen; the life figures need a count per
-- renewal interval as well, so that approach multiplies again for no reason.
-- Fetch the dates once and count client-side instead, which also makes the
-- window arithmetic a pure function — testable without a database, and "trips
-- between two dates" is exactly the off-by-one a unit test catches and an
-- integration test hides.
--
-- DATES ONLY: no tonnage, no ports, no captain, no trip numbers. The minimum
-- that answers the question.
create or replace function public.gear_trip_dates(p_vessel_id uuid)
returns setof date
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.arrival_at::date
    from public.quota_trips t
   where t.fleet_id = (select public.current_fleet_id())
     and t.vessel_id = p_vessel_id
     and t.arrival_at is not null
   order by 1
$$;

comment on function public.gear_trip_dates(uuid) is
  'Arrival dates of a vessel''s trips, for counting trips between gear renewals. Dates only, scoped to the caller''s fleet. SECURITY DEFINER so an officer gets them without being granted quota_trips.';

grant execute on function public.gear_trip_dates(uuid) to authenticated;

-- ------------------------------------------------------ which grounds (stage 3)
-- "Some areas fished are more abrasive on gear" (David, Aug 2026) — measurable
-- rather than an impression, because quota_trip_catches has carried fao_area
-- and eez off the logbook since Oct 2022.
--
-- AREA, NOT RECTANGLE. David's call, and the data agrees: 17 area+EEZ
-- combinations against 129 statistical rectangles. At the number of renewals a
-- boat actually logs, rectangles divide the evidence into slivers.
--
-- The EEZ is part of the ground's identity. Audacious fished 27.4.a for 573
-- days inside GBR waters and 325 inside NOR, and those are different grounds to
-- the man towing over them — "iva (GBR), iva (NOR)".
--
-- DISTINCT DAY + GROUND and nothing else: no species, no kilos, no rectangle.
-- A day worked over two grounds appears twice, once for each, which is right
-- for attributing wear and is why the client counts day-ground PAIRS.
create or replace function public.gear_ground_days(p_vessel_id uuid)
returns table (day date, fao_area text, eez text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct c.catch_date, c.fao_area, c.eez
    from public.quota_trip_catches c
    join public.quota_trips t on t.id = c.trip_id
   where c.fleet_id = (select public.current_fleet_id())
     and t.vessel_id = p_vessel_id
     and c.catch_date is not null
     and c.fao_area is not null
   order by 1
$$;

comment on function public.gear_ground_days(uuid) is
  'Distinct day + FAO area + EEZ for a vessel''s catches, for attributing gear wear to the grounds it was worked over. No species or weights. SECURITY DEFINER so an officer gets it without being granted quota_trip_catches.';

grant execute on function public.gear_ground_days(uuid) to authenticated;

-- ------------------------------------------------------------------- after
-- RE-RUN BOTH ALLOW-LIST FILES AFTER THIS:
--   supabase/officer_role.sql   -- adds these four to his list, and 2b clears
--                                  the denial they were given while outside it
--   supabase/cook_role.sql      -- denies the cook, who has no business here
-- The deny loop in each only touches tables OUTSIDE its own list, so a table
-- that has just JOINED one keeps its old denial until 2b runs. That is the
-- order-of-operations that shut officers out of crew certs once already.

-- ------------------------------------------- a renewal is ONE write (Aug 2026)
-- It was two: the client closed the fitted component, then inserted the new
-- one. Two independent items in the offline outbox, replayed separately — so
-- when the close did not land, the insert still ran and hit
-- `gear_components_one_fitted` with a duplicate-key error that says nothing
-- about what actually went wrong. Reported by David on Single Net's codend,
-- which was left with the old set still open.
--
-- Fixing it in the client would mean keeping two queue items in step forever.
-- Fixing it here makes the invariant impossible to break: fitting a set CLOSES
-- whatever was on, in the same statement and the same transaction. The client
-- sends one insert, which is one outbox item, which lands whole or not at all.
create or replace function public.gear_close_previous()
returns trigger
language plpgsql
as $$
declare
  prev record;
begin
  select * into prev
    from public.gear_components
   where net_id = new.net_id
     and part_key = new.part_key
     and removed_on is null
     and id <> new.id
   limit 1;

  if not found then
    return new;
  end if;

  -- Without a date there is nothing to close the old set with, and guessing
  -- would invent a life. Say so plainly instead of failing on the index.
  if new.fitted_on is null then
    raise exception 'Give the date this % was fitted — there is a set on since %, and it has to be closed on the day the new one went on.',
      replace(new.part_key, '_', ' '), to_char(prev.fitted_on, 'DD-MM-YYYY')
      using errcode = 'check_violation';
  end if;

  -- Fitting something dated before the set it replaces is a typo, not history.
  if prev.fitted_on is not null and new.fitted_on < prev.fitted_on then
    raise exception 'That % was fitted on %, so a replacement cannot be dated % — check the date.',
      replace(new.part_key, '_', ' '),
      to_char(prev.fitted_on, 'DD-MM-YYYY'), to_char(new.fitted_on, 'DD-MM-YYYY')
      using errcode = 'check_violation';
  end if;

  update public.gear_components
     set removed_on = new.fitted_on, updated_at = now()
   where id = prev.id;

  return new;
end $$;

comment on function public.gear_close_previous() is
  'Fitting a set of gear closes whatever was on that net for the same part, in the same transaction. A renewal is one operation, so it is one write — splitting it left the offline outbox able to land the insert without the close.';

drop trigger if exists gear_components_close_previous on public.gear_components;
create trigger gear_components_close_previous
  before insert on public.gear_components
  for each row execute function public.gear_close_previous();
