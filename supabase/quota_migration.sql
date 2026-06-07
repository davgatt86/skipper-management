-- ============================================================
-- Fish Sales Analyser — run once in Supabase SQL editor
-- Skipper-only tables: parsed sales-note landings + line rows
-- (named sales_* to stay clear of the crew-bonus `landings` table)
-- ============================================================

create table if not exists sales_landings (
  id          uuid primary key default gen_random_uuid(),
  dedup_key   text unique not null,            -- market|vessel|saleNo-or-date-or-filename
  vessel      text not null default '',
  market      text not null default '',
  port        text default '',
  sale_no     text default '',
  landing_date date,
  filename    text default '',
  boxes       numeric default 0,
  weight_kg   numeric default 0,
  value       numeric default 0,
  consigned   boolean default false,
  reconcile_ok boolean,                        -- null = no printed TOTAL found on the note
  created_at  timestamptz default now()
);

create table if not exists sales_rows (
  id            uuid primary key default gen_random_uuid(),
  landing_id    uuid not null references sales_landings(id) on delete cascade,
  buyer         text default '',
  species       text default '',               -- raw note text e.g. "Catfish Scot"
  species_canon text default '',               -- normalised e.g. "Catfish"
  presentation  text default '',
  grade         text default '',
  sub_grade     text,                          -- A4 haddock split: 'Chipper' | 'Metro' | 'Mini Metro'
  boxes         numeric default 0,
  box_weight    numeric default 0,
  weight_kg     numeric default 0,
  price_per_kg  numeric default 0,
  price_per_box numeric default 0,
  value         numeric default 0,
  msc           boolean default false
);

create index if not exists sales_rows_landing_idx on sales_rows(landing_id);
create index if not exists sales_landings_date_idx on sales_landings(landing_date);

alter table sales_landings enable row level security;
alter table sales_rows enable row level security;

-- Skipper-only (read AND write). Crew logins see nothing.
drop policy if exists sales_landings_skipper on sales_landings;
create policy sales_landings_skipper on sales_landings
  for all
  using (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'));

drop policy if exists sales_rows_skipper on sales_rows;
create policy sales_rows_skipper on sales_rows
  for all
  using (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'))
  with check (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'));
