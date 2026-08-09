-- Maintenance record: what gets serviced, and when it last was.
--
-- The engineer's question is never "what did I write on the 3rd of June" — it
-- is "how long since I changed the fuel filters". That cannot be answered from
-- the engine log, which records readings, not jobs. So two tables:
--
--   maintenance_tasks   the things this boat tracks. EDITABLE PER FLEET on
--                       purpose — every engine room is different, and a fixed
--                       list would be wrong on the second boat. Nothing is
--                       seeded; the page offers common items to add.
--   maintenance_events  each time one was done.
--
-- "Days since" is then max(done_on) per task, and "hours since" is the latest
-- engine-log running hours minus the hours recorded when the job was done.
-- Both are computed in the page rather than stored, so they cannot go stale.
--
-- INTERVALS ARE OPTIONAL AND MAY BE EITHER. A service is due every 250 running
-- hours OR every 6 months, and marine practice uses whichever comes first, so
-- both columns exist and either may be null. A task with neither is simply
-- tracked, not chased — which is the right default for something a man wants
-- to keep an eye on without being nagged about.

create table if not exists public.maintenance_tasks (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  -- Nullable, like every other vessel_id in this database: a pair fleet cannot
  -- say which boat a task belongs to without being told. See vessels_schema.sql.
  vessel_id     uuid references public.vessels(id) on delete set null,
  name          text not null,
  component     text,                       -- 'Main Engine', 'Generator 1', 'Hydraulics'
  interval_days  integer check (interval_days is null or interval_days > 0),
  interval_hours numeric  check (interval_hours is null or interval_hours > 0),
  notes         text,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.maintenance_events (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  task_id       uuid not null references public.maintenance_tasks(id) on delete cascade,
  done_on       date not null default current_date,
  -- Running hours AT THE TIME, so "hours since" survives later log entries.
  running_hours numeric,
  done_by       text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists maintenance_tasks_fleet_idx  on public.maintenance_tasks (fleet_id, active, sort_order);
create index if not exists maintenance_events_task_idx  on public.maintenance_events (task_id, done_on desc);
create index if not exists maintenance_events_fleet_idx on public.maintenance_events (fleet_id, done_on desc);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
-- Without the schema grant a new tenant gets "permission denied for schema
-- public" rather than an empty list, which reads as the app being broken.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.maintenance_tasks  to authenticated;
grant select, insert, update, delete on public.maintenance_events to authenticated;

alter table public.maintenance_tasks  enable row level security;
alter table public.maintenance_events enable row level security;

-- THE FLEET BOUNDARY FIRST. The permissive policies below carry no fleet check
-- of their own — that is the pattern throughout this database — so without
-- these two the tables would be readable by every tenant from the moment they
-- exist. That is exactly how the viewer/audit_log leak happened.
drop policy if exists fleet_isolation_maintenance_tasks on public.maintenance_tasks;
create policy fleet_isolation_maintenance_tasks on public.maintenance_tasks
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

drop policy if exists fleet_isolation_maintenance_events on public.maintenance_events;
create policy fleet_isolation_maintenance_events on public.maintenance_events
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

-- Read: anyone who works on the boat. Write: the two who keep the logs.
-- The engineer is the whole point of these tables — he is the one who changes
-- the filters — so he writes here, exactly as he does on the three log tables.
drop policy if exists maintenance_tasks_read on public.maintenance_tasks;
create policy maintenance_tasks_read on public.maintenance_tasks
  for select to authenticated
  using (current_user_role() in ('skipper','viewer','engineer'));

drop policy if exists maintenance_tasks_write on public.maintenance_tasks;
create policy maintenance_tasks_write on public.maintenance_tasks
  for all to authenticated
  using (current_user_role() in ('skipper','engineer'))
  with check (current_user_role() in ('skipper','engineer'));

drop policy if exists maintenance_events_read on public.maintenance_events;
create policy maintenance_events_read on public.maintenance_events
  for select to authenticated
  using (current_user_role() in ('skipper','viewer','engineer'));

drop policy if exists maintenance_events_write on public.maintenance_events;
create policy maintenance_events_write on public.maintenance_events
  for all to authenticated
  using (current_user_role() in ('skipper','engineer'))
  with check (current_user_role() in ('skipper','engineer'));

-- NOTE FOR engineer_role.sql: both tables are on its allow-list, so re-running
-- that file will NOT stamp `engineer_no_access` on them. If you add another
-- maintenance table, add it there too or the engineer loses his own page.

-- ============================================================
-- VERIFY
-- ============================================================
-- select tablename, policyname, permissive, cmd from pg_policies
--  where schemaname='public' and tablename like 'maintenance%' order by 1,3,2;
