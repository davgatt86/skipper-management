-- Adds tracking of which sales notes have already fed a crew-bonus landing,
-- so the same note can never add its boxes twice. Run once in Supabase SQL editor.
alter table landings add column if not exists sales_keys text[] not null default '{}';
