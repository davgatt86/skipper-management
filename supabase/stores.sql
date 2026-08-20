-- Stores and provisions — stage 1.
--
-- A list per trip, built up as the trip goes on, printed for a supplier who
-- has no login. The catalogue itself lives in CODE (src/lib/stores/
-- catalogue.js, 334 items across 18 categories, off the Whitehills Premier
-- order form); only what a fleet ADDS or CHANGES is stored here, and
-- resolveCatalogue() merges the two. Seeding 334 rows per fleet instead would
-- freeze every boat on the day it first saved, and a translation added later
-- would reach nobody.
--
-- Stage 2 adds the cook login. It is deliberately not here: `user_role` has no
-- 'cook', and adding one means every permissive policy in this database —
-- which is `to authenticated using (true)` with only the restrictive fleet
-- check beside it — starts letting a cook through. That needs the generated
-- deny loop and a probe, not a line in this file.

-- ---------------------------------------------------------------- catalogue
-- One row per item the fleet has changed or invented. `item_key` matches the
-- code catalogue's key, so an override and a shipped item are the same thing.
create table if not exists public.stores_items (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  item_key    text not null,
  category    text,
  name        text,
  unit        text,
  name_no     text,          -- Norwegian, for a foreign landing. Blank = print English.
  name_da     text,          -- Danish, same.
  hidden      boolean not null default false,   -- retire without deleting
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fleet_id, item_key)
);

-- ------------------------------------------------------------------- lists
create table if not exists public.stores_lists (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  vessel_id   uuid references public.vessels(id),   -- a pair team feeds two crews
  title       text,
  starts_on   date,
  -- Meals for N. Defaulted from who is aboard rather than typed: it went 10 to
  -- 11 between July and August when Gundarovs joined, and the app already
  -- knows that.
  meals_for   int,
  status      text not null default 'building',    -- building | ordered | received
  -- Which language the shop reads. On the LIST, not a picker that resets: a
  -- trip landing in Hanstholm lands there every time the list is opened.
  -- Added Aug 2026 (stage 3) — see supabase/stores_supplier_lang migration.
  supplier_lang text not null default 'en'
    check (supplier_lang in ('en','no','da')),
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stores_lists_fleet_date on public.stores_lists (fleet_id, starts_on desc);

-- ------------------------------------------------------------------- lines
-- The item's name, category and unit are SNAPSHOT onto the line as well as
-- linked by key. A list is a record of what was ordered; renaming a catalogue
-- item next year must not rewrite last year's order.
create table if not exists public.stores_list_items (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  list_id     uuid not null references public.stores_lists(id) on delete cascade,
  item_key    text not null,
  name        text not null,
  category    text,
  qty         numeric not null default 1,
  unit        text not null default 'unit',
  note        text,
  got         boolean not null default false,      -- ticked off when it comes aboard
  -- What makes this a list built up over a trip rather than a snapshot.
  added_at    timestamptz not null default now(),
  added_by    uuid references auth.users(id)
);
create index if not exists stores_list_items_list on public.stores_list_items (list_id, added_at);
create unique index if not exists stores_list_items_one_per_item
  on public.stores_list_items (list_id, item_key);

-- --------------------------------------------------------------------- RLS
-- fleet_isolation FIRST on every one of them. The permissive policies in this
-- database carry no fleet check of their own, so without this a table is open
-- to every tenant from the moment it exists.
do $$
declare t text;
begin
  foreach t in array array['stores_items','stores_lists','stores_list_items'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists fleet_isolation on public.%I', t);
    execute format(
      'create policy fleet_isolation on public.%I as restrictive for all to authenticated
         using (fleet_id = (select public.current_fleet_id()))
         with check (fleet_id = (select public.current_fleet_id()))', t);

    -- Anyone in the fleet may read the list; a viewer should see what was ordered.
    execute format('drop policy if exists stores_read on public.%I', t);
    execute format('create policy stores_read on public.%I for select to authenticated using (true)', t);

    -- Stage 1: the skipper writes. The cook role arrives in stage 2.
    execute format('drop policy if exists stores_write on public.%I', t);
    execute format(
      'create policy stores_write on public.%I for all to authenticated
         using (exists (select 1 from public.app_users u
                         where u.id = (select auth.uid()) and u.role = ''skipper''))
         with check (exists (select 1 from public.app_users u
                              where u.id = (select auth.uid()) and u.role = ''skipper''))', t);

    -- An officer keeps records, not groceries. Same allow-list machinery as
    -- every other table outside officer_role.sql's list.
    execute format('drop policy if exists officer_no_access on public.%I', t);
    execute format(
      'create policy officer_no_access on public.%I as restrictive for all to authenticated
         using (not (select public.is_officer())) with check (not (select public.is_officer()))', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant usage on schema public to authenticated;

-- ------------------------------------------------------------ meals for N
-- How many are aboard, for the current fleet. SECURITY DEFINER so the number
-- can be had without handing the reader the crew table — which is what lets
-- the cook role in stage 2 default its own list without seeing the crew.
create or replace function public.crew_aboard_count()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from public.crew
   where fleet_id = (select public.current_fleet_id())
     and archived_at is null
     and status = 'on_boat'
$$;

comment on function public.crew_aboard_count() is
  'Headcount aboard for the caller''s fleet, for defaulting "meals for N" on a stores list. SECURITY DEFINER so a cook login can have the number without being granted the crew table.';

grant execute on function public.crew_aboard_count() to authenticated;
