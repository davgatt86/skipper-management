-- ============================================================
-- Rota: landings as the unit, teams, and mid-trip swaps.
--
-- Run in the Supabase SQL editor. Additive — no existing rota row
-- changes meaning, and the 29 existing trips keep working.
--
-- WHY
--   The rota was planned in DAYS and crewed per TRIP. David works
--   2 landings on, 2 landings off, in two rotating watches, and a
--   man can swap in the MIDDLE of a trip to cover a holiday. That
--   cannot be expressed by one crew list per trip.
--
--       Crew A   david/david     2/0
--       Crew B   barry/barry     2/2
--       Crew A   david/barry     3/3
--       Crew B   barry/david     4/4
--
--   Each row is a trip of two landings; each slot is one landing.
--   The right-hand column is the running landings tally per man.
--
-- NOTE ON THE TALLY
--   It cannot come from landing_crew. That table is populated only
--   for contracted agency crew because it drives the box bonus —
--   across 164 landings, David and Barry have none, and neither do
--   any of the self-employed rotation crew. So the rota records its
--   own per-landing crew, and the tally is counted from that.
-- ============================================================


-- ---- 1. Teams (watches) ---------------------------------------------
-- Fixed membership. A trip is assigned a team and inherits its men;
-- individual landings override where somebody swaps.
create table if not exists public.rota_teams (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  created_at timestamptz default now(),
  unique (fleet_id, name)
);

create table if not exists public.rota_team_members (
  team_id  uuid not null references public.rota_teams(id) on delete cascade,
  crew_id  uuid not null references public.crew(id) on delete cascade,
  fleet_id uuid not null default current_fleet_id(),
  primary key (team_id, crew_id)
);


-- ---- 2. Landings within a trip --------------------------------------
-- Normally two, but not fixed at two: a trip that runs one or three
-- has to be recordable.
--
-- landing_id links a planned landing to the real one once it happens,
-- so the plan can later be checked against what was actually landed.
-- Left null until then.
create table if not exists public.rota_trip_landings (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  trip_id      uuid not null references public.rota_trips(id) on delete cascade,
  seq          integer not null,
  planned_date date,
  landing_id   uuid references public.landings(id) on delete set null,
  created_at   timestamptz default now(),
  unique (trip_id, seq)
);


-- ---- 3. Who was on each landing -------------------------------------
-- This is where a mid-trip swap actually lives.
create table if not exists public.rota_landing_crew (
  rota_landing_id uuid not null references public.rota_trip_landings(id) on delete cascade,
  crew_id         uuid not null references public.crew(id) on delete cascade,
  fleet_id        uuid not null default current_fleet_id(),
  primary key (rota_landing_id, crew_id)
);


-- ---- 4. A trip knows whose watch it is ------------------------------
alter table public.rota_trips
  add column if not exists team_id uuid references public.rota_teams(id) on delete set null;


-- ---- 5. Grants -------------------------------------------------------
-- New tables need these or a new tenant gets permission errors.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.rota_teams          to authenticated;
grant select, insert, update, delete on public.rota_team_members   to authenticated;
grant select, insert, update, delete on public.rota_trip_landings  to authenticated;
grant select, insert, update, delete on public.rota_landing_crew   to authenticated;


-- ---- 6. RLS ----------------------------------------------------------
-- Same shape as rota_trips / rota_trip_crew: a permissive read for
-- skipper+viewer, permissive writes for skipper, and a RESTRICTIVE
-- fleet_isolation policy on top.
do $$
declare t text;
begin
  foreach t in array array['rota_teams','rota_team_members','rota_trip_landings','rota_landing_crew']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy %I on public.%I as restrictive for all
        using (fleet_id = current_fleet_id())
        with check (fleet_id = current_fleet_id())
    $f$, 'fleet_isolation_' || t, t);

    execute format($f$
      create policy %I on public.%I for select
        using (exists (select 1 from app_users u
                        where u.id = auth.uid()
                          and u.role = any (array['skipper'::user_role,'viewer'::user_role])))
    $f$, t || '_read', t);

    execute format($f$
      create policy %I on public.%I for insert
        with check (exists (select 1 from app_users u
                             where u.id = auth.uid() and u.role = 'skipper'::user_role))
    $f$, t || '_write_ins', t);

    execute format($f$
      create policy %I on public.%I for update
        using (exists (select 1 from app_users u
                        where u.id = auth.uid() and u.role = 'skipper'::user_role))
        with check (exists (select 1 from app_users u
                             where u.id = auth.uid() and u.role = 'skipper'::user_role))
    $f$, t || '_write_upd', t);

    execute format($f$
      create policy %I on public.%I for delete
        using (exists (select 1 from app_users u
                        where u.id = auth.uid() and u.role = 'skipper'::user_role))
    $f$, t || '_write_del', t);
  end loop;
end $$;


-- ---- 7. Crew A and Crew B -------------------------------------------
-- Seeded empty for Audacious only, because that is the setup David
-- described. Other fleets create their own on the page.
insert into public.rota_teams (fleet_id, name, sort)
select f.id, x.name, x.sort
  from public.fleets f
  cross join (values ('Crew A', 10), ('Crew B', 20)) as x(name, sort)
 where f.name = 'AUDACIOUS BF83'
on conflict (fleet_id, name) do nothing;


-- ============================================================
-- NOT DONE, deliberately
--   The 29 existing trips are left alone. They have crew in
--   rota_trip_crew but no landings, and we do not know how many
--   landings each actually ran — inventing two per trip would be
--   making up history. The page treats trip crew as the default and
--   per-landing crew as the override, so old trips keep reading the
--   way they always did.
-- ============================================================


-- ============================================================
-- VERIFY
-- ============================================================
select tablename, policyname, permissive
  from pg_policies
 where schemaname='public'
   and tablename in ('rota_teams','rota_team_members','rota_trip_landings','rota_landing_crew')
 order by tablename, policyname;   -- expect 5 policies each, 20 rows

select name, sort from public.rota_teams order by sort;   -- expect Crew A, Crew B


-- ============================================================
-- ROLLBACK
--   alter table public.rota_trips drop column if exists team_id;
--   drop table if exists public.rota_landing_crew;
--   drop table if exists public.rota_trip_landings;
--   drop table if exists public.rota_team_members;
--   drop table if exists public.rota_teams;
-- ============================================================
