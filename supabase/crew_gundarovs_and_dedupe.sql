-- ============================================================
-- Crew clean-up following the Aegir migration.
-- Applied and verified Aug 2026. Decisions all David's.
--
-- Before: 20 Audacious rows, 17 with a passport, 10 aboard.
-- After:  19 Audacious rows, 18 with a passport, 11 aboard.
-- ============================================================


-- ---- 1. Andrejs Gundarovs -------------------------------------------
-- Contracted, and genuinely aboard — so the vessel had eleven aboard
-- and this app only knew about ten.
--
-- Nationality is Russian, from the passport itself. Aegir says
-- "Lativan", which is wrong twice over. Issuing country is left as
-- Aegir holds it (Latvia) — a Russian national on a Latvian-issued
-- document is the usual non-citizen's passport, but only the
-- nationality was confirmed against the document, so the issuing
-- country is still Aegir's word and worth a glance.
insert into public.crew
  (fleet_id, full_name, status, crew_type, rank_code, nationality,
   date_of_birth, place_of_birth, passport_number, passport_expiry,
   passport_country, embarked_date, familiarised_items_done,
   familiarised_items_total)
select (select id from public.fleets where name='AUDACIOUS BF83'),
       'Andrejs Gundarovs', 'on_boat', 'contracted', 'chief_engineer', 'Russian',
       date '1967-07-05', 'Krievija, Russia', 'LZ4181918', date '2033-09-07',
       'Latvia', date '2026-07-13', 0, 42
 where not exists (
   select 1 from public.crew
    where full_name='Andrejs Gundarovs'
      and fleet_id=(select id from public.fleets where name='AUDACIOUS BF83'));


-- ---- 2. The John Binggan / John Gabriel duplicate -------------------
-- Confirmed one man. It turned out not to need a merge at all: the
-- "John Gabriel" row referenced NOTHING — no contract, landing,
-- closeout, bonus, payment or certificate. Every bit of his history
-- (3 contracts, 81 landings, 24 closeouts, 2 bonuses, 30 payments)
-- was already on "John Binggan", which now also holds the passport.
-- So the duplicate is simply dropped; no history moved, none at risk.
delete from public.crew
 where id = '22bbca86-9786-4640-9a61-2f95c4832f75'
   and not exists (select 1 from public.contracts where crew_id = public.crew.id)
   and not exists (select 1 from public.landing_crew where crew_id = public.crew.id)
   and not exists (select 1 from public.payments where crew_id = public.crew.id)
   and not exists (select 1 from public.month_closeouts where crew_id = public.crew.id)
   and not exists (select 1 from public.one_off_bonuses where crew_id = public.crew.id)
   and not exists (select 1 from public.crew_certificates where crew_id = public.crew.id);

-- His name is still the short "John Binggan". Aegir has him as
-- "John Gabriel Binggan", which is what a passport and a crew list
-- want. Renaming was not asked for, so it was not done.


-- ---- 3. William Gatt ------------------------------------------------
-- Not in Aegir, and referenced nothing anywhere. Dropped.
delete from public.crew
 where id = 'a400880b-8d31-4b8c-969b-400f2c95af4f'
   and not exists (select 1 from public.contracts where crew_id = public.crew.id)
   and not exists (select 1 from public.landing_crew where crew_id = public.crew.id)
   and not exists (select 1 from public.payments where crew_id = public.crew.id)
   and not exists (select 1 from public.month_closeouts where crew_id = public.crew.id)
   and not exists (select 1 from public.one_off_bonuses where crew_id = public.crew.id)
   and not exists (select 1 from public.crew_certificates where crew_id = public.crew.id);


-- ---- 4. Arnel Nobel — NOT deleted -----------------------------------
-- Asked for, deliberately not done, because he is not an empty row
-- like the other two. He carries:
--     3 contracts · 95 landing_crew · 29 month closeouts
--     34 payments · 1 certificate
--
-- contracts, landing_crew, month_closeouts and payments are all
-- ON DELETE RESTRICT, so the delete would have been refused anyway.
-- Forcing it through would mean deleting 34 payments and 29 month
-- closeouts — his settled share of real landings, and part of the
-- figures those months already reported.
--
-- He is already status 'former' and archived 07-08-2026, which is
-- exactly what this app uses to retire a crewman while keeping the
-- books intact. Nothing further is needed to get him off the crew
-- lists. Say the word if he should genuinely be erased and it can be
-- done as a deliberate, separate job with the history dealt with
-- first — it is not a side effect of a tidy-up.
--
-- Worth noting: crew_certificates, rota_holidays and rota_trip_crew
-- are ON DELETE CASCADE. Deleting any crewman silently takes their
-- certificates with them.


-- ============================================================
-- VERIFY
-- ============================================================
select count(*) as rows,                                    -- expect 19
       count(passport_number) as with_passport,             -- expect 18
       count(*) filter (where status='on_boat') as aboard    -- expect 11
  from public.crew
 where fleet_id=(select id from public.fleets where name='AUDACIOUS BF83');

-- Arnel Nobel is the only crewman with no passport.
select full_name, status from public.crew
 where fleet_id=(select id from public.fleets where name='AUDACIOUS BF83')
   and passport_number is null;
