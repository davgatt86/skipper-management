-- ============================================================
-- MULTI-TENANCY MIGRATION — run once in Supabase SQL editor
-- Adds fleet_id scoping to every tenant table.
-- Existing policies are NOT touched: new RESTRICTIVE policies
-- are layered on top, so current viewer/crew/skipper access is
-- unchanged while only one fleet exists.
-- Safe to re-run (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fleets table + seed The Don Fishing Co. Ltd
--    (fixed UUID so re-runs and admin SQL can reference it)
-- ------------------------------------------------------------
create table if not exists public.fleets (
  id         uuid primary key,
  name       text not null,
  created_at timestamptz default now()
);

insert into public.fleets (id, name)
values ('00000000-0000-4000-8000-000000000001', 'The Don Fishing Co. Ltd')
on conflict (id) do nothing;

alter table public.fleets enable row level security;

-- ------------------------------------------------------------
-- 2. Anchor: app_users.fleet_id
-- ------------------------------------------------------------
alter table public.app_users add column if not exists fleet_id uuid references public.fleets(id);

update public.app_users
set fleet_id = '00000000-0000-4000-8000-000000000001'
where fleet_id is null;

alter table public.app_users alter column fleet_id set not null;

-- ------------------------------------------------------------
-- 3. Helper: which fleet does the logged-in user belong to?
--    security definer = reads app_users without RLS recursion
--    (same pattern as the existing role helpers)
-- ------------------------------------------------------------
create or replace function public.current_fleet_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select fleet_id from public.app_users where id = auth.uid()
$$;

revoke all on function public.current_fleet_id() from anon;
grant execute on function public.current_fleet_id() to authenticated;

-- Members can read their own fleet's row (name etc.)
drop policy if exists fleets_member_read on public.fleets;
create policy fleets_member_read on public.fleets
  for select using (id = public.current_fleet_id());

-- ------------------------------------------------------------
-- 4. Add fleet_id to every tenant table:
--    add column -> backfill to Don fleet -> NOT NULL ->
--    default current_fleet_id() for future app inserts ->
--    index -> restrictive isolation policy
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'crew', 'contracts', 'landings', 'landing_crew',
    'month_closeouts', 'payments', 'wage_payments',
    'one_off_bonuses', 'settings',
    'sales_landings', 'sales_rows'
  ]
  loop
    execute format('alter table public.%I add column if not exists fleet_id uuid references public.fleets(id)', t);
    execute format('update public.%I set fleet_id = %L where fleet_id is null',
                   t, '00000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column fleet_id set not null', t);
    execute format('alter table public.%I alter column fleet_id set default public.current_fleet_id()', t);
    execute format('create index if not exists %I on public.%I (fleet_id)', t || '_fleet_idx', t);

    execute format('drop policy if exists %I on public.%I', 'fleet_isolation_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (fleet_id = public.current_fleet_id())
         with check (fleet_id = public.current_fleet_id())',
      'fleet_isolation_' || t, t);
  end loop;
end $$;

-- Same restrictive layer on app_users (users only ever see
-- rows inside their own fleet; own-row reads still pass)
drop policy if exists fleet_isolation_app_users on public.app_users;
create policy fleet_isolation_app_users on public.app_users
  as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- ------------------------------------------------------------
-- 5. Re-key single-fleet unique constraints to per-fleet ones.
--    Finds every UNIQUE constraint (not primary keys) on the
--    tenant tables that doesn't already include fleet_id, drops
--    it, and recreates it as UNIQUE (fleet_id, ...same cols...).
--    Covers sales_landings.dedup_key and e.g. any unique month
--    on month_closeouts — two fleets can then close the same
--    month or land the same sale number without colliding.
-- ------------------------------------------------------------
do $$
declare
  t text;
  c record;
begin
  foreach t in array array[
    'crew', 'contracts', 'landings', 'landing_crew',
    'month_closeouts', 'payments', 'wage_payments',
    'one_off_bonuses', 'sales_landings', 'sales_rows'
  ]
  loop
    for c in
      select con.conname,
             (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
                from unnest(con.conkey) with ordinality as k(attnum, ord)
                join pg_attribute a
                  on a.attrelid = con.conrelid and a.attnum = k.attnum) as collist
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public'
        and rel.relname = t
        and con.contype = 'u'
        and not exists (
          select 1 from unnest(con.conkey) k(attnum)
          join pg_attribute a
            on a.attrelid = con.conrelid and a.attnum = k.attnum
          where a.attname = 'fleet_id')
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
      execute format('create unique index if not exists %I on public.%I (fleet_id, %s)',
                     left(t || '_fleet_' || c.conname, 63), t, c.collist);
    end loop;
  end loop;
end $$;

-- settings: exactly one row per fleet (app uses .maybeSingle())
create unique index if not exists settings_one_per_fleet on public.settings (fleet_id);

-- ------------------------------------------------------------
-- 6. Verify — every count should be 0
-- ------------------------------------------------------------
select 'app_users' as tbl, count(*) as missing_fleet from public.app_users where fleet_id is null
union all select 'crew',            count(*) from public.crew            where fleet_id is null
union all select 'contracts',       count(*) from public.contracts       where fleet_id is null
union all select 'landings',        count(*) from public.landings        where fleet_id is null
union all select 'landing_crew',    count(*) from public.landing_crew    where fleet_id is null
union all select 'month_closeouts', count(*) from public.month_closeouts where fleet_id is null
union all select 'payments',        count(*) from public.payments        where fleet_id is null
union all select 'wage_payments',   count(*) from public.wage_payments   where fleet_id is null
union all select 'one_off_bonuses', count(*) from public.one_off_bonuses where fleet_id is null
union all select 'settings',        count(*) from public.settings        where fleet_id is null
union all select 'sales_landings',  count(*) from public.sales_landings  where fleet_id is null
union all select 'sales_rows',      count(*) from public.sales_rows      where fleet_id is null;
