-- ============================================================
-- LANDING_CREW REPAIR — run once in Supabase SQL editor
-- Fixes the "crew won't add to landings" problem.
--
-- Why it happens: a landing_crew row can exist in the table but
-- be invisible to the app (e.g. wrong fleet_id under the fleet
-- isolation policy). Postgres inserts are all-or-nothing, so one
-- hidden duplicate makes the WHOLE crew insert fail — the app
-- swallowed that as "already saved" and nothing was added.
--
-- This script: (1) repairs fleet_id on landing_crew rows to match
-- their landing, (2) guarantees a unique key the app's new
-- ON CONFLICT DO NOTHING writes can target, (3) prints diagnostics.
-- Safe to re-run.
-- ============================================================

-- 1. Sync landing_crew.fleet_id to the parent landing's fleet
update public.landing_crew lc
set fleet_id = l.fleet_id
from public.landings l
where lc.landing_id = l.id
  and lc.fleet_id is distinct from l.fleet_id;

-- ...and landings/crew to the owning user's fleet should never
-- drift, but belt-and-braces: report any mismatch lower down.

-- 2. Ensure a unique constraint on (landing_id, crew_id) exists
--    (the app's upsert targets it). Skipped if the primary key
--    or an existing unique index already covers those columns.
do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    where con.conrelid = 'public.landing_crew'::regclass
      and con.contype in ('p', 'u')
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(con.conkey) k(attnum)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      ) = array['crew_id', 'landing_id']::text[]
  ) then
    execute 'create unique index if not exists landing_crew_landing_crew_uniq on public.landing_crew (landing_id, crew_id)';
    raise notice 'added unique index landing_crew_landing_crew_uniq';
  else
    raise notice 'unique key on (landing_id, crew_id) already present';
  end if;
end $$;

-- 3. Diagnostics — read the output:
--    a) rows repaired above show as fleet_fixed > 0 next run = 0
--    b) every unlocked landing with 0 visible crew
--    c) live contracts the auto-add will match today
select 'landing_crew rows total' as what, count(*)::text as detail from public.landing_crew
union all
select 'landing_crew wrong fleet (should be 0 now)',
       count(*)::text
from public.landing_crew lc join public.landings l on l.id = lc.landing_id
where lc.fleet_id is distinct from l.fleet_id
union all
select 'unlocked landings with no crew',
       count(*)::text
from public.landings l
where not l.locked
  and not exists (select 1 from public.landing_crew lc where lc.landing_id = l.id)
union all
select 'contracts covering today (auto-add source)',
       count(*)::text
from public.contracts ct
where ct.start_date <= current_date
  and (ct.end_date is null or ct.end_date >= current_date);

-- 4. The contracts the app will treat as "aboard today" — check
--    these are the lads you expect:
select c.full_name, ct.start_date, ct.end_date, ct.status
from public.contracts ct
join public.crew c on c.id = ct.crew_id
where ct.start_date <= current_date
  and (ct.end_date is null or ct.end_date >= current_date)
order by c.full_name;
