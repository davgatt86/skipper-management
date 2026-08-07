-- ============================================================
-- The two fields IMO FAL Form 5 asks for that we had nowhere to put.
-- Applied and verified Aug 2026. Additive only.
-- ============================================================


-- FAL 5 field "Date and place of birth".
--
-- The crew record gained place_of_birth in the Aegir migration, but the crew
-- list prints from crew_list_members — a point-in-time snapshot — and that
-- never had the column. So the form could not be filled properly even though
-- we held the data.
alter table public.crew_list_members
  add column if not exists place_of_birth text;


-- FAL 5 field "Flag State of ship". Left null rather than defaulted: a crew
-- list should not guess the flag a vessel sails under. Editable on the Vessel
-- Details page.
alter table public.vessel_details
  add column if not exists flag_state text;


-- Backfill the snapshot. Place of birth does not change over time and was
-- simply never captured, so filling it in corrects the old list rather than
-- rewriting history.
update public.crew_list_members m
   set place_of_birth = c.place_of_birth
  from public.crew c
 where c.id = m.crew_id
   and m.place_of_birth is null
   and c.place_of_birth is not null;


-- ============================================================
-- VERIFY
-- ============================================================
select full_name, rank, nationality, date_of_birth, place_of_birth, passport_number
  from public.crew_list_members order by position;

-- NOTE on the one saved crew list (built before the Aegir migration):
--   it carries no passports, no dates of birth and no nationality; one row has
--   nationality "Engineer", which is a mis-keyed rank; and "Andrejs Gundravos"
--   is misspelled and has a null crew_id, so it did not pick up a place of
--   birth in the backfill. It is left exactly as saved — it is a record of what
--   was produced at the time. Delete it from the page if it is not wanted.
--   Any list generated now comes off the crew records and will not look like
--   that.
