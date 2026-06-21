-- ============================================================
-- Vessel details + voyage crew lists.
--
-- Run once in the Supabase SQL editor. Access model mirrors the
-- quota / crew_certificates tables: skipper-only writes + a
-- restrictive fleet-isolation policy on current_fleet_id().
--
--   * crew (extra columns)  — passport country/expiry + nationality
--                             (passport_number + emergency_contact already exist)
--   * vessel_details        — one row per fleet, the constants that
--                             auto-fill every crew list
--   * crew_lists            — one saved record per voyage/departure
--   * crew_list_members     — a frozen snapshot of who was aboard,
--                             with passport details as they stood that day
-- ============================================================

-- ------------------------------------------------------------
-- 1. Crew — extra identity columns for the crew list
-- ------------------------------------------------------------
alter table public.crew add column if not exists nationality      text;
alter table public.crew add column if not exists passport_country text;
alter table public.crew add column if not exists passport_expiry  date;

-- ------------------------------------------------------------
-- 2. Vessel details — one row per fleet (the skipper's own page)
-- ------------------------------------------------------------
create table if not exists public.vessel_details (
  fleet_id      uuid primary key references public.fleets(id) on delete cascade default public.current_fleet_id(),
  vessel_name   text,
  pln           text,          -- port letters & number, e.g. BF83
  call_sign     text,
  mmsi          text,
  home_port     text,
  owner         text,
  skipper_name  text,
  length_m      numeric,
  gross_tonnage numeric,
  updated_at    timestamptz default now()
);

grant select, insert, update, delete on public.vessel_details to authenticated;
alter table public.vessel_details enable row level security;

drop policy if exists vessel_details_skipper on public.vessel_details;
create policy vessel_details_skipper on public.vessel_details for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_vessel_details on public.vessel_details;
create policy fleet_isolation_vessel_details on public.vessel_details as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- ------------------------------------------------------------
-- 3. Crew lists — one saved record per voyage
-- ------------------------------------------------------------
create table if not exists public.crew_lists (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.fleets(id) on delete cascade default public.current_fleet_id(),
  departure_date date,
  departure_port text,
  last_port      text,
  next_port      text,
  notes          text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists crew_lists_fleet_idx on public.crew_lists (fleet_id, departure_date desc);

grant select, insert, update, delete on public.crew_lists to authenticated;
alter table public.crew_lists enable row level security;

drop policy if exists crew_lists_skipper on public.crew_lists;
create policy crew_lists_skipper on public.crew_lists for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_crew_lists on public.crew_lists;
create policy fleet_isolation_crew_lists on public.crew_lists as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- ------------------------------------------------------------
-- 4. Crew list members — frozen snapshot of who was aboard
--    (copied at save time so a filed list never changes later)
-- ------------------------------------------------------------
create table if not exists public.crew_list_members (
  id               uuid primary key default gen_random_uuid(),
  crew_list_id     uuid not null references public.crew_lists(id) on delete cascade,
  fleet_id         uuid not null references public.fleets(id) on delete cascade default public.current_fleet_id(),
  crew_id          uuid references public.crew(id) on delete set null,  -- null for hand-added (e.g. the skipper)
  position         int  default 0,
  full_name        text,
  rank             text,          -- Skipper / Mate / Engineer / Deckhand …
  nationality      text,
  date_of_birth    date,
  passport_number  text,
  passport_country text,
  passport_expiry  date,
  created_at       timestamptz default now()
);
create index if not exists crew_list_members_list_idx on public.crew_list_members (crew_list_id, position);

grant select, insert, update, delete on public.crew_list_members to authenticated;
alter table public.crew_list_members enable row level security;

drop policy if exists crew_list_members_skipper on public.crew_list_members;
create policy crew_list_members_skipper on public.crew_list_members for all
  using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists fleet_isolation_crew_list_members on public.crew_list_members;
create policy fleet_isolation_crew_list_members on public.crew_list_members as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());
