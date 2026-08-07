-- ============================================================
-- Migrate the Aegir crew record into ours.
--
-- Run in the Supabase SQL editor, AFTER crew_voyage_fields.sql.
-- Data only, plus one additive column. Changes no crewman's
-- status, type, or contract.
--
-- SOURCE
--   aegirfleet.com → Team → Members (20 profiles, read one by
--   one) and Team → Crew List (the 10 currently on board, which
--   is the only place Aegir shows an embarked date).
--   Read 07-08-2026.
--
-- WHAT IS AND IS NOT TOUCHED
--   Only public.crew rows in the Audacious fleet, matched by
--   full_name. Seventeen of our twenty rows match a person in
--   Aegir. The three that do not, and the three Aegir people we
--   have no row for, are listed at the bottom and are left alone
--   — every one of them needs a decision, not a guess.
--
--   Status is NOT set from Aegir. Aegir and this app disagree
--   about who is aboard (see notes), and status is changed on
--   the crew status page and nowhere else.
-- ============================================================


-- ---- 0. Place of birth ----------------------------------------------
-- Not in the agreed field list, but FAL 5 asks for date AND place of
-- birth, and Aegir holds it for all seventeen. Adding the column now
-- costs one nullable text field; leaving it out means going back to
-- Aegir for a second pass later.
--
-- NOTE: crew_list_members does not carry it either, so the generated
-- crew list still cannot print it. That is a change to the crew list
-- snapshot, to be made when section 3 is built. This stores the data.
alter table public.crew
  add column if not exists place_of_birth text;


-- ---- 1. The seventeen matched crew ----------------------------------
-- Rank mapping, Aegir label → our code:
--   Captain        → master          (what Aegir's OWN crew list prints
--                                     for David Gatt, and the rank a
--                                     FAL 5 wants for the man in command)
--   Chief Engineer → chief_engineer
--   Deckhand       → deckhand
--   Cook           → cook
--
-- Aegir dates are DD-MM-YYYY and are written here as ISO.
--
-- Andrew Smith's passport expired 25-02-2026. That is deliberate test
-- data for the expiry notices — it is carried across exactly as held
-- and must not be "corrected".

with aegir (full_name, rank_code, nationality, dob, pob,
            passport_number, passport_expiry, passport_country,
            embarked_date, fam_done) as (values
  ('David Gatt',        'master',         'British',  date '1986-12-14', 'Banff',            '157327262', date '2035-09-09', 'United Kingdom', date '2026-07-29', 42),
  ('Barry Reid',        'master',         'British',  date '1979-01-30', 'Banff',            '556652004', date '2028-09-04', 'United Kingdom', null::date,        42),
  ('Norman Wood',       'chief_engineer', 'British',  date '1974-08-14', 'Banff',            '552020428', date '2028-09-07', 'United Kingdom', null::date,        42),
  ('David Henderson',   'chief_engineer', 'British',  date '1983-07-08', 'Aberdeen',         '54314635',  date '2027-09-09', 'United Kingdom', date '2026-07-29',  0),
  ('Andrew Smith',      'deckhand',       'British',  date '1983-01-05', 'Banff',            '160163811', date '2026-02-25', 'United Kingdom', date '2026-07-29',  0),
  ('Gregor Smith',      'deckhand',       'British',  date '2007-10-22', 'Peterhead',        '131041490', date '2027-04-19', 'United Kingdom', null::date,         0),
  ('Paul Craib',        'deckhand',       'British',  date '1988-06-23', 'Peterhead',        '153284003', date '2035-02-13', 'United Kingdom', null::date,         0),
  ('Ronald Beagrie',    'deckhand',       'British',  date '1988-07-23', 'Peterhead',        '151208181', date '2034-12-12', 'United Kingdom', date '2026-07-20',  0),
  ('James Napier',      'deckhand',       'British',  date '1984-01-27', 'Banff',            '564627372', date '2029-11-27', 'United Kingdom', date '2026-07-29', 42),
  ('Duncan Cruikshank', 'deckhand',       'British',  date '1981-10-10', 'Aberdeen',         '158508352', date '2035-06-03', 'United Kingdom', null::date,         0),
  ('Jackson Gatt',      'cook',           'British',  date '2009-05-19', 'Elgin',            '128222384', date '2027-02-08', 'United Kingdom', date '2026-07-29', 42),
  ('Alfie Reid',        'cook',           'British',  date '2009-09-23', 'Dundee',           '156724935', date '2030-08-27', 'United Kingdom', null::date,         0),
  ('Elizer Tano',       'deckhand',       'Filipino', date '1981-03-20', 'Samboan, Cebu',    'P8575884B', date '2031-12-26', 'Philippines',    date '2026-05-11',  0),
  ('Eugene Tano',       'deckhand',       'Filipino', date '1977-12-24', 'Samboan, Cebu',    'P6612525A', date '2028-04-01', 'Philippines',    null::date,         0),
  ('Lorenzo Rusiana',   'deckhand',       'Filipino', date '1973-08-11', 'Santander, Cebu',  'P1383683C', date '2032-08-18', 'Philippines',    date '2026-05-11',  0),
  -- Aegir calls him "John Gabriel Binggan". Ours is "John Binggan".
  -- Matched deliberately and by hand; see note 3 at the bottom.
  ('John Binggan',      'deckhand',       'Filipino', date '1987-12-31', 'Oslob, Cebu',      'P4889609B', date '2030-02-19', 'Philippines',    null::date,         0),
  -- Edgel Bigno is "Not started" in Aegir, not "0 of 42", so his
  -- familiarisation counts stay null rather than becoming a zero.
  ('Edgel Bigno',       'deckhand',       'Filipino', date '1995-12-31', 'Oslob, Cebu',      'P8666083B', date '2032-01-07', 'Philippines',    date '2026-05-11', null)
)
update public.crew c
   set rank_code               = a.rank_code,
       nationality             = a.nationality,
       date_of_birth           = a.dob,
       place_of_birth          = a.pob,
       passport_number         = a.passport_number,
       passport_expiry         = a.passport_expiry,
       passport_country        = a.passport_country,
       embarked_date           = a.embarked_date,
       familiarised_items_done = a.fam_done,
       familiarised_items_total= case when a.fam_done is null then null else 42 end,
       updated_at              = now()
  from aegir a
 where c.full_name = a.full_name
   and c.fleet_id  = (select id from public.fleets where name = 'AUDACIOUS BF83');
-- expect UPDATE 17


-- ============================================================
-- VERIFY
-- ============================================================
select full_name, rank_code, nationality, date_of_birth, place_of_birth,
       passport_number, passport_expiry, passport_country, embarked_date,
       familiarised_items_done, familiarised_items_total, status
  from public.crew
 where fleet_id = (select id from public.fleets where name = 'AUDACIOUS BF83')
 order by passport_number nulls last, full_name;
-- expect 17 rows carrying a passport, 3 without

-- Nobody gained or lost, and no status moved.
select count(*) as crew_rows,
       count(passport_number) as with_passport,   -- expect 17
       count(rank_code) as with_rank              -- expect 17
  from public.crew
 where fleet_id = (select id from public.fleets where name = 'AUDACIOUS BF83');

-- The one expired passport, left expired on purpose.
select full_name, passport_expiry from public.crew
 where passport_expiry < current_date;
-- expect exactly Andrew Smith, 2026-02-25


-- ============================================================
-- LEFT ALONE — each needs a decision
--
-- 1. Andrejs Gundarovs. Chief Engineer, Latvian, passport LZ4181918
--    exp 07-09-2033, embarked 13-07-2026. Aegir has him ON BOARD
--    right now. We have no crew row for him at all. Not created
--    here because crew_type (contracted vs self-employed) decides
--    whether he appears in contracts, closeout and bonuses, and
--    that is not something to guess at.
--
-- 2. Ian Anderson (2nd Engineer) and Bryan Reid (rank "Other",
--    a donfishing.com address). Both in Aegir, neither in our crew,
--    and neither has a passport, nationality or date of birth in
--    Aegir either. Bryan Reid looks like an office login rather
--    than crew.
--
-- 3. "John Binggan" (ours, on leave) and "John Gabriel" (ours,
--    former, archived 06-06-2026) may well be the same man split
--    into two rows. Aegir holds exactly one "John Gabriel Binggan",
--    and its shift log shows him moving to on_leave on 02-07-2026 —
--    after our "John Gabriel" was archived. The passport above went
--    to "John Binggan" only. Merging records is not reversible and
--    is not done here.
--
-- 4. William Gatt (ours, on leave) and Arnel Nobel (ours, former)
--    are not in Aegir. No passport available for either.
--
-- 5. Aegir and this app disagree about who is aboard. Aegir has
--    Andrejs Gundarovs and James Napier on board; we have Duncan
--    Cruikshank and Paul Craib. Status was not touched.
--
-- 6. Aegir spells Andrejs Gundarovs's nationality "Lativan".
--    If his record is created, it should read Latvian.
-- ============================================================


-- ============================================================
-- ROLLBACK
--   update public.crew
--      set rank_code = null, nationality = null, date_of_birth = null,
--          place_of_birth = null, passport_number = null,
--          passport_expiry = null, passport_country = null,
--          embarked_date = null, familiarised_items_done = null,
--          familiarised_items_total = null
--    where fleet_id = (select id from public.fleets where name = 'AUDACIOUS BF83');
--   alter table public.crew drop column if exists place_of_birth;
-- ============================================================
