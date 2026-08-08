-- Record WHAT differed on a failed sales-note parse, not just that one did.
--
-- `sales_landings.reconcile_ok` is written from the parser's reconcile block,
-- which compares the parsed rows against the TOTAL line printed on the note.
-- The landing's own boxes/weight_kg/value are written from the ROW SUM, so
-- comparing the landing against its rows compares the parse against itself and
-- always agrees. The printed total was never stored anywhere.
--
-- That means a `reconcile_ok = false` landing is unreadable after the fact: you
-- cannot tell whether the note is out by £2 or £20,000, or whether it was the
-- weight or the value that failed, without the original PDF. And the original
-- is not always available — the ten P&J notes behind the blank-buyer rows are
-- not coming back.
--
-- So keep the parser's own numbers. `reconcile_diff` holds
--   { expected: {boxes,weight,value},   -- as printed on the note
--     actual:   {boxes,weight,value},   -- as the parsed rows add up
--     diffs:    {boxes,weight,value},   -- actual - expected
--     basis:    'physical' | null }     -- P&J prints a physical box count that
--                                       -- never ties to the fractional column,
--                                       -- so its boxes diff is informational
-- exactly as `buildReconcile()` / `reconcilePJJ()` in parse-core produce it.
--
-- Nullable and additive: existing landings keep a null and read as before.

alter table public.sales_landings
  add column if not exists reconcile_diff jsonb;

comment on column public.sales_landings.reconcile_diff is
  'Parser reconcile detail: expected (printed on the note) vs actual (row sum) '
  'vs diffs. Null for landings ingested before Aug 2026, and for notes with no '
  'printed TOTAL line to compare against.';

-- No policy or grant changes: this is a new column on an existing table, and
-- both the permissive policies and the restrictive fleet_isolation policy on
-- sales_landings are row-scoped, not column-scoped.
