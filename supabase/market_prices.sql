-- ============================================================
-- DAILY PRICES — run once in Supabase SQL editor
-- Shared market board: Peterhead (Don Fishing) + Denmark daily
-- price sheets. NOT fleet-scoped — every user reads the same board;
-- only skippers can upload. Safe to re-run (idempotent).
-- ============================================================

-- One row per source per day (replace-on-reupload by source+date).
create table if not exists public.market_days (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('PD','DK')),
  price_date   date not null,
  boats        int,
  consignments int,
  total_boxes  numeric,
  total_kg     numeric,
  filename     text default '',
  created_at   timestamptz default now()
);
create unique index if not exists market_days_unique on public.market_days (source, price_date);

create table if not exists public.market_prices (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.market_days(id) on delete cascade,
  source     text not null,
  price_date date not null,
  species    text not null,        -- canonical, e.g. 'Haddock'
  grade      text not null,        -- 'A1'..'A5', 'U9', DK 'A0'.., etc.
  subgrade   text,                 -- PD descriptive split, e.g. 'Chipper'/'Metro'
  low        numeric,              -- PD only
  high       numeric,              -- PD only
  ave        numeric
);
create index if not exists market_prices_lookup on public.market_prices (source, price_date, species);
create index if not exists market_prices_species on public.market_prices (species, grade);

create table if not exists public.market_volumes (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.market_days(id) on delete cascade,
  source     text not null,
  price_date date not null,
  label      text not null,        -- as printed (PD tally name / DK species)
  boxes      numeric,              -- PD
  kg         numeric               -- DK
);
create index if not exists market_volumes_lookup on public.market_volumes (source, price_date, label);

-- RLS: read for any signed-in user (shared board); write skipper-only.
do $$
declare t text;
begin
  foreach t in array array['market_days','market_prices','market_volumes']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))
         with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_write', t);
  end loop;
end $$;

select relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname like 'market_%';
