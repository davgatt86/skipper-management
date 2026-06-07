-- ============================================================
-- QUOTA MANUAL ENTRY — run once in Supabase SQL editor
-- For skippers without AFPO statements: they track stocks by
-- typing the PO's balance figure (or a season-start allocation)
-- and letting catches come off it — typed by hand and/or
-- auto-deducted from uploaded mcatch trip reports.
-- Same skipper-only + fleet-isolation RLS as the other quota
-- tables. Safe to re-run (idempotent).
-- ============================================================

-- One row per tracked stock per quota year.
-- anchor_t is the figure the skipper has from the PO, in tonnes,
-- good as of anchor_date. Catches dated after anchor_date deduct.
-- anchor_t may be null = "tracking catch, no figure yet".
create table if not exists public.quota_manual_stocks (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) default public.current_fleet_id(),
  year        int  not null,
  stock       text not null,            -- master-list label, e.g. 'NS Haddock'
  section     text not null default '', -- North Sea | West Coast | Area VII | Area VIII
  anchor_t    numeric,                  -- PO figure, tonnes
  anchor_date date,                     -- date the figure is good as of
  note        text default '',
  created_at  timestamptz default now()
);
create unique index if not exists quota_manual_stocks_unique
  on public.quota_manual_stocks (fleet_id, year, stock);
create index if not exists quota_manual_stocks_fleet_idx
  on public.quota_manual_stocks (fleet_id);

-- Ledger against a tracked stock: typed catches and leases/swaps.
-- 'catch' and 'lease_out' deduct, 'lease_in' adds. Entries dated
-- on/before the stock's anchor_date are ignored by the maths
-- (the PO's figure already includes them) but kept for the record.
create table if not exists public.quota_manual_entries (
  id              uuid primary key default gen_random_uuid(),
  manual_stock_id uuid not null references public.quota_manual_stocks(id) on delete cascade,
  fleet_id        uuid not null references public.fleets(id) default public.current_fleet_id(),
  entry_date      date not null default current_date,
  kind            text not null check (kind in ('catch','lease_in','lease_out')),
  tonnes          numeric not null check (tonnes > 0),
  note            text default '',
  created_at      timestamptz default now()
);
create index if not exists quota_manual_entries_stock_idx
  on public.quota_manual_entries (manual_stock_id);
create index if not exists quota_manual_entries_fleet_idx
  on public.quota_manual_entries (fleet_id);

-- RLS: skipper-only, plus restrictive fleet isolation
do $$
declare t text;
begin
  foreach t in array array['quota_manual_stocks','quota_manual_entries']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_skipper', t);
    execute format(
      'create policy %I on public.%I for all
         using (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))
         with check (exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = ''skipper''))',
      t || '_skipper', t);

    execute format('drop policy if exists %I on public.%I', 'fleet_isolation_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (fleet_id = public.current_fleet_id())
         with check (fleet_id = public.current_fleet_id())',
      'fleet_isolation_' || t, t);
  end loop;
end $$;

-- Verify
select relname from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname like 'quota_manual%';
