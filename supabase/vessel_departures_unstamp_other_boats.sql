-- `vessel_departures` IS A FEED OF OTHER BOATS, NOT THIS BOAT'S SAILINGS.
--
-- 1,606 rows, 225 distinct vessel names, source 'ais' — HOPEFUL PD12, XIAMARA
-- and 222 others leaving Peterhead. It sits on Audacious's fleet_id because
-- that is who subscribes to it, and only SEVEN rows are about Audacious.
--
-- `vessel_id_backfill_after_provider.sql` stamped Audacious's vessel_id onto
-- every unstamped row in every table belonging to a single-vessel fleet. That
-- rule is right for a boat's own records and WRONG HERE, because the fleet_id
-- on these rows says who is reading the feed, not whose departure it is. 713
-- rows were already wrongly stamped before that migration; it took the number
-- to 1,577.
--
-- THE TEST FOR "THE ONLY POSSIBLE ANSWER" HAS TO BE ABOUT THE ROW, NOT THE
-- FLEET. A fleet with one boat does not mean every row it can see is about that
-- boat — and this table is the counter-example the rule needed. `vessel_name`
-- was sitting there the whole time saying which boat each row is.
--
-- So: match on the name, and NULL for everybody else. A null here is correct
-- and permanent — those 218 boats are not in `vessels` and never will be.
update public.vessel_departures d
set vessel_id = v.id
from public.vessels v
where v.fleet_id = d.fleet_id
  and upper(trim(d.vessel_name)) = upper(trim(v.label));

update public.vessel_departures d
set vessel_id = null
where d.vessel_id is not null
  and not exists (
    select 1 from public.vessels v
    where v.id = d.vessel_id
      and upper(trim(d.vessel_name)) = upper(trim(v.label)));

comment on column public.vessel_departures.vessel_id is
  'The boat this departure is ABOUT, where she is one of the fleet''s own. Null '
  'for the other 200-odd boats in the AIS feed — the fleet_id says who reads the '
  'feed, not whose departure it is.';
