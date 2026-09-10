-- "It did not happen this trip" — said once, for one departure.
--
-- David, Sep 2026: "page can request a log to anything, user should be able
-- skip if it didn't happen."
--
-- THIS IS NOT A SECOND COPY OF A BOOK, which is the rule the rest of the
-- pre-departure check is built on. It records a DECISION ABOUT THE CHECKLIST —
-- that nothing happened worth entering — and no entry is made anywhere by
-- writing one. The books stay the only place an entry lives.
--
-- WHY IT IS NEEDED AT ALL. The check used to resolve bunkering and garbage to
-- "nothing to record" whenever it found no fuel or garbage rows in the window.
-- That is an ASSUMPTION wearing a fact's clothes: an empty fuel log means
-- either that nothing was bunkered, or that the bunkering was never written up,
-- and those are opposite conclusions. The app cannot tell them apart, so it
-- asks — and this is the answer.
--
-- PER DEPARTURE, NEVER STANDING. Skipping the garbage book for one trip must
-- not skip it for the next; the unique key carries the departure date, so the
-- question comes back every voyage.
create table if not exists public.predeparture_skips (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  vessel_id uuid references public.vessels(id) on delete cascade,
  departure_on date not null,
  item_key text not null,
  reason text,
  skipped_by uuid,
  skipped_name text,
  skipped_at timestamptz not null default now(),
  unique (fleet_id, vessel_id, departure_on, item_key)
);

alter table public.predeparture_skips enable row level security;

-- A NEW TABLE NEEDS ITS fleet_isolation POLICY BEFORE ANYTHING ELSE: the
-- permissive policies in this database carry no fleet check of their own.
drop policy if exists fleet_isolation_predeparture_skips on public.predeparture_skips;
create policy fleet_isolation_predeparture_skips on public.predeparture_skips
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

drop policy if exists predeparture_skips_read on public.predeparture_skips;
create policy predeparture_skips_read on public.predeparture_skips
  for select to authenticated using (auth.uid() is not null);

-- The mate walks the list before she sails, so he answers it.
drop policy if exists predeparture_skips_write on public.predeparture_skips;
create policy predeparture_skips_write on public.predeparture_skips
  for all to authenticated
  using (exists (select 1 from public.app_users u
                  where u.id = (select auth.uid())
                    and u.role in ('skipper', 'officer', 'engineer')))
  with check (exists (select 1 from public.app_users u
                       where u.id = (select auth.uid())
                         and u.role in ('skipper', 'officer', 'engineer')));

grant select, insert, update, delete on public.predeparture_skips to authenticated;

create index if not exists predeparture_skips_lookup
  on public.predeparture_skips (fleet_id, vessel_id, departure_on);

comment on table public.predeparture_skips is
  'Says that a pre-departure item did not apply to one departure. A decision '
  'about the checklist, never an entry in a book — the books remain the only '
  'place an entry lives. Per departure, so the question returns next voyage.';
