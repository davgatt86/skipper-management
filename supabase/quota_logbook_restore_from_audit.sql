-- RESTORING THE LOGBOOK OUT OF THE AUDIT LOG (Oct 2026)
--
-- On 08-10-2026 at 12:14 UTC a quota reset deleted Audacious's whole logbook:
--
--     quota_trip_catches  13,449     quota_lines         189
--     quota_trips            173     quota_snapshots       3
--                                    quota_adjustments     22
--
-- Found when David asked how many days she fished the Norwegian zone in 2025
-- and the table held one trip. The answer was still gettable — 90 days, all in
-- IVa (NOR) — because `audit_the_books.sql` put a trigger on these tables and
-- every deleted row was captured WHOLE in `before_data`. That is the entire
-- reason this file can exist, and it is the argument for the audit trail in
-- one line: the books were gone and nothing else in the system knew it.
--
-- ONLY THE LOGBOOK IS RESTORED HERE — trips and their catch detail. The quota
-- statement is NOT: David re-uploaded it the same afternoon (2 snapshots, 126
-- lines, inserted at 12:12 and 12:14:27), so putting the 3 old snapshots and
-- 189 old lines back would give the boat two statements for one year and the
-- page would have to choose between them. The logbook had no such re-upload.
--
-- CHECKED BEFORE A ROW WAS WRITTEN, because a restore that half-lands is worse
-- than no restore:
--
--     payload carries every live column      trips 0 missing, catches 0 missing
--     id collides with a row living now      0 and 0
--     a catch whose trip would not exist     0
--     fleets represented in the payload      1, and it is Audacious
--     trip_nr clashing with the survivor     0
--
-- The one trip that survived the reset (C2100420260037, departed 30-09-2026)
-- is NOT in this set — the restore runs 28-10-2022 to 28-09-2026 and stops two
-- days short of it. 173 + 1 = 174.
--
-- PARENTS BEFORE CHILDREN. `quota_trip_catches.trip_id` references
-- `quota_trips`, so the trips go back first or every catch is refused. The
-- same ordering the duplicate-invoice removals used, for the opposite reason.
--
-- `jsonb_populate_record` rebuilds each row from its own stored payload, so
-- nothing is retyped and no data leaves the database to be transformed. The
-- audit trigger fires on these inserts, which is correct: the restore is
-- itself a thing that happened to the books and should be in the record.

begin;

-- 1. The trips.
insert into public.quota_trips
select (jsonb_populate_record(null::public.quota_trips, before_data)).*
from public.audit_log
where action = 'delete'
  and table_name = 'quota_trips'
  and occurred_at between '2026-10-08 12:14:00+00' and '2026-10-08 12:15:00+00'
on conflict (id) do nothing;

-- 2. The catch detail, now that every trip_id it names exists again.
insert into public.quota_trip_catches
select (jsonb_populate_record(null::public.quota_trip_catches, before_data)).*
from public.audit_log
where action = 'delete'
  and table_name = 'quota_trip_catches'
  and occurred_at between '2026-10-08 12:14:00+00' and '2026-10-08 12:15:00+00'
on conflict (id) do nothing;

-- 3. Four of the restored trips carry no vessel_id, because nothing on the
--    quota page ever stamped one — the fault behind "the boat filter hid a
--    fleet's own quota statement". Audacious is a one-boat fleet, so there is
--    exactly one possible answer and it is not a guess. Same rule and the same
--    scope as quota_stamp_single_boat_fleets.sql.
update public.quota_trips t
   set vessel_id = v.id
  from public.vessels v
 where t.vessel_id is null
   and t.fleet_id = v.fleet_id
   and t.fleet_id = '00000000-0000-0000-0000-000000000001'
   and (select count(*) from public.vessels v2 where v2.fleet_id = t.fleet_id) = 1;

commit;
