-- DENMARK'S ROUND MARKER WAS BEING LOST — repair what can be read back.
--
-- David, Oct 2026: *"denmark label round as u/r."* `u/` is Danish *uden*,
-- without, and it is written after the species on the fiskeauktion sheet:
-- "Whiting u/r", "Catfish u/h", "Piked dogfish u/r".
--
-- The parser read the whole label as the species, so the marker went one of
-- two ways and both were wrong:
--
--   left on    `Whiting u/r` became a species of its own and never grouped
--              with whiting. 2 rows.
--   welded off `DK_SPECIES` carried 'flounder u/r' -> 'Flounder' and
--              'piked dogfish u/r' -> 'Dogfish', so the marker was dropped
--              and round went into the same line as gutted.
--
-- `marketCanon.dkSpeciesAndPresentation` splits it off now and it is stored in
-- `subgrade`, the way Peterhead's `A4 Round` is — so a round line keys apart
-- from its own gutted one on both boards. This file repairs the rows already
-- filed.

begin;

-- 1. THE LABEL IS STILL ON THE ROW, so these are read back rather than guessed.
update public.market_prices
   set species = 'Whiting', subgrade = 'Round'
 where source = 'DK' and species = 'Whiting u/r';

-- `u/h` is most likely *uden hoved*, headed. MOST LIKELY IS NOT GOOD ENOUGH to
-- write into a price record, so the marker is kept verbatim — the same rule the
-- parser follows for anything but u/r.
update public.market_prices
   set species = 'Catfish', subgrade = 'u/h'
 where source = 'DK' and species = 'Catfish u/h';

commit;

-- 2. WHAT CANNOT BE REPAIRED, AND WHY — 103 rows, deliberately left alone.
--
-- DOGFISH, 80 rows. The old map held 'piked dogfish u/r' and no plain entry,
-- so a label of "Piked dogfish" would have fallen through verbatim and the
-- record holds no such species — which reads as evidence that every one of the
-- 80 is round. It is not quite: a bare "Dogfish" on the sheet would ALSO have
-- fallen through to exactly "Dogfish" and be indistinguishable today. The
-- Danish sheet writes full names (Atlantic halibut, Common dab, Greater
-- forkbeard), so a bare "Dogfish" is unlikely — but unlikely is not a reason
-- to stamp 80 rows.
--
-- FLOUNDER, 23 rows. Worse: there was never a plain 'flounder' entry either,
-- so "Flounder" and "Flounder u/r" both produced "Flounder". Nothing on the
-- row can tell them apart.
--
-- Settle it by looking at one real fiskeauktion sheet and reading what the
-- species column actually says. If it is always "Piked dogfish u/r":
--
--   update public.market_prices set subgrade = 'Round'
--    where source = 'DK' and species = 'Dogfish' and price_date <= '2026-10-22';
--
-- Everything filed after that date comes through the fixed parser and needs
-- nothing.
