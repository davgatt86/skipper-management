-- sales_fx.sql — run once in the Supabase SQL editor.
-- Adds currency + day-rate support for DKK (Hanstholm Afregning) sales notes.
-- Values stay stored in £ for consistent aggregation; the DKK originals are
-- kept per row so the rate stays editable. Safe to re-run.
alter table public.sales_landings add column if not exists currency text;
alter table public.sales_landings add column if not exists fx_rate  numeric;
alter table public.sales_rows     add column if not exists value_dkk numeric;
alter table public.sales_rows     add column if not exists ppk_dkk   numeric;
