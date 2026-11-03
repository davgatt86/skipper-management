/* A METER WAS REPLACED — the one lower reading that is neither a mistake nor a
 * rolled-over dial. Nov 2026.
 *
 * THIS REVERSES A DECISION, AND THE REVERSAL IS DAVID'S. In Sep 2026 a
 * `counter_resets` table was written and dropped in the same sitting, because
 * his answer then was that a counter logged lower is the engineer's mistake:
 * *"there must be an error by engineer ... it could be he's put as wrong
 * engine."* CLAUDE.md records the objection in as many words — *"a button would
 * have been worse than no rule: it is the 'meter replaced' override again,
 * available on the 8,000-to-7,000 case where it must not be used."*
 *
 * THAT OBJECTION IS TO AN AFFORDANCE, NOT TO THE FACT. A one-tap dismiss on the
 * warning is dangerous precisely because it is offered on every reversal,
 * including the real mistakes, and pressing it is the cheap way out. A dated
 * row naming a MACHINE, the old meter's final reading and the new meter's
 * starting reading is not a dismiss — it is a statement about the engine room
 * that somebody had to go and look up. So the fact gets a home and the warning
 * gets no button.
 *
 * AND IT IS STATED, NEVER INFERRED. A sustained shift down could equally be an
 * engineer writing the wrong generator for a month — which is exactly what the
 * September answer turned out to be for Generator 1. Deriving "new meter" from
 * the shape of the series would be the engine-limits mistake over again: a rule
 * read off history alone, calling the correct readings wrong.
 *
 * WHY NOT A COLUMN ON THE LOG ENTRY. A meter change is a fact about a machine
 * over time, not about one entry. Several readings may go in before anyone
 * notices, the entry that first shows it may be deleted, and the change wants
 * its own date — which is NOT the same as the date of the first reading taken
 * on the new meter.
 *
 * ---------------------------------------------------------------------------
 * A NEW METER AND A ROLLED-OVER DIAL ARE INDISTINGUISHABLE FROM THE READINGS,
 * and that is the whole reason this table has to exist.
 *
 * Generator 2 read 9,087 on 09-08-2026 and 90 on 10-10. `rolledOver()` fits it
 * perfectly — a four-figure dial wrapping past 9,999 is 1,003 hours over 62
 * days, 16 a day, entirely plausible for this boat — so the app absorbed a new
 * meter as a rollover and said nothing. It reached the right outcome for the
 * wrong reason, and the two readings differ by 913 hours of the machine's life:
 *
 *     rolled over   the dial passed 9,999      life ~ 10,000 + 607
 *     new meter     the old count is frozen    life =   9,087 + 607  = 9,694
 *
 * David settled it Nov 2026: Generator 2 only, and the hours SUM. So a stated
 * change beats the rollover guess, and `previous_final` is what makes the
 * machine's life answerable at all.
 *
 * GENERATOR 1 IS NOT ONE AND STAYS FLAGGED. 8,864 on 26-08 to 7,896 on 06-09 is
 * down 968 and nowhere near a fresh meter's zero. David's call: it is wrong and
 * the figures want putting right, so the nine cards stand. A row here would
 * have silenced a real fault — which is the September objection, earned.
 */

create table if not exists public.engine_meter_changes (
  id              uuid primary key default gen_random_uuid(),
  fleet_id        uuid not null references public.fleets(id) on delete cascade,
  vessel_id       uuid,
  -- The machine and the reading, keyed exactly as engine_limits and the
  -- readings jsonb key them, so there is one spelling of "Generator 2".
  group_key       text not null,
  param_key       text not null,
  -- The date from which the NEW meter's readings apply. Not necessarily the day
  -- it was fitted: that is often unknown, and what the check needs is the point
  -- after which the old baseline no longer governs.
  changed_on      date not null,
  -- Both nullable, because a blank must not read as a nought. `previous_final`
  -- is the old meter's last reading, `new_start` what the new one read when it
  -- was fitted — 0 for a genuinely new meter, more for a used one. Lifetime is
  -- previous_final + (reading - new_start), and is simply not known where
  -- either is null rather than being quietly taken as zero.
  previous_final  numeric,
  new_start       numeric,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint engine_meter_changes_vessel_same_fleet
    foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id),
  -- One statement per machine per day. A meter is not replaced twice in a day,
  -- and two rows would silently double the reset.
  constraint engine_meter_changes_once
    unique (fleet_id, group_key, param_key, changed_on)
);

create index if not exists engine_meter_changes_fleet_idx
  on public.engine_meter_changes (fleet_id, group_key, param_key, changed_on);

alter table public.engine_meter_changes enable row level security;

revoke all on public.engine_meter_changes from anon;
grant select, insert, update, delete on public.engine_meter_changes to authenticated;

/* THE FLEET CHECK COMES BEFORE ANYTHING ELSE. Every permissive policy in this
 * database is `to authenticated using (true)` with only this beside it, so a
 * new table is open to every tenant from the moment it exists. */
drop policy if exists fleet_isolation on public.engine_meter_changes;
create policy fleet_isolation on public.engine_meter_changes as restrictive
  for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

-- The two who keep the engine log, since the man who fits the meter is the
-- officer. An allow-list of roles: a role added later sees nothing until
-- somebody decides it should.
drop policy if exists engine_meter_changes_keepers on public.engine_meter_changes;
create policy engine_meter_changes_keepers on public.engine_meter_changes
  for all to authenticated
  using (
    (select public.is_officer())
    or exists (select 1 from public.app_users u where u.id = (select auth.uid()) and u.role = 'skipper')
  )
  with check (
    (select public.is_officer())
    or exists (select 1 from public.app_users u where u.id = (select auth.uid()) and u.role = 'skipper')
  );

/* Denied explicitly rather than waiting on the next run of cook_role.sql. A new
 * table is denied to NEITHER generated allow-list until both files are re-run,
 * and re-running rewrites policies across ~110 tables on a live multi-tenant
 * database — a deliberate act, not a side effect of adding a table. The file
 * edit is what keeps this after a future re-run; this is what holds today. */
drop policy if exists cook_no_access on public.engine_meter_changes;
create policy cook_no_access on public.engine_meter_changes as restrictive
  for all to authenticated
  using (not (select public.is_cook()))
  with check (not (select public.is_cook()));

/* THE ONE ON RECORD — Generator 2, on David's word, Nov 2026.
 *
 * `changed_on` is 10-10-2026, the first reading taken on the new meter. The day
 * it was actually fitted is somewhere between 09-08 (the old meter's last
 * reading, 9,087) and that date, and is not known — so the note says the window
 * rather than the row asserting a day nobody read off anything.
 *
 * `new_start` 0 is David's answer, not an inference: he was shown 9,087 + 607 =
 * 9,694 and took it. */
insert into public.engine_meter_changes
  (fleet_id, vessel_id, group_key, param_key, changed_on, previous_final, new_start, note)
select f.id,
       (select v.id from public.vessels v where v.fleet_id = f.id limit 1),
       'Generator 2', 'Running Hours', date '2026-10-10', 9087, 0,
       'New meter. The old one last read 9,087 on 09-08-2026 and the new one read 90 on 10-10; '
       || 'the day it was fitted is somewhere in that window and is not recorded. '
       || 'Before this row the app read the drop as the four-figure dial wrapping past 9,999, '
       || 'which fits the arithmetic just as well and would have put the machine''s life ~913 h out. '
       || 'David, 03-11-2026.'
  from public.fleets f
 where f.name = 'AUDACIOUS BF83'
on conflict (fleet_id, group_key, param_key, changed_on) do nothing;
