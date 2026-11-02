-- WHERE A LANDING'S DATE CAME FROM (Nov 2026)
--
-- A Don note prints TWO dates and they are different facts:
--
--   LANDING DATE   in the port line, with a month name: "Landed Peterhead
--                  20-May-2026". This is what `landing_date` has always held.
--   DATE SOLD      at the top, plain figures: "DATE SOLD 02/11/26". On every
--                  note the office has ever sent, back to 2023.
--
-- Measured over the 107 real Don notes on disk that carry both, they agree on
-- only 57. The other 50 are 1 to 10 days apart. So the sold date is NOT the
-- landing date and must never silently stand in for it.
--
-- But on 02-11-2026 Don printed Boy John's and Rosebloom's notes with the
-- LANDING DATE box EMPTY, and a blank date is not a safe resting state: an
-- undated landing takes the RETIRED haddock ladder (haddockSpec reads
-- '' >= '2026-10-20' as false), drops out of every date view, and cannot be
-- corrected anywhere, because nothing in the app writes landing_date.
--
-- So the sold date is used where the landing-date box is blank, and this
-- column says that it was. That is the whole difference from the invoice
-- work-date failure already written up in CLAUDE.md: there, a copied date was
-- indistinguishable from one read off the document.
--
--   'landed'  read off the note's own LANDING DATE box
--   'sold'    the box was blank; this is DATE SOLD standing in
--   null      filed before this column existed, or no date at all
--
-- NULL IS NOT BACKFILLED. Every one of the 402 landings already filed got its
-- date from the landing-date box, so 'landed' would be true of them -- but the
-- only question anything asks of this column is "was it substituted?", and
-- null answers that as well as 'landed' does. A backfill would be asserting
-- something about notes nobody re-read.

alter table public.sales_landings
  add column if not exists date_basis text;

alter table public.sales_landings
  drop constraint if exists sales_landings_date_basis_chk;

alter table public.sales_landings
  add constraint sales_landings_date_basis_chk
  check (date_basis is null or date_basis in ('landed', 'sold'));

comment on column public.sales_landings.date_basis is
  'Where landing_date came from: landed = the note''s LANDING DATE box, sold = DATE SOLD standing in because that box was blank, null = filed before this column existed.';
