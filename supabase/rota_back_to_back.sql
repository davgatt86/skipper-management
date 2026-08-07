-- ============================================================
-- Back-to-back pairs on the rota.
-- Applied and verified Aug 2026.
--
-- Two men share a berth: when one is on, the other is off. David's
-- words — "david/barry are back to back, jackson/alfie, etc".
--
-- crew_a_id is the man in Crew A, crew_b_id the man in Crew B, so the
-- two watches can be filled straight from the pairs in one action
-- instead of a dozen taps that can be got wrong. It also means a swap
-- has an obvious answer: if David cannot do landing 2, the man who
-- covers him is Barry, and that is one tap on the landing.
-- ============================================================

create table if not exists public.rota_back_to_back (
  id         uuid primary key default gen_random_uuid(),
  fleet_id   uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  name       text,
  sort       integer not null default 0,
  crew_a_id  uuid not null references public.crew(id) on delete cascade,
  crew_b_id  uuid not null references public.crew(id) on delete cascade,
  created_at timestamptz default now(),
  constraint rota_b2b_distinct check (crew_a_id <> crew_b_id)
);

-- A man holds one berth on one side. Cross-column overlap — the same man
-- as A in one pair and B in another — is not blocked here; the page hides
-- anyone already paired, which is where that mistake would be made.
create unique index if not exists rota_b2b_a_uniq on public.rota_back_to_back (crew_a_id);
create unique index if not exists rota_b2b_b_uniq on public.rota_back_to_back (crew_b_id);

grant select, insert, update, delete on public.rota_back_to_back to authenticated;

alter table public.rota_back_to_back enable row level security;

create policy fleet_isolation_rota_back_to_back on public.rota_back_to_back
  as restrictive for all
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

create policy rota_back_to_back_read on public.rota_back_to_back for select
  using (exists (select 1 from app_users u
                  where u.id = auth.uid()
                    and u.role = any (array['skipper'::user_role,'viewer'::user_role])));

create policy rota_back_to_back_write_ins on public.rota_back_to_back for insert
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy rota_back_to_back_write_upd on public.rota_back_to_back for update
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role))
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy rota_back_to_back_write_del on public.rota_back_to_back for delete
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role));


-- ---- Seed -----------------------------------------------------------
-- A is the man currently aboard, B the man ashore, which is how the two
-- watches stand today and matches "Crew A, david/david" leading the list.
--
--   Skipper and Cook are David's own pairings.
--   Chief Engineer is INFERRED — Henderson and Wood are the only two chief
--   engineers on the rotation and they sit on opposite watches. Worth a
--   check.
insert into public.rota_back_to_back (fleet_id, name, sort, crew_a_id, crew_b_id)
select f.id, p.name, p.sort, a.id, b.id
  from public.fleets f
  cross join (values
      ('Skipper',        10, 'David Gatt',      'Barry Reid'),
      ('Chief Engineer', 20, 'David Henderson', 'Norman Wood'),
      ('Cook',           30, 'Jackson Gatt',    'Alfie Reid')
  ) as p(name, sort, a_name, b_name)
  join public.crew a on a.full_name = p.a_name and a.fleet_id = f.id
  join public.crew b on b.full_name = p.b_name and b.fleet_id = f.id
 where f.name = 'AUDACIOUS BF83'
on conflict do nothing;


-- ============================================================
-- THE SIX DECKHANDS ARE DELIBERATELY NOT PAIRED
--   Andrew Smith, Duncan Cruikshank, Paul Craib and Ronald Beagrie are
--   aboard; Gregor Smith and James Napier are ashore. Four against two
--   does not pair one-to-one, so there is no basis to guess who covers
--   whom. They are listed as "not yet paired" on the page for David to
--   set.
-- ============================================================


-- ============================================================
-- VERIFY
-- ============================================================
select p.name, a.full_name as crew_a, a.status as a_status,
       b.full_name as crew_b, b.status as b_status
  from public.rota_back_to_back p
  join public.crew a on a.id = p.crew_a_id
  join public.crew b on b.id = p.crew_b_id
 order by p.sort;
-- expect 3 rows, every A on_boat and every B on_leave


-- ============================================================
-- ROLLBACK
--   drop table if exists public.rota_back_to_back;
-- ============================================================
