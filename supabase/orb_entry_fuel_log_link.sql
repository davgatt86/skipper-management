-- Tie an Oil Record Book entry to the fuel log movement it was raised from.
--
-- David: "can we link the fuel/oil and ORB? so entry into 1 puts entry into
-- other?"
--
-- ONE DIRECTION ONLY, fuel log -> ORB. The reverse would have to invent the
-- supplier, the grade and the price the fuel loop is built on, none of which
-- the regulation asks the book to carry.
--
-- AND IT OFFERS, IT DOES NOT WRITE. Three reasons, and the first is in this
-- schema already:
--
--   1. `officer_name` is NOT NULL. Reg 20 requires each operation to be signed
--      by the officer in charge of it, and the column enforces it — so the book
--      CANNOT hold an unsigned entry, and filling that box automatically is the
--      app signing a statutory record on somebody's behalf.
--   2. An ORB entry can never be edited or deleted; there is no update or
--      delete policy and the grants are revoked. A litres typo corrected in the
--      working log an hour later would become a permanent CORRECTING ENTRY in a
--      legal book — a paper trail of a mistake the fuel log never really made.
--   3. Item 26.3 wants "identity of tank(s) ... quantity added and total content
--      of tank(s)". The fuel log has no tank column at all, so a derived entry
--      would be incomplete on exactly the part that makes it compliant.
--
-- So the link carries a DRAFT to the officer, who names himself and fills in the
-- tank. What the column buys is that the offer is made once, and that the book
-- can be reconciled against the log — which is the half that catches a gap
-- whether or not anybody presses the button.
alter table public.oil_record_book_entries
  add column if not exists fuel_log_id uuid
    references public.vessel_fuel_log(id) on delete set null;

-- ON DELETE SET NULL, never cascade: deleting a working log row must not reach
-- into the Oil Record Book. The entry stands on its own once it is made — that
-- is the whole point of the book.
create index if not exists orb_entries_fuel_log_idx
  on public.oil_record_book_entries(fuel_log_id) where fuel_log_id is not null;

comment on column public.oil_record_book_entries.fuel_log_id is
  'The vessel_fuel_log movement this entry was raised from, where it was. Null '
  'for an entry written straight into the book. Never used to edit the entry: '
  'the book is immutable and corrections are made by a further entry.';
