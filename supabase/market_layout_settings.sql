-- Market layout rules, per fleet.
--
-- The clocks, which species goes on which, and how high each species may be
-- stacked at each size band. All of it used to be hard-coded in
-- src/lib/market/layoutRules.js, which meant that the market moving a species
-- from one clock to another was a code change and a deploy — for something a
-- skipper knows the day it happens and nobody else does.
--
-- One row per fleet, one jsonb document, same shape as alert_settings: this is
-- a handful of lookups edited as a whole on one page, not something to be
-- queried across. The DEFAULTS STAY IN THE CODE and a missing key falls back
-- to them (see resolveRules), so:
--
--   * a fleet with no row here behaves exactly as it did before, and
--   * a fleet that has changed one clock keeps the shipped defaults for the
--     rest rather than freezing a copy of them at the moment it first saved.
--
-- Shape:
--   { "clocks":       [{ "id":"cod", "n":1, "label":"Cod", "splitRows":false }],
--     "speciesClock": { "COD":"cod", "HADDOCK":"hadwhit" },
--     "heights":      { "HADDOCK": { "1":1, "2":2, "3":3, "4":4, "*":2 } },
--     "fallbackClock": "rough" }

create table if not exists public.market_layout_settings (
  fleet_id    uuid primary key references public.fleets(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

alter table public.market_layout_settings enable row level security;

-- FIRST, and on purpose. The permissive policies in this database do not carry
-- a fleet check of their own, so without this the table is open to every
-- tenant from the moment it exists.
drop policy if exists fleet_isolation on public.market_layout_settings;
create policy fleet_isolation on public.market_layout_settings
  as restrictive for all to authenticated
  using (fleet_id = (select public.current_fleet_id()))
  with check (fleet_id = (select public.current_fleet_id()));

-- Anyone in the fleet may READ the rules — the layout page needs them to draw
-- anything at all, and a viewer looking at a plan must see the same one.
drop policy if exists market_rules_read on public.market_layout_settings;
create policy market_rules_read on public.market_layout_settings
  for select to authenticated using (true);

-- Only the skipper CHANGES them. Putting a species on the wrong clock sends
-- the fish to the wrong auction.
drop policy if exists market_rules_write on public.market_layout_settings;
create policy market_rules_write on public.market_layout_settings
  for all to authenticated
  using (exists (select 1 from public.app_users u
                  where u.id = (select auth.uid()) and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u
                       where u.id = (select auth.uid()) and u.role = 'skipper'));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.market_layout_settings to authenticated;

-- An officer has no business here: he is denied everything outside his
-- allow-list, and the deny loop in officer_role.sql only touches tables that
-- exist when it runs. RE-RUN supabase/officer_role.sql AFTER THIS.
