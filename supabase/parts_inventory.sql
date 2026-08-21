-- PARTS INVENTORY — what a job used, and what is left aboard.
--
-- THE STOCK FIGURE IS DERIVED, NEVER STORED. There is no `on_hand` column
-- anywhere in here, deliberately, and the probe asserts there is none. A
-- maintenance event consumes parts; what is left falls out of
-- (last count + received - used since) and therefore cannot drift from the job
-- record the way a separately maintained tally would. One number, two views.
--
-- THIS IS THE FIRST RUNNING BALANCE IN THE DATABASE. Every other figure in this
-- app is a snapshot — a landing, a reading, a settlement — and a wrong one is
-- wrong on its own. Here a wrong entry propagates forward through every later
-- balance, which changes what the page owes the reader: it has to SHOW THE
-- WORKINGS, not just the answer, the same way the fuel log does. Hence one
-- ledger table rather than a count that gets edited.
--
-- See src/lib/maintenance/parts.js for balanceOf() and the three states that
-- must never render alike: counted, never counted, and nothing recorded.
--
-- RE-RUN officer_role.sql AND cook_role.sql AFTER THIS. `parts` and
-- `parts_movements` are in the officer's allow-list, and the deny loop only
-- touches tables OUTSIDE it — the trap that shut officers out of crew certs.

-- ------------------------------------------------------------------- parts
-- No shipped catalogue, unlike the stores list and the gear parts.
--
-- That is not an oversight. Those two ship defaults because there was a real
-- source to transcribe — the Whitehills order form, and the part names David
-- gave. A boat's engine-room spares are entirely her own: impellers and
-- injectors for HER engine, in HER part numbers. A guessed list would be worse
-- than an empty one, because it would look like a starting point and be wrong.
create table if not exists public.parts (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null references public.fleets(id) on delete cascade,
  vessel_id    uuid,
  name         text not null,
  part_number  text,
  component    text,        -- free text, matching maintenance_tasks.component
  unit         text not null default 'each',
  min_stock    numeric,     -- what the engineer wants aboard
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists parts_fleet on public.parts (fleet_id, component, name);

-- Composite FK for the same reason as gear_nets: fleet_isolation checks
-- fleet_id only, which leaves vessel_id free to point across a tenant boundary.
alter table public.parts drop constraint if exists parts_vessel_same_fleet;
alter table public.parts add constraint parts_vessel_same_fleet
  foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id);

-- --------------------------------------------------------------- the ledger
create table if not exists public.parts_movements (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  part_id     uuid not null references public.parts(id) on delete cascade,
  /* FOUR KINDS, and only one is absolute:
   *   count    — a stock take. "There are N." Resets the balance on that date
   *              and makes everything before it irrelevant, which is how a
   *              running balance is corrected without editing history.
   *   received — N came aboard.
   *   used     — N went into a job, normally with the event that consumed it.
   *   adjusted — N found, broken or written off. The ONLY kind that may be
   *              negative, because it is the only one where the direction is
   *              not already in the word. */
  kind        text not null check (kind in ('count', 'received', 'used', 'adjusted')),
  qty         numeric not null,
  moved_on    date not null default current_date,
  -- Null for a count, a delivery, or a use nobody tied to a job — the last is
  -- allowed on purpose: a part used off the books is still a part gone, and
  -- refusing to record it would leave the balance wrong, which is worse than
  -- an unattributed line.
  event_id    uuid references public.maintenance_events(id) on delete set null,
  notes       text,
  moved_by    uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint parts_movements_qty check (
    (kind = 'adjusted' and qty <> 0) or (kind <> 'adjusted' and qty > 0)
  )
);
-- moved_on then created_at: a count entered after a use on the SAME DAY
-- supersedes it, which is what counting the shelf means.
create index if not exists parts_movements_part
  on public.parts_movements (part_id, moved_on, created_at);
create index if not exists parts_movements_event
  on public.parts_movements (event_id) where event_id is not null;

-- --------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['parts','parts_movements'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists fleet_isolation on public.%I', t);
    execute format(
      'create policy fleet_isolation on public.%I as restrictive for all to authenticated
         using (fleet_id = (select public.current_fleet_id()))
         with check (fleet_id = (select public.current_fleet_id()))', t);

    execute format('drop policy if exists parts_read on public.%I', t);
    execute format('create policy parts_read on public.%I for select to authenticated using (true)', t);

    /* THE OFFICER WRITES IT WITHOUT A SKIPPER LOGIN. He is the man holding the
     * part — if correcting a miscount needs somebody else to sign in, the
     * miscount stays. */
    execute format('drop policy if exists parts_write on public.%I', t);
    execute format(
      'create policy parts_write on public.%I for all to authenticated
         using (exists (select 1 from public.app_users u
                         where u.id = (select auth.uid())
                           and u.role in (''skipper'', ''officer'', ''engineer'')))
         with check (exists (select 1 from public.app_users u
                              where u.id = (select auth.uid())
                                and u.role in (''skipper'', ''officer'', ''engineer'')))', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    -- A running balance makes a silent edit worse than usual: it moves every
    -- later figure too. Audited from the first day rather than after something
    -- goes missing.
    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I '
      'for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- VERIFIED BY PROBE as an officer, inside an aborted transaction:
--
--   officer created the part without a skipper login
--   counted 12, +6, -4 => 14
--   stored stock columns on `parts`: 0
--   a negative "used" is refused; only an adjustment carries a sign
--   cross-fleet vessel refused by the composite FK
--   officer still reads payments 0 and sales 0
--   cook reads parts 0 and movements 0
