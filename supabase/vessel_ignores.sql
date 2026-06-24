-- ============================================================
-- VESSEL IGNORES — run once in Supabase SQL editor
-- Skipper hides vessels (static-gear, pelagic, anything not
-- relevant to the whitefish market) from the forecast. Matching
-- is by normalised vessel name, so once hidden a boat stays
-- hidden on every future departure. Fleet-wide effect, skipper-
-- only control. Idempotent.
-- ============================================================

create table if not exists public.vessel_ignores (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) default public.current_fleet_id(),
  vessel_name text not null,            -- as displayed
  vessel_key  text not null,            -- upper(trim) for matching/dedup
  reason      text,                     -- optional note e.g. 'pelagic' / 'static gear'
  created_at  timestamptz default now()
);
create index if not exists vessel_ignores_fleet_idx on public.vessel_ignores (fleet_id);
create unique index if not exists vessel_ignores_dedup on public.vessel_ignores (fleet_id, vessel_key);

do $$
declare t text := 'vessel_ignores';
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

select 'vessel_ignores ready' as status;
