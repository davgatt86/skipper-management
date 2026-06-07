-- ============================================================
-- TRIP / CREW ROTA PLANNER — run once in Supabase SQL editor
-- Planned trip periods on a calendar + crew per trip + crew
-- holidays. Skippers edit; viewers (e.g. office) can read.
-- Fleet-scoped like everything else. Safe to re-run.
-- ============================================================

create table if not exists public.rota_trips (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null references public.fleets(id) default public.current_fleet_id(),
  start_date date not null,
  end_date   date not null,
  colour     int  not null default 0,      -- index into the app palette
  label      text default '',
  created_at timestamptz default now(),
  check (end_date >= start_date)
);
create index if not exists rota_trips_fleet_idx on public.rota_trips (fleet_id);
create index if not exists rota_trips_start_idx on public.rota_trips (start_date);

create table if not exists public.rota_trip_crew (
  trip_id  uuid not null references public.rota_trips(id) on delete cascade,
  crew_id  uuid not null references public.crew(id) on delete cascade,
  fleet_id uuid not null references public.fleets(id) default public.current_fleet_id(),
  primary key (trip_id, crew_id)
);
create index if not exists rota_trip_crew_fleet_idx on public.rota_trip_crew (fleet_id);

create table if not exists public.rota_holidays (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null references public.fleets(id) default public.current_fleet_id(),
  crew_id    uuid not null references public.crew(id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  note       text default '',
  created_at timestamptz default now(),
  check (end_date >= start_date)
);
create index if not exists rota_holidays_fleet_idx on public.rota_holidays (fleet_id);
create index if not exists rota_holidays_crew_idx on public.rota_holidays (crew_id);

-- RLS: skipper + viewer read, skipper-only write, fleet isolation on top
do $$
declare t text;
begin
  foreach t in array array['rota_trips','rota_trip_crew','rota_holidays']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role in (''skipper'',''viewer'')))',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_write_ins', t);
    execute format(
      'create policy %I on public.%I for insert
         with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_write_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_write_upd', t);
    execute format(
      'create policy %I on public.%I for update
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))
         with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_write_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_write_del', t);
    execute format(
      'create policy %I on public.%I for delete
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_write_del', t);

    execute format('drop policy if exists %I on public.%I', 'fleet_isolation_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (fleet_id = public.current_fleet_id())
         with check (fleet_id = public.current_fleet_id())',
      'fleet_isolation_' || t, t);
  end loop;
end $$;

select relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relkind = 'r' and rel.relname like 'rota_%';
