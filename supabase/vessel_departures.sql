-- ============================================================
-- VESSEL DEPARTURES — run once in Supabase SQL editor
-- Backs the Peterhead Market Forecast page. Each row is a boat
-- sailing from a port; the page projects landings at +7/+8/+9
-- days (a ~8-day trip) to forecast how many boats are likely to
-- land on the auction on a given day.
-- Fleet-scoped + skipper-only write, like the rest of the app.
-- Safe to re-run (idempotent).
-- ============================================================

create table if not exists public.vessel_departures (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.fleets(id) default public.current_fleet_id(),
  vessel_name    text not null,
  departure_port text default 'Peterhead',
  departure_date date not null,                 -- the day she sailed (drives the +7/+8/+9 projection)
  departed_at    timestamptz,                   -- optional precise time (from AIS later)
  source         text not null default 'manual' check (source in ('manual','marinetraffic','ais')),
  created_at     timestamptz default now()
);
create index if not exists vessel_departures_fleet_idx on public.vessel_departures (fleet_id);
create index if not exists vessel_departures_date_idx  on public.vessel_departures (departure_date);

-- Avoid duplicate auto-ingested rows for the same boat + day.
create unique index if not exists vessel_departures_dedup
  on public.vessel_departures (fleet_id, vessel_name, departure_date);

-- RLS: skipper + viewer read, skipper-only write, fleet isolation on top.
do $$
declare t text := 'vessel_departures';
begin
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
end $$;

select relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relkind = 'r' and rel.relname = 'vessel_departures';
