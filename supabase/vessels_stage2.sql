-- VESSELS STAGE 2, PART ONE: fill what is knowable, and close the hole.
--
-- Stage 1 added a nullable `vessel_id` to twenty tables and backfilled what it
-- could from `sales_landings.vessel`. This finishes it for every fleet with
-- exactly ONE boat, where the answer is not a guess — it is the only possible
-- answer. 457 rows filled.
--
-- WHAT IS DELIBERATELY LEFT NULL (5 rows):
--   rota_trips, 4 — HANSTHOLM has no `vessels` row at all, because it has no
--     sales, no quota trips and no vessel_details either. There is no name to
--     give a boat, and inventing one to satisfy a column is worse than an
--     honest null.
--   quota_manual_stocks, 1 — TEST FLEET is a pair (Boy John + Rosebloom) and
--     which boat a manual quota stock belongs to is not knowable from the row.
--     Guessing would put quota on the wrong boat, which is the one thing the
--     tenancy model exists to prevent.
--
-- The real pair fleets are otherwise already filled wherever the data says
-- which boat: sales_landings and quota_trips both carry a vessel label, which
-- is what made stage 1's backfill a join rather than an assumption.
do $$
declare
  t text; filled int; total int := 0; report text := '';
begin
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'vessel_id'
       and c.table_name not in ('gear_nets', 'parts')   -- built with it required
     order by 1
  loop
    execute format($q$
      update public.%I x
         set vessel_id = v.id
        from public.vessels v
       where x.vessel_id is null
         and v.fleet_id = x.fleet_id
         and v.active is not false
         and (select count(*) from public.vessels v2
               where v2.fleet_id = x.fleet_id and v2.active is not false) = 1
    $q$, t);
    get diagnostics filled = row_count;
    total := total + filled;
    if filled > 0 then report := report || E'\n  ' || rpad(t, 24) || filled; end if;
  end loop;
  raise notice 'Backfilled % rows:%', total, report;
end $$;


-- ---------------------------------------------------- THE CROSS-TENANT HOLE
-- `fleet_isolation` checks `fleet_id` and NOTHING checked that `vessel_id`
-- pointed at a boat in that same fleet. Found by probe while building the gear
-- log: an officer could create a row in his own fleet hung on another
-- business's vessel. Not a read leak — he cannot see that vessel — but a
-- foreign key across a tenant boundary, and a row that would then group under
-- an invisible boat.
--
-- gear_nets and parts were built with the composite FK. THE OTHER EIGHTEEN ALL
-- HAD THE HOLE. No row anywhere violated it — checked before applying — so this
-- is pure hardening.
--
-- Declarative rather than a trigger: a CHECK may not run a subquery, and a
-- composite FK makes the database enforce it. Needs `unique (id, fleet_id)` on
-- vessels, which the gear log added.
--
-- Probed after, as an officer: an engine log or fuel log on another fleet's
-- boat is refused, an UPDATE moving a row across is refused, his own boat is
-- allowed, and a NULL vessel is still allowed — which HANSTHOLM needs.
do $$
declare t text; con text; done text := '';
begin
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'vessel_id'
       and c.table_name not in ('gear_nets', 'parts')
     order by 1
  loop
    -- Drop the single-column FK: the composite subsumes it, and two constraints
    -- saying nearly the same thing is how one of them gets forgotten.
    for con in
      select tc.constraint_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
       where tc.constraint_type = 'FOREIGN KEY'
         and tc.table_schema = 'public' and tc.table_name = t
       group by tc.constraint_name
      having string_agg(kcu.column_name, ',' order by kcu.ordinal_position) = 'vessel_id'
    loop
      execute format('alter table public.%I drop constraint %I', t, con);
    end loop;

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_vessel_same_fleet');
    execute format(
      'alter table public.%I add constraint %I
         foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id)',
      t, t || '_vessel_same_fleet');
    done := done || ' ' || t;
  end loop;
  raise notice 'Composite FK added to:%', done;
end $$;

-- ------------------------------------------------------------- WHAT IS LEFT
-- PART TWO IS NOT A SCHEMA JOB, and that is the thing to understand before
-- starting it.
--
-- `vessel_details` still has `fleet_id` as its primary key, so a pair team can
-- describe only ONE of its two boats. Moving it looks like a migration, but
-- every one of the six readers in the app does
-- `.from('vessel_details').…maybeSingle()` — which THROWS when a second row
-- appears. VesselPlate.jsx is one of them, and it is on every page.
--
-- So the schema change on its own does not give a pair fleet two boats; it
-- gives it six broken pages. What has to come first is a CURRENT VESSEL —
-- a choice that persists, which those pages ask for the answer to. Then
-- `vessel_details` can carry a row per boat and each page knows which one it
-- is showing.
--
-- Order: current-vessel selection, then vessel_details off fleet_id, then the
-- pickers on crew, quota and rota.
