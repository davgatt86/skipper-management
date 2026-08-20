-- WHAT THIS ENGINE ACTUALLY DOES — a stated operating range per parameter.
--
-- The page already had a rolling-average check: anything more than 60% off the
-- mean of its own history raised a warning. THAT CHECK WOULD HAVE FLAGGED THE
-- CORRECT READINGS.
--
-- Gearbox 1 Oil Press read 28, 28, 2.8, 2.8, 38, 25, 38. Two of seven entries
-- were on the wrong scale, but the median was 28 — so a history-derived test
-- called the RIGHT values the outliers, and an engineer "fixing" them would
-- have destroyed the good data. David settled it 21-08-2026: the gauge runs
-- 25-38 and the two 2.8s were the mis-keys.
--
-- So history cannot be the authority. A range is STATED, by the man who knows
-- the engine, and the rolling average stays only as a secondary "this is
-- drifting" signal. See src/lib/engine/limits.js.
--
-- NO vessel_id, deliberately: the group key already carries the engine's
-- identity — "Main Engine 1", "Generator 2" — so two boats with different
-- engines use different group names and need no extra column.
--
-- RE-RUN officer_role.sql AND cook_role.sql AFTER THIS. engine_limits is in the
-- officer's allow-list, and the deny loop only touches tables OUTSIDE it, so it
-- cannot clear the denial a table was given while it was outside — the trap
-- that shut officers out of crew certs once already.
create table if not exists public.engine_limits (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  group_key   text not null,          -- 'Main Engine 1'
  param_key   text not null,          -- 'Lube Oil Pressure'
  min_val     numeric,
  max_val     numeric,
  enabled     boolean not null default true,
  -- Detected from the data, not guessed from the name: see isCounter().
  is_counter  boolean not null default false,
  -- Seeded ranges are a SUGGESTION until somebody who knows the engine says
  -- otherwise — same shape as the stores units, and for the same reason.
  confirmed   boolean not null default false,
  source      text not null default 'seeded' check (source in ('seeded', 'engineer')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fleet_id, group_key, param_key),
  constraint engine_limits_order check (min_val is null or max_val is null or max_val >= min_val)
);
create index if not exists engine_limits_fleet on public.engine_limits (fleet_id, group_key);

alter table public.engine_limits enable row level security;

drop policy if exists fleet_isolation on public.engine_limits;
create policy fleet_isolation on public.engine_limits as restrictive for all to authenticated
  using (fleet_id = (select public.current_fleet_id()))
  with check (fleet_id = (select public.current_fleet_id()));

drop policy if exists engine_limits_read on public.engine_limits;
create policy engine_limits_read on public.engine_limits for select to authenticated using (true);

-- The engineer sets them, because he is the one who knows what the gauge reads.
drop policy if exists engine_limits_write on public.engine_limits;
create policy engine_limits_write on public.engine_limits for all to authenticated
  using (exists (select 1 from public.app_users u
                  where u.id = (select auth.uid())
                    and u.role in ('skipper', 'officer', 'engineer')))
  with check (exists (select 1 from public.app_users u
                       where u.id = (select auth.uid())
                         and u.role in ('skipper', 'officer', 'engineer')));

grant select, insert, update, delete on public.engine_limits to authenticated;

-- ---------------------------------------------------------------- the seed
-- Applied Aug 2026 for Audacious: 50 parameters over 4 groups, 47 given a
-- range and 3 recognised as counters (the three Running Hours). All
-- `confirmed = false` — the range is a starting point drawn from what the
-- engine has actually done, and only becomes the authority when the engineer
-- says so.
--
-- COUNTER DETECTION TOOK THREE GOES, and each correction came from running it
-- on the real logs rather than from reading the code:
--
--   1. A perfect climb was too strict. Main Engine running hours failed on ONE
--      duplicate entry (30-07-2026), so it got a numeric range and the reversal
--      check never ran on it — the bad entry was hiding the test that proves it
--      wrong.
--   2. Allowing a flat fifth of backward steps was too loose: gearbox oil
--      pressure, jacket water temperature, start air pressure and three others
--      passed as counters on seven readings with one dip each.
--   3. What actually separates them is that a counter makes NET PROGRESS ITS
--      DIPS CANNOT ACCOUNT FOR, and that A COUNTER COUNTS — so it rarely reads
--      the same twice. Gearbox PTO 3 bearing temperature sat at 54 for fourteen
--      readings and finished at 58; running hours are all but perfectly
--      distinct.
--
-- The full seed SQL is in the migrations engine_limits_seed_audacious and
-- engine_limits_counter_redetect; the same logic lives in seedLimits() and
-- isCounter() for the in-app "suggest from history" path.
