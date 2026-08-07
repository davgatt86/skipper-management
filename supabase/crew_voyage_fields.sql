-- ============================================================
-- Crew record: the fields a crew list actually needs.
--
-- Run in the Supabase SQL editor. Additive only — adds columns
-- and a lookup table, changes no existing row's meaning.
--
-- WHY
--   The Crew List page shows "no passport on file" against every
--   crewman and defaults everyone to Deckhand, because rank and
--   passport are not on the crew record at all. A crew list is a
--   border document; it cannot be produced from what we hold.
--
--   Aegir already holds rank, nationality, passport number and
--   expiry for the crew aboard. This is where that lands.
--
-- NOTE
--   crew already has nationality, passport_country and
--   passport_expiry from crew_lists_and_vessel.sql, plus
--   passport_number. They are simply never populated or shown.
--   This adds what is genuinely missing rather than duplicating.
-- ============================================================


-- ---- 1. Rank ---------------------------------------------------------
-- Stored on the crewman, not re-picked every voyage. A lookup table
-- rather than free text, so the crew list cannot end up with "deckhand",
-- "Deck Hand" and "DH" as three ranks — the same mistake Aegir's
-- certificate matrix makes by keying off a typed name.
create table if not exists public.crew_ranks (
  code  text primary key,
  label text not null,
  sort  integer not null default 0
);

insert into public.crew_ranks (code, label, sort) values
  ('master',          'Master',          10),
  ('skipper',         'Skipper',         20),
  ('mate',            'Mate',            30),
  ('chief_engineer',  'Chief Engineer',  40),
  ('second_engineer', '2nd Engineer',    50),
  ('bosun',           'Bosun',           60),
  ('deckhand',        'Deckhand',        70),
  ('cook',            'Cook',            80),
  ('trainee',         'Trainee',         90),
  ('other',           'Other',          100)
on conflict (code) do nothing;

grant select on public.crew_ranks to authenticated;
-- A shared lookup, identical for every fleet, so no RLS: nothing in it
-- is anyone's data.

alter table public.crew
  add column if not exists rank_code text references public.crew_ranks(code);


-- ---- 2. Passport -----------------------------------------------------
-- passport_number / passport_country / passport_expiry already exist.
-- Only the issuing place is missing, which the FAL 5 form asks for.
alter table public.crew
  add column if not exists passport_issued_at text;


-- ---- 3. Embarked -----------------------------------------------------
-- When this crewman last joined the vessel. Lets "days on board" be
-- derived rather than counted by hand, and drives the crew list.
alter table public.crew
  add column if not exists embarked_date date;


-- ---- 4. Familiarisation ---------------------------------------------
-- Aegir tracks a 42-item safety induction per crewman. The item list has
-- not been seen yet, so this stores the outcome only — enough to show
-- progress and flag who has not started. The itemised checklist can be
-- added later without changing this.
alter table public.crew
  add column if not exists familiarised_at date;
alter table public.crew
  add column if not exists familiarised_items_done integer;
alter table public.crew
  add column if not exists familiarised_items_total integer;


-- ============================================================
-- VERIFY
-- ============================================================
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'crew'
   and column_name in ('rank_code','nationality','passport_number','passport_country',
                       'passport_expiry','passport_issued_at','embarked_date',
                       'familiarised_at','familiarised_items_done','familiarised_items_total')
 order by column_name;
-- expect 10 rows

select count(*) as ranks from public.crew_ranks;   -- expect 10

-- Nothing lost: every crewman still here, none altered.
select count(*) as crew_rows,
       count(rank_code) as with_rank,          -- expect 0 until migrated
       count(passport_number) as with_passport -- expect 0 until migrated
  from public.crew;


-- ============================================================
-- ROLLBACK
--   alter table public.crew
--     drop column if exists rank_code,
--     drop column if exists passport_issued_at,
--     drop column if exists embarked_date,
--     drop column if exists familiarised_at,
--     drop column if exists familiarised_items_done,
--     drop column if exists familiarised_items_total;
--   drop table if exists public.crew_ranks;
-- ============================================================
