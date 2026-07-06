-- ============================================================
-- STOWAGE PLANS — run once in the Supabase SQL editor.
-- One row per trip: the whole fishroom stowage document
-- (box grid, per-species box weights, trip details, stowage
-- record, haul totals, temp log, sign-off) is held in `data`
-- as JSON, so the page can evolve without schema changes.
-- Fleet-scoped + skipper-only write, like the rest of the app.
-- Safe to re-run (idempotent).
-- ============================================================

create table if not exists public.stowage_plans (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) default public.current_fleet_id(),
  trip_no     text not null,
  vessel      text default 'AUDACIOUS BF83',
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists stowage_plans_fleet_idx on public.stowage_plans (fleet_id);

-- One plan per trip number within a fleet.
create unique index if not exists stowage_plans_trip_uniq
  on public.stowage_plans (fleet_id, trip_no);

-- RLS: skipper + viewer read, skipper-only write, fleet isolation on top.
do $$
declare t text := 'stowage_plans';
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
where ns.nspname = 'public' and rel.relkind = 'r' and rel.relname = 'stowage_plans';
