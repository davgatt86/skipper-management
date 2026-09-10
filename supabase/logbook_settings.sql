-- How often the boat means to hold the recurring Official Log Book entries.
--
-- David, Sep 2026: "intervals are guide not targets. we can do and log drills
-- and tests weekly, fortnightlly or monthly."
--
-- SI 1981/570 says WHAT to enter, not how often to hold a drill — the entry is
-- required when one IS held. So these are the boat's own practice, on the same
-- footing as the 12-month risk assessment cycle, and nothing in the app may
-- report a breach of a calendar nobody set.
--
-- SAME SHAPE AS market_layout_settings AND alert_settings: one jsonb per fleet,
-- holding ONLY WHAT DIFFERS from the shipped defaults, merged over them by
-- `resolveGuides`. Storing the whole set would freeze this fleet's copy of
-- today's defaults, so a later correction would never reach a boat that had
-- once opened the settings — the trap the stores catalogue documents.
--
-- `null` for an entry is a real answer and is kept: "no guide, just tell me
-- when it was last done". Only a value that is neither a positive number nor an
-- explicit null falls back.
create table if not exists public.logbook_settings (
  fleet_id uuid primary key references public.fleets(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.logbook_settings enable row level security;

-- A NEW TABLE NEEDS ITS fleet_isolation POLICY BEFORE IT NEEDS ANYTHING ELSE:
-- the permissive policies in this database carry no fleet check of their own,
-- so without this it is open to every tenant from the moment it exists.
drop policy if exists fleet_isolation_logbook_settings on public.logbook_settings;
create policy fleet_isolation_logbook_settings on public.logbook_settings
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

drop policy if exists logbook_settings_read on public.logbook_settings;
create policy logbook_settings_read on public.logbook_settings
  for select to authenticated using (auth.uid() is not null);

-- The mate keeps most of these books, so he sets the guide he works to.
drop policy if exists logbook_settings_write on public.logbook_settings;
create policy logbook_settings_write on public.logbook_settings
  for all to authenticated
  using (exists (select 1 from public.app_users u
                  where u.id = (select auth.uid())
                    and u.role in ('skipper', 'officer', 'engineer')))
  with check (exists (select 1 from public.app_users u
                       where u.id = (select auth.uid())
                         and u.role in ('skipper', 'officer', 'engineer')));

grant select, insert, update, delete on public.logbook_settings to authenticated;

comment on table public.logbook_settings is
  'Per-fleet overrides for how often the recurring Official Log Book entries are '
  'meant to be held. Holds only what differs from the shipped guides. These are '
  'the boat''s own practice, not a statutory interval.';
