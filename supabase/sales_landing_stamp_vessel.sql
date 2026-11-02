-- STAMP THE BOAT ON A LANDING, FROM THE NOTE'S OWN VESSEL LABEL (Nov 2026)
--
-- Sandy's two notes of 02-11-2026 went in with `vessel_id` null, and so had
-- every landing uploaded since the stage-1 backfill of 16-10-2026 — 35 of them
-- across four fleets. Nothing in either upload path ever set the column; the
-- backfill stamped history once and then the gap re-opened behind it.
--
-- It cost nothing on Fish Sales, which matches on the vessel LABEL. It is still
-- the documented failure shape -- "a filter and a stamp are one feature" -- and
-- the quota page proved what it costs the moment anything does filter on the id.
--
-- A TRIGGER, NOT TWO CODE PATHS. The browser upload and the CloudMailin webhook
-- both write this table, the demo seed writes it too, and this repo's recurring
-- fault is one rule living in two places and drifting. The rule needs nothing
-- the client knows: the row already carries `fleet_id` and the boat's name as
-- the note printed it, and `vessels.label` is the same canonical "NAME REG"
-- that `canonVessel()` produces. So it belongs in the database, once.
--
-- IT ONLY EVER FILLS A NULL. An explicit vessel_id is somebody's answer and is
-- never overwritten -- and a label naming no boat in that fleet leaves the
-- column null rather than guessing, which is what HANSTHOLM needs (no `vessels`
-- row at all) and what a pair needs when the note cannot be read.

create or replace function public.stamp_sales_landing_vessel()
returns trigger
language plpgsql
as $$
begin
  if new.vessel_id is null and coalesce(new.vessel, '') <> '' then
    select v.id into new.vessel_id
      from public.vessels v
     where v.fleet_id = new.fleet_id
       and v.label = new.vessel
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_vessel on public.sales_landings;
create trigger stamp_vessel
  before insert or update of vessel, vessel_id, fleet_id on public.sales_landings
  for each row execute function public.stamp_sales_landing_vessel();

-- The 35 already filed. Same join the stage-1 migration used: the note names
-- its own boat, so this is a join and not an inference.
update public.sales_landings l
   set vessel_id = v.id
  from public.vessels v
 where l.vessel_id is null
   and v.fleet_id = l.fleet_id
   and v.label = l.vessel;
