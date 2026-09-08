-- THE OFFICIAL LOG BOOK.
-- Applied Sep 2026 as migration `official_log_book`.
--
-- The Merchant Shipping (Official Log Books) (Fishing Vessels) Regulations
-- 1981, SI 1981/570. Required of every UK fishing vessel of 55 feet and over;
-- AUDACIOUS BF83 is 29.80 m, about 98 feet.
--
-- FIVE OF THE SEVEN RECORDS DAVID LISTED ARE THIS ONE BOOK. He named drills,
-- emergency steering tests, accommodation cleanliness checks, provisions and
-- fresh water, and the record of accidents as separate things -- because on
-- paper they are separate pages. They are entries 7, 21, 17, 18 and 9/32 of
-- the same Schedule.
--
-- NOTHING IS EVER ERASED. Reg 9: an entry that "is inaccurate or incomplete"
-- is put right by making and signing "a FURTHER ENTRY referring to the entry
-- and amending or cancelling it". Same as the Oil Record Book, and the same
-- answer: no update policy, no delete policy, and the grants revoked as well,
-- because Supabase hands `arwdDxtm` to `authenticated` on every new table and
-- an absent policy is not on its own a lock.

-- 1. The prescribed entry numbers, as a table -------------------------------
-- Second copy of the list in src/lib/certification/olb.js, and deliberately
-- so: JS validation is not a constraint. The first probe of the ORB schema
-- wrote a code and item the form does not have straight into the book, which
-- is why that one gained the same lookup. test-certification.mjs asserts the
-- JS list is exactly these 33 and that the seven `in_person` ones match.
create table if not exists public.olb_items (
  entry_n   int primary key check (entry_n between 1 and 33),
  in_person boolean not null default false,
  witness   text
);

insert into public.olb_items (entry_n, in_person, witness) values
  (1,false,null),(2,false,null),(3,false,null),
  (4,true,null),(5,false,null),(6,false,null),
  (7,false,'a member of the crew'),(8,false,'a member of the crew'),
  (9,false,'a member of the crew'),(10,false,'a member of the crew'),
  (11,true,'a member of the crew'),(12,false,null),
  (13,false,'a member of the crew'),(14,true,'a member of the crew where the skipper signs'),
  (15,false,'a member of the crew'),(16,false,'a member of the crew'),
  (17,false,'a member of the crew'),(18,false,null),(19,false,null),
  (20,false,'an officer'),(21,false,'an officer'),
  (22,false,'one of the seamen'),(23,false,'the seaman'),
  (24,true,'a member of the crew'),(25,false,'a member of the crew'),
  (26,false,'a member of the crew'),(27,false,'a member of the crew'),
  (28,true,'the mother of the child'),(29,true,'a member of the crew'),
  (30,true,'a member of the crew'),(31,false,null),
  (32,false,'a member of the crew'),(33,false,null)
on conflict (entry_n) do update
  set in_person = excluded.in_person, witness = excluded.witness;

alter table public.olb_items enable row level security;
drop policy if exists olb_items_read on public.olb_items;
create policy olb_items_read on public.olb_items
  for select to authenticated using (auth.uid() is not null);
revoke insert, update, delete on public.olb_items from authenticated, anon;
grant select on public.olb_items to authenticated;


-- 2. The books --------------------------------------------------------------
-- A BOOK IS OPENED AND CLOSED and then delivered to the superintendent or
-- proper officer within 48 hours -- entries 5 and 6 record exactly that, and
-- reg 8 says "no entry shall be made in an official log book after" it goes.
-- So the book is a real unit with a life, not a filing convenience.
create table if not exists public.official_log_books (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id     uuid not null,
  book_no       text,
  opened_on     date not null,
  opened_place  text,
  closed_on     date,
  closed_place  text,
  delivered_on  date,
  delivered_to  text,
  created_at    timestamptz not null default now(),
  constraint olb_books_closed_after_open check (closed_on is null or closed_on >= opened_on),
  constraint olb_books_delivered_is_closed check (delivered_on is null or closed_on is not null),
  constraint olb_books_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);


-- 3. The entries ------------------------------------------------------------
create table if not exists public.official_log_book_entries (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id    uuid not null,
  book_id      uuid not null references public.official_log_books(id),
  entry_n      int not null references public.olb_items(entry_n),
  occurred_on  date not null,
  occurred_at_place text,
  narrative    text,
  -- WHO SIGNED IT, as a NAME. The Schedule names a person for every entry --
  -- the skipper, the person making the inspection, the proper officer -- and
  -- an app_users id cannot stand for a superintendent who has no login here.
  signed_name  text not null,
  -- Ordinarily "an entry which is to be signed by the skipper may ... be
  -- signed by an officer authorised by the skipper". On the seven marked
  -- `in_person` it may not, and this column is what makes that checkable.
  signed_by_officer boolean not null default false,
  witness_name text,
  recorded_by  uuid references public.app_users(id),
  recorded_at  timestamptz not null default now(),
  -- Reg 9. The ONLY way to put a wrong entry right.
  corrects_entry_id uuid references public.official_log_book_entries(id),
  constraint olb_entries_signed check (length(btrim(signed_name)) > 1),
  constraint olb_entries_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);

create index if not exists olb_entries_book_idx
  on public.official_log_book_entries (book_id, occurred_on);


-- 4. RLS --------------------------------------------------------------------
alter table public.official_log_books enable row level security;
alter table public.official_log_book_entries enable row level security;

drop policy if exists fleet_isolation_olb_books on public.official_log_books;
create policy fleet_isolation_olb_books on public.official_log_books
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

drop policy if exists fleet_isolation_olb_entries on public.official_log_book_entries;
create policy fleet_isolation_olb_entries on public.official_log_book_entries
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

-- An ALLOW-LIST OF ROLES, so a role added later sees nothing until somebody
-- decides it should. The cook is denied by not appearing here.
drop policy if exists olb_books_read on public.official_log_books;
create policy olb_books_read on public.official_log_books
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

drop policy if exists olb_entries_read on public.official_log_book_entries;
create policy olb_entries_read on public.official_log_book_entries
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

-- OPENING AND CLOSING A BOOK IS THE SKIPPER'S. Entries 1-3, 5 and 6 are all
-- signed by him, and closing it is what sends it to the superintendent.
drop policy if exists olb_books_ins on public.official_log_books;
create policy olb_books_ins on public.official_log_books
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists olb_books_close on public.official_log_books;
create policy olb_books_close on public.official_log_books
  for update to authenticated
  using (exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from public.app_users u
                      where u.id = auth.uid() and u.role = 'skipper'));

-- AN ENTRY MAY ONLY BE MADE IN AN OPEN BOOK. Reg 8 again: nothing goes in
-- after it has been closed and delivered. The mate writes the book -- he does
-- not open or close it.
drop policy if exists olb_entries_ins on public.official_log_book_entries;
create policy olb_entries_ins on public.official_log_book_entries
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role in ('skipper','officer','engineer'))
    and exists (select 1 from public.official_log_books b
                where b.id = book_id and b.closed_on is null));

-- NO UPDATE POLICY AND NO DELETE POLICY ON ENTRIES, and none on a book either
-- beyond closing it. Reg 9 allows one thing only: a further entry.
revoke update, delete on public.official_log_book_entries from authenticated, anon;
revoke delete on public.official_log_books from authenticated, anon;
grant select, insert on public.official_log_book_entries to authenticated;
grant select, insert, update on public.official_log_books to authenticated;


-- 5. Audited ----------------------------------------------------------------
drop trigger if exists audit_olb_books on public.official_log_books;
create trigger audit_olb_books
  after insert or update or delete on public.official_log_books
  for each row execute function public.audit_trigger();

drop trigger if exists audit_olb_entries on public.official_log_book_entries;
create trigger audit_olb_entries
  after insert or update or delete on public.official_log_book_entries
  for each row execute function public.audit_trigger();


-- PROBED, not inspected -----------------------------------------------------
--   officer cannot open a book | skipper opened a book | officer made entry 7
--   | entry 99 refused by the database | entry edit refused | entry delete
--   refused | cook reads entries 0 | cook reads books 0 | skipper closed the
--   book | entry in a closed book refused | entries surviving 1 | items 33
--
-- All three tables are in officer_role.sql's allow-list -- the deny loop and
-- the 2b cleanup -- and deliberately NOT in its officer_works loop, which
-- grants ALL and would hand back the update and delete this file removes.
-- cook_role.sql needs no edit: the cook is denied by not appearing in the read
-- policies above.
