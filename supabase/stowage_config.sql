-- ============================================================
-- STOWAGE CONFIG — run once in the Supabase SQL editor.
-- One row per fleet: the vessel's species list + box weights,
-- held in `data` as JSON. These persist across every trip until
-- the skipper edits them. Fleet-scoped, skipper-only write.
-- Safe to re-run.
-- ============================================================

create table if not exists public.stowage_config (
  fleet_id    uuid primary key references public.fleets(id) default public.current_fleet_id(),
  data        jsonb not null default '{}'::jsonb,   -- { species: [{code,name,color,kg}] }
  updated_at  timestamptz default now()
);

do $$
declare t text := 'stowage_config';
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

  execute format('drop policy if exists %I on public.%I', 'fleet_isolation_' || t, t);
  execute format(
    'create policy %I on public.%I as restrictive for all to authenticated
       using (fleet_id = public.current_fleet_id())
       with check (fleet_id = public.current_fleet_id())',
    'fleet_isolation_' || t, t);
end $$;

select relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relkind = 'r' and rel.relname = 'stowage_config';
