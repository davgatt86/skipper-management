-- ============================================================
-- Square Up worksheets — the sheet that goes TO the office.
--
-- Run in the Supabase SQL editor. STEP 1 creates everything and
-- changes nothing that already exists; STEP 2 is verification only.
-- Nothing here alters su_settlements or any existing table.
--
-- WHY
--   Square Up currently keeps the trip in browser localStorage
--   (src/squareup/storage.js). It does not survive a cleared browser,
--   does not follow you from the laptop to the phone, and cannot be
--   compared against the settlement that comes back.
--
-- SHAPE
--   Deliberately mirrors the settlement side, so reconciliation is a
--   join rather than a fuzzy match:
--     su_settlements  <- su_settlement_lines / su_crew_payments
--     su_worksheets   <- su_worksheet_lines  / su_worksheet_crew
--   su_worksheets.settlement_id links the two once the office returns
--   the settled sheet.
--
-- ACCESS
--   Scoped by su_visible_boat(boat_id), which after
--   su_fleet_isolation.sql means "your own fleet's boat, or one
--   explicitly granted in su_fleet_agents". These are new tables, so
--   they deliberately do NOT depend on su_is_allowed() — that is the
--   legacy email allow-list being phased out.
-- ============================================================


-- ============================================================
-- STEP 1 — create
-- ============================================================

-- ---- the worksheet header --------------------------------------------
create table if not exists public.su_worksheets (
  id             uuid primary key default gen_random_uuid(),
  boat_id        uuid not null references public.su_boats(id) on delete cascade,

  trip_no        text,
  landed_date    date,
  market         text,
  days_at_sea    numeric,
  boxes_landed   numeric,
  quota_recovery_pct numeric,

  status         text not null default 'draft',   -- 'draft' | 'sent'
  sent_at        timestamptz,
  notes          text,

  -- set when the settled sheet comes back and is matched to this worksheet
  settlement_id  uuid references public.su_settlements(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists su_worksheets_boat_idx on public.su_worksheets (boat_id, landed_date desc);
create index if not exists su_worksheets_settlement_idx on public.su_worksheets (settlement_id);

-- ---- everything that is a list of things used ------------------------
-- One table for fuel, haulage, labour and contracted bonus. They differ
-- only in which columns are filled, and keeping them together mirrors
-- su_settlement_lines and keeps reconciliation to one join.
--
--   section 'fuel'     label = where,      qty = litres,  unit 'lt'
--   section 'haulage'  label = haulier,    qty = loads,   unit 'loads'
--                      detail = from where
--   section 'labour'   label = gang/name,  basis 'box' -> qty = boxes,
--                      rate = £/box, amount = qty * rate
--                      basis 'flat' -> amount = rate
--   section 'bonus'    label = crew name,  detail = month, amount = £
--
-- Fuel and haulage carry NO money: the skipper reports what was taken
-- and from whom, and the office prices it.
create table if not exists public.su_worksheet_lines (
  id           uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.su_worksheets(id) on delete cascade,
  section      text not null check (section in ('fuel','haulage','labour','bonus')),
  label        text not null default '',
  detail       text,
  entry_date   date,
  qty          numeric,
  unit         text,
  basis        text check (basis is null or basis in ('box','flat')),
  rate         numeric,
  amount       numeric,
  note         text,
  sort         integer not null default 0
);

create index if not exists su_worksheet_lines_ws_idx on public.su_worksheet_lines (worksheet_id, section, sort);

-- ---- who was aboard and on what share --------------------------------
create table if not exists public.su_worksheet_crew (
  id           uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.su_worksheets(id) on delete cascade,
  crew_id      uuid references public.crew(id) on delete set null,  -- when picked from the roster
  crew_name    text not null,
  share_key    text,           -- 'full' | '7_8' | '6_8' | '5_8' | '4_8' | 'custom'
  share_value  numeric,        -- resolved fraction, so history survives a rate change
  bond         numeric not null default 0,
  bonus        numeric not null default 0,
  note         text,
  sort         integer not null default 0
);

create index if not exists su_worksheet_crew_ws_idx on public.su_worksheet_crew (worksheet_id, sort);

-- ---- keep updated_at honest ------------------------------------------
create or replace function public.su_touch_worksheet()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists su_worksheets_touch on public.su_worksheets;
create trigger su_worksheets_touch before update on public.su_worksheets
  for each row execute function public.su_touch_worksheet();

-- ---- grants ----------------------------------------------------------
grant select, insert, update, delete on public.su_worksheets      to authenticated;
grant select, insert, update, delete on public.su_worksheet_lines to authenticated;
grant select, insert, update, delete on public.su_worksheet_crew  to authenticated;

-- ---- RLS -------------------------------------------------------------
alter table public.su_worksheets      enable row level security;
alter table public.su_worksheet_lines enable row level security;
alter table public.su_worksheet_crew  enable row level security;

drop policy if exists su_worksheets_visible on public.su_worksheets;
create policy su_worksheets_visible on public.su_worksheets
  for all to authenticated
  using      (public.su_visible_boat(boat_id))
  with check (public.su_visible_boat(boat_id));

-- Children resolve the boat through their parent, exactly as the
-- settlement line and crew policies do.
drop policy if exists su_worksheet_lines_visible on public.su_worksheet_lines;
create policy su_worksheet_lines_visible on public.su_worksheet_lines
  for all to authenticated
  using      (exists (select 1 from public.su_worksheets w
                       where w.id = worksheet_id and public.su_visible_boat(w.boat_id)))
  with check (exists (select 1 from public.su_worksheets w
                       where w.id = worksheet_id and public.su_visible_boat(w.boat_id)));

drop policy if exists su_worksheet_crew_visible on public.su_worksheet_crew;
create policy su_worksheet_crew_visible on public.su_worksheet_crew
  for all to authenticated
  using      (exists (select 1 from public.su_worksheets w
                       where w.id = worksheet_id and public.su_visible_boat(w.boat_id)))
  with check (exists (select 1 from public.su_worksheets w
                       where w.id = worksheet_id and public.su_visible_boat(w.boat_id)));


-- ============================================================
-- STEP 2 — VERIFY (reads only)
-- ============================================================

-- Three tables, RLS on, one policy each.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'su_worksheet%'
 order by c.relname;

-- Nothing on the settlement side moved.
select 'su_settlements' t, count(*) n from public.su_settlements
union all select 'su_settlement_lines', count(*) from public.su_settlement_lines
union all select 'su_crew_payments',    count(*) from public.su_crew_payments
 order by t;
-- Expect 375 / 3281 / 1798, unchanged.

-- Empty to start with.
select count(*) as worksheets from public.su_worksheets;


-- ============================================================
-- ROLLBACK
-- These tables are new and nothing else references them, so removing
-- them cannot affect existing data:
--
--   drop table if exists public.su_worksheet_crew;
--   drop table if exists public.su_worksheet_lines;
--   drop table if exists public.su_worksheets;
--   drop function if exists public.su_touch_worksheet();
--
-- The browser's localStorage copy is not touched by any of this, and
-- the app keeps writing squareup_*_v1 until the worksheet is saved to
-- the database, so there is always a way back.
-- ============================================================
