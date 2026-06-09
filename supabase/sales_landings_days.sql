-- ============================================================
-- sales_landings_days.sql — run once in the Supabase SQL editor
-- Adds days-at-sea per landing so Fish Sales can show £/day.
-- Skipper enters it per trip (to the nearest 0.25); later the
-- quota module's mcatch trip days can populate it automatically.
-- ============================================================
alter table public.sales_landings
  add column if not exists days_at_sea numeric;
