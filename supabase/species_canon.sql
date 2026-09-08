-- CANONICALISING THE SPECIES NAMES ON THE RECORD.
-- Applied Sep 2026 as migration `species_canon_backfill`.
--
-- David: "canonicalise the species names first. lythe is pollock. cats are
-- catfish."
--
-- The ninth outing for the pattern this repo keeps meeting -- after crew
-- ranks, fuel suppliers, vessel labels, buyer names, the quantity notation,
-- stores units, pack sizes and invoice suppliers. The species column carried
-- 57 distinct names for about 35 fish.
--
-- IT WAS FOUND BY TRYING TO BUILD SOMETHING ON IT. The dashboard is to show a
-- boat's own top six species against the market board, and Guiding Light had
-- WHITING TWICE -- "Whiting" and "Whiting (round)" -- which cost her a slot in
-- her own top six. Nobody would have noticed by reading the list.
--
-- ONLY `species_canon` IS TOUCHED. `species` is the raw text off the note and
-- stays exactly as the note said it -- the same discipline as keeping the
-- printed figures beside a converted invoice: the canonical name is derived,
-- and what the document actually said is still there to check it against.
--
-- The map matches SPECIES_CANON in src/lib/parse-core.cjs 1.3.6, so every note
-- ingested from here on lands canonicalised and this is the history.
--
-- AFTER: 57 distinct names -> 38. Value GBP 31,540,601.95 and 10,448,773 kg
-- both UNCHANGED, and no row left with a blank canon.
--
-- FOUR NAMES ARE DELIBERATELY LEFT ALONE, because nobody has ruled on them:
--   H            Beryl, 44 t, GBP 218,468, grades A1-A4 plus U1/U9. It prices
--                and grades like hake. That is not the same as knowing, and
--                welding it onto the wrong fish is unrecoverable once the note
--                that would tell them apart is filed.
--   Spot/Spott   Audacious, 10 rows, GBP 2,820, last seen 2025.
--   Skate / Ray  generic; Thornback Skate is specific. Merging a general name
--                into a particular one loses which it was.
--   Grey, Mixed  two rows each, pennies.
-- The same refusal `buyerAliases` and `normaliseSupplier` both make.

update public.sales_rows r
set species_canon = m.canon
from (values
  ('CAT','Catfish'),('Catfishes','Catfish'),
  ('Witches','Witch'),('Witch Flounder','Witch'),('WITCH','Witch'),
  ('LEMONS','Lemon Sole'),('MEGS','Megrim'),('MONKS','Monkfish'),
  ('BLACK','Saithe'),('Red gurnard','Gurnard'),
  ('Spur dogs','Dogfish'),('SpurDog','Dogfish'),
  -- A PRESENTATION IS NOT A SPECIES. Every such row carries presentation WF,
  -- so the roundness is already held in its own column and nothing is lost.
  ('Whiting (round)','Whiting'),('Haddock (round)','Haddock'),
  -- The UPPERCASE block is the DEMO fleet, seeded outside the parser.
  ('COD','Cod'),('HADDOCK','Haddock'),('HAKE','Hake'),('HALIBUT','Halibut'),
  ('LING','Ling'),('LYTHE','Lythe'),('PLAICE','Plaice'),('WHITING','Whiting')
) as m(raw, canon)
where m.raw = coalesce(nullif(r.species_canon,''), r.species);
