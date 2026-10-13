-- A SWAP IS DATED, AND A STATEMENT PAST THAT DATE ALREADY CONTAINS IT
--
-- David, Oct 2026: "statements are true positions, all swap/rents are on
-- statements. so a swap/rent should be dated, if statement is after date
-- inputted they disppear as they are now included in statement."
--
-- `quota_adjustments` had no date of any kind. It carried `year`, `stock`,
-- `direction`, `tonnes` and a `created_at` that records when the row was
-- TYPED — not when the swap was agreed, and not anything the position maths
-- could compare against a statement. So `buildPosition` filtered them on year
-- alone and added every one on top of whatever statement was loaded.
--
-- THE DOUBLE COUNT IS NOT HYPOTHETICAL. Audacious's own 22 adjustments, as
-- they stood before the 08-10 reset, were typed between 10-06 and 15-09-2026
-- — Lockers, 60 N Fishing Ltd, Avrella LK, SQ, AQ, Flex, all real trades —
-- and the statement on file is as at 30-09-2026. Every one of the 22 predates
-- it. The statement itself carries 120 tonnes of swaps across 3 of its lines
-- in `quota_lines.swaps`, so they are demonstrably in there already.
--
-- NULLABLE, THOUGH THE FORM REQUIRES IT. Nothing should fail at the database
-- over a missing date, and an undated adjustment is a real third state: it
-- cannot be told whether the statement includes it. The maths counts it (the
-- behaviour it has always had) and the page flags it for a date, rather than
-- dropping it silently — which would move the position with no explanation —
-- or assuming it is covered, which would lose a real trade.
--
-- There is nothing to backfill: 0 adjustment rows exist across every fleet,
-- the 22 having gone in the reset and deliberately not been restored. They
-- would need dating before they are worth anything, and the date of each is
-- David's to give — `created_at` is when he typed it, which is a different
-- fact and not one to launder into this column.

alter table public.quota_adjustments
  add column if not exists effective_date date;

comment on column public.quota_adjustments.effective_date is
  'The day the swap or rental took effect. An adjustment on or before a '
  'statement''s last_landing_date is already inside that statement and is not '
  'added again. NULL means undated - still counted, and flagged on the page.';
