-- THE OIL RECORD BOOK PART I -- machinery space operations.
-- Applied Sep 2026 as three migrations: oil_record_book,
-- oil_record_book_revoke_update_delete, oil_record_book_items_lookup.
--
-- SHE NEEDS ONE. Regulation 20 of the Merchant Shipping (Prevention of Oil
-- Pollution) Regulations 2019 requires an Oil Record Book Part I on every ship
-- of 400 GT and above other than an oil tanker. AUDACIOUS BF83 is 498 GT.
-- The Fuel & Oil Log already in this app is NOT one: it is a bunkering record,
-- with no codes, no officer's signature and no master's signature.
--
-- THE FORM IS PRESCRIBED. Every entry is a code letter (A-I) and an item
-- number out of Appendix III to MARPOL Annex I. Free text belongs in code (I)
-- and nowhere else.
--
-- NOTHING HERE MAY EVER BE EDITED OR DELETED, and that is the whole reason
-- this is a table of its own rather than another log. On paper a wrong entry
-- is struck through and initialled; in an electronic book it is corrected by a
-- FURTHER entry pointing at it (`corrects_entry_id`). So the entries table has
-- NO update policy and NO delete policy at all.
--
-- AND POLICIES ARE NOT ENOUGH ON THEIR OWN. Supabase's default ACL grants
-- `arwdDxtm` on every new table in `public` to `authenticated` -- the absence
-- of a policy is the only thing normally standing in the way, and one careless
-- `for all` policy added later would open both. The grants are revoked below
-- as well, so it takes two mistakes rather than one.


-- 1. The prescribed item list, as a table ----------------------------------
-- The same 41 pairs are in `src/lib/certification/orb.js`, and this is a
-- second copy of them, which this repo has been bitten by before. It is here
-- because JS validation is not a constraint: the first probe of this schema
-- wrote `C/99.9` -- a code and item the form does not have -- straight into
-- the book, and nothing stopped it.
--
-- `test-certification.mjs` asserts the JS list is exactly these 41 pairs, so
-- editing one without the other fails the suite rather than drifting quietly.
create table if not exists public.orb_items (
  code   text not null check (code in ('A','B','C','D','E','F','G','H','I')),
  item_n text not null,
  primary key (code, item_n)
);

insert into public.orb_items (code, item_n) values
  ('A','1'),('A','2'),('A','3.1'),('A','3.2'),('A','3.3'),('A','4.1'),('A','4.2'),
  ('B','5'),('B','6'),('B','7'),('B','8'),('B','9.1'),('B','9.2'),('B','10'),
  ('C','11.1'),('C','11.2'),('C','11.3'),('C','11.4'),
  ('C','12.1'),('C','12.2'),('C','12.3'),('C','12.4'),
  ('D','13'),('D','14'),('D','15.1'),('D','15.2'),('D','15.3'),
  ('E','16'),('E','17'),('E','18'),
  ('F','19'),('F','20'),('F','21'),
  ('G','22'),('G','23'),('G','24'),('G','25'),
  ('H','26.1'),('H','26.2'),('H','26.3'),('H','26.4')
on conflict do nothing;

alter table public.orb_items enable row level security;
drop policy if exists orb_items_read on public.orb_items;
create policy orb_items_read on public.orb_items
  for select to authenticated using (auth.uid() is not null);
revoke insert, update, delete on public.orb_items from authenticated, anon;
grant select on public.orb_items to authenticated;


-- 2. Pages -----------------------------------------------------------------
-- A PAGE IS A REAL UNIT BECAUSE THE LAW SAYS SO: reg 20 requires that "each
-- completed page must be signed by the master". Software would not invent
-- pagination for a table; it is here because the record has to carry a second
-- signature at a level above the entry.
create table if not exists public.oil_record_book_pages (
  id                 uuid primary key default gen_random_uuid(),
  fleet_id           uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id          uuid not null,
  page_no            integer not null,
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  master_signed_by   uuid references public.app_users(id),
  master_signed_name text,
  master_signed_at   timestamptz,
  created_at         timestamptz not null default now(),
  constraint orb_pages_one_per_no unique (vessel_id, page_no),
  -- A page cannot be signed before it is closed. Signing an open page would
  -- let entries be added under a signature already given.
  constraint orb_pages_signed_is_closed check (master_signed_at is null or closed_at is not null),
  -- The cross-tenant hole closed on the other twenty tables: fleet_isolation
  -- checks fleet_id, and nothing otherwise checks the boat is in that fleet.
  constraint orb_pages_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);


-- 3. Entries ---------------------------------------------------------------
create table if not exists public.oil_record_book_entries (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id     uuid not null,
  page_id       uuid not null references public.oil_record_book_pages(id),
  entry_date    date not null,
  code          text not null check (code in ('A','B','C','D','E','F','G','H','I')),
  item_n        text,
  narrative     text,
  quantity      numeric,
  unit          text,
  tank          text,
  position_text text,
  port          text,
  started_at    timestamptz,
  stopped_at    timestamptz,
  -- Reg 20: each entry is "signed-off by the officer or officers in charge of
  -- that operation". A NAME, not merely a login -- the man in charge of the
  -- operation is not always the man holding the tablet.
  officer_name  text not null,
  recorded_by   uuid references public.app_users(id),
  recorded_at   timestamptz not null default now(),
  -- THE ONLY WAY TO PUT A WRONG ENTRY RIGHT. Nothing is ever edited.
  corrects_entry_id uuid references public.oil_record_book_entries(id),
  -- Code (I) is the remarks code and the only one carrying no item number.
  constraint orb_entries_item_matches_code
    check ((code = 'I' and item_n is null) or (code <> 'I' and item_n is not null)),
  constraint orb_entries_officer_named check (length(btrim(officer_name)) > 1),
  constraint orb_entries_item_is_prescribed foreign key (code, item_n)
    references public.orb_items (code, item_n),
  constraint orb_entries_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);

create index if not exists orb_entries_page_idx on public.oil_record_book_entries (page_id, entry_date);
create index if not exists orb_entries_vessel_idx on public.oil_record_book_entries (vessel_id, entry_date);


-- 4. RLS -------------------------------------------------------------------
alter table public.oil_record_book_pages   enable row level security;
alter table public.oil_record_book_entries enable row level security;

-- A new table is open to every tenant from the moment it exists unless this is
-- written first, because none of the permissive policies in this database
-- carries a fleet check of its own.
drop policy if exists fleet_isolation_orb_pages on public.oil_record_book_pages;
create policy fleet_isolation_orb_pages on public.oil_record_book_pages
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

drop policy if exists fleet_isolation_orb_entries on public.oil_record_book_entries;
create policy fleet_isolation_orb_entries on public.oil_record_book_entries
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

-- The reader is an ALLOW-LIST OF ROLES, so a role added later (the cook was)
-- sees nothing until somebody decides it should. That is the safe direction.
drop policy if exists orb_pages_read on public.oil_record_book_pages;
create policy orb_pages_read on public.oil_record_book_pages
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

drop policy if exists orb_entries_read on public.oil_record_book_entries;
create policy orb_entries_read on public.oil_record_book_entries
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

drop policy if exists orb_pages_ins on public.oil_record_book_pages;
create policy orb_pages_ins on public.oil_record_book_pages
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role in ('skipper','officer','engineer'))
    and master_signed_at is null);

-- AN ENTRY MAY ONLY BE MADE ON AN OPEN PAGE. Once the master has signed, that
-- page is what he signed; adding to it afterwards would put an entry under a
-- signature nobody gave it.
drop policy if exists orb_entries_ins on public.oil_record_book_entries;
create policy orb_entries_ins on public.oil_record_book_entries
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role in ('skipper','officer','engineer'))
    and exists (select 1 from public.oil_record_book_pages p
                where p.id = page_id and p.master_signed_at is null));

-- Closing a page is the engineer's; signing it is the master's, and reg 20
-- names the master specifically. Two policies rather than one because they are
-- two different acts by two different people.
drop policy if exists orb_pages_close on public.oil_record_book_pages;
create policy orb_pages_close on public.oil_record_book_pages
  for update to authenticated
  using (exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role in ('officer','engineer'))
         and master_signed_at is null)
  with check (master_signed_at is null);

drop policy if exists orb_pages_sign on public.oil_record_book_pages;
create policy orb_pages_sign on public.oil_record_book_pages
  for update to authenticated
  using (exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role = 'skipper')
         and master_signed_at is null)
  with check (exists (select 1 from public.app_users u
                      where u.id = auth.uid() and u.role = 'skipper'));

-- NO UPDATE POLICY AND NO DELETE POLICY ON ENTRIES. Deliberate, and the
-- strongest form of MEPC.312(74)'s requirement that entries be protected from
-- deletion. A page is never deleted either: it is the thing the master signed.


-- 5. And revoke the privileges the policies are only standing in front of ---
-- Supabase grants all of `arwdDxtm` to `authenticated` on a new table. Without
-- this, one `for all` policy written here in a year's time re-opens both.
revoke update, delete on public.oil_record_book_entries from authenticated, anon;
revoke delete on public.oil_record_book_pages from authenticated, anon;
grant select, insert on public.oil_record_book_entries to authenticated;
grant select, insert, update on public.oil_record_book_pages to authenticated;


-- 6. Audited, like the other books ------------------------------------------
-- An entry can never change, so the trail here records who wrote what and when
-- rather than who altered it -- which is what an inspector actually asks.
drop trigger if exists audit_orb_pages on public.oil_record_book_pages;
create trigger audit_orb_pages
  after insert or update or delete on public.oil_record_book_pages
  for each row execute function public.audit_trigger();

drop trigger if exists audit_orb_entries on public.oil_record_book_entries;
create trigger audit_orb_entries
  after insert or update or delete on public.oil_record_book_entries
  for each row execute function public.audit_trigger();


-- 7. officer_role.sql and cook_role.sql ------------------------------------
-- All three tables are in officer_role.sql's allow-list -- in the deny loop
-- and in the 2b cleanup, and deliberately NOT in its officer_works loop, which
-- grants ALL and would hand back the update and delete this file spent two
-- sections taking away. cook_role.sql needs no edit: the cook is denied by not
-- appearing in the read policies above.
