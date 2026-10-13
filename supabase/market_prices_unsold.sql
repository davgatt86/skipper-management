-- THE BOARD SAYS "Unsold" AND THE RECORD HAD NOWHERE TO PUT IT (Oct 2026)
--
-- Peterhead prints the word in a price column where a grade did not clear:
--
--     Hadd Chipper | A4 | Unsold | £2.35 | £1.75
--
-- `parseMarket` dropped it into the species label, which lost the subgrade,
-- invented a species where the label was unknown, and left `low` null — so a
-- grade that did not sell and a figure nobody printed rendered identically.
-- The parser fix is in src/lib/market/parseMarket.js; this is the column it
-- needs. David: "chipper, metro, round are unsold. system doesn't say that."
--
-- NULLABLE, AND DELIBERATELY NOT `default false`.
--
-- Three states, which is the point:
--
--     true   the sheet said Unsold
--     false  the sheet was read for it and did not
--     null   the row was filed before any of this, and nobody knows
--
-- `not null default false` would have been one word shorter and would assert
-- about every one of the ~60,000 historical rows that its grade cleared the
-- market. 359 of them did not. A default that is wrong 359 times is worse
-- than an honest blank, and it is the same rule as a quota line with no
-- allocation not being scored at nought.
--
-- NOTHING IS BACKFILLED HERE, and the reason is worth keeping. A null low
-- beside a real high or ave is a near-perfect fingerprint of a lost "Unsold"
-- — on Haddock A4 it is 145 rows out of 145 — so marking those `true` would
-- be defensible. What is NOT recoverable is WHICH subgrade each row was:
-- chipper, metro and round all collapsed to a bare "Haddock A4", and the only
-- way back is the price ladder (chipper dearest, round cheapest). Measured
-- over the 737 days that still carry their subgrades, that ladder breaks on
-- 36 of them — 5%. A backfill wrong one day in twenty, written in as fact and
-- indistinguishable afterwards from a real reading, is not worth having.
-- Re-reading the sheets is the only honest repair, and it is David's call.

alter table public.market_prices
  add column if not exists unsold boolean;

comment on column public.market_prices.unsold is
  'The board printed "Unsold" against this grade. NULL means the row predates '
  'the reading of that word (before Oct 2026) and is not a claim that it sold.';
