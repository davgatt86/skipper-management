-- AN ACTIVITY ALERT MUST CLEAR ITSELF WHEN THE BOOK IS WRITTEN IN.
--
-- It did not. `generate_activity_alerts()` only ever INSERTED, so once an alert
-- was raised it stayed open until somebody read or dismissed it BY HAND — and
-- the digest re-lists every unread alert each morning.
--
-- David, 22-08-2026: the digest told him the engine log had not been written
-- for two days TWICE, with two different dates (17-08 and 20-08), and that
-- bunkering was seven days overdue since 12-08. The engine log had an entry
-- that same morning and the fuel log one on 19-08. All three were wrong.
--
-- TWO FAULTS IN ONE:
--   1. A book going stale from a NEW last-entry date raises a new alert — which
--      is right, one per episode — but the PREVIOUS episode's alert was never
--      closed, so they piled up. That is the two engine-log lines.
--   2. Writing in the book cleared nothing at all. That is all three being
--      stale in the first place.
--
-- THE RULE THIS ENFORCES: for each fleet and each book, AT MOST ONE open alert,
-- and only while the book is actually stale. Same principle as the re-upload
-- banner on Fish Sales — driven by the data, so it clears itself and there is
-- nothing to remember to take down.
--
-- Maintenance is included on the same argument: a job that has been done since
-- is not due, and its alert should go without anyone tidying up after it.
--
-- Called at the TOP of generate_activity_alerts(), so every run closes before
-- it raises. `netlify/functions/alert-digest.js` also calls the generator
-- before building the mail: the cron runs at 06:00 and the digest at 07:00, and
-- a man who writes his log at half past six would otherwise be told at seven
-- that he had not.
--
-- A LIMIT WORTH KNOWING: the unique key is (fleet_id, dedup_key) regardless of
-- dismissal, and the dedup key carries the last-entry date. So a key that has
-- ever been used can never raise again. In normal running that is right — each
-- new stale episode has a later last-entry date and therefore a new key — but
-- it means you cannot resurrect an old alert by rolling the data back. The
-- first probe of this fix reported 0 where it wanted 1 for exactly that reason.
--
-- VERIFIED BY PROBE, inside an aborted transaction:
--   stale from a fresh key      -> 1 open
--   run twice                   -> still 1  (one per episode)
--   a later, still-stale entry  -> still 1, and it is the NEWER key
--   written in the book today   -> 0 open
--   other fleets                -> untouched
--
-- Applied to the live database 22-08-2026: closed all 8 outstanding activity
-- alerts on Audacious and raised none, all four books being current.

create or replace function public.resolve_activity_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare closed int := 0; n int;
begin
  -- The thresholds, exactly as the generator reads them.
  create temp table if not exists _cfg on commit drop as
  select f.id as fleet_id,
         coalesce((s.data->>'activity_engine_days')::int, 2)    as engine_days,
         coalesce((s.data->>'activity_fuel_days')::int, 10)     as fuel_days,
         coalesce((s.data->>'activity_garbage_days')::int, 10)  as garbage_days,
         coalesce((s.data->>'activity_crewlist_days')::int, 10) as crewlist_days
    from public.fleets f left join public.alert_settings s on s.fleet_id = f.id;

  -- ENGINE LOG ------------------------------------------------------------
  with cur as (
    select c.fleet_id,
           case when (current_date - max(e.log_date)) >= c.engine_days
                then 'nolog:engine:' || max(e.log_date) end as valid_key
      from _cfg c join public.engine_logs e on e.fleet_id = c.fleet_id
     group by c.fleet_id, c.engine_days)
  update public.alerts a set dismissed_at = now()
    from cur
   where a.fleet_id = cur.fleet_id and a.type = 'log_engine'
     and a.dismissed_at is null
     -- Either the book is fresh again (valid_key null), or this alert is a
     -- previous episode that a later one has superseded.
     and (cur.valid_key is null or a.dedup_key is distinct from cur.valid_key);
  get diagnostics n = row_count; closed := closed + n;

  -- BUNKERING -------------------------------------------------------------
  with cur as (
    select c.fleet_id,
           case when (current_date - max(v.entry_date)) >= c.fuel_days
                then 'nolog:fuel:' || max(v.entry_date) end as valid_key
      from _cfg c join public.vessel_fuel_log v on v.fleet_id = c.fleet_id
     where v.kind = 'fuel'
     group by c.fleet_id, c.fuel_days)
  update public.alerts a set dismissed_at = now()
    from cur
   where a.fleet_id = cur.fleet_id and a.type = 'log_fuel'
     and a.dismissed_at is null
     and (cur.valid_key is null or a.dedup_key is distinct from cur.valid_key);
  get diagnostics n = row_count; closed := closed + n;

  -- GARBAGE RECORD BOOK ---------------------------------------------------
  with cur as (
    select c.fleet_id,
           case when (current_date - max(g.entry_date)) >= c.garbage_days
                then 'nolog:garbage:' || max(g.entry_date) end as valid_key
      from _cfg c join public.garbage_log g on g.fleet_id = c.fleet_id
     group by c.fleet_id, c.garbage_days)
  update public.alerts a set dismissed_at = now()
    from cur
   where a.fleet_id = cur.fleet_id and a.type = 'log_garbage'
     and a.dismissed_at is null
     and (cur.valid_key is null or a.dedup_key is distinct from cur.valid_key);
  get diagnostics n = row_count; closed := closed + n;

  -- CREW LIST -------------------------------------------------------------
  with cur as (
    select c.fleet_id,
           case when (current_date - max(l.created_at)::date) >= c.crewlist_days
                then 'nolog:crewlist:' || max(l.created_at)::date end as valid_key
      from _cfg c join public.crew_lists l on l.fleet_id = c.fleet_id
     group by c.fleet_id, c.crewlist_days)
  update public.alerts a set dismissed_at = now()
    from cur
   where a.fleet_id = cur.fleet_id and a.type = 'log_crewlist'
     and a.dismissed_at is null
     and (cur.valid_key is null or a.dedup_key is distinct from cur.valid_key);
  get diagnostics n = row_count; closed := closed + n;

  /* MAINTENANCE — the same argument. A job that has been done since is not due,
   * and the alert for it should go without anyone tidying up after it. Any open
   * maint_due whose key is no longer in the current due set is closed. */
  with hours_now as (
    select el.fleet_id, max(el.running_hours) h from public.engine_logs el
     where el.running_hours is not null group by el.fleet_id),
  last_done as (
    select distinct on (e.task_id) e.task_id, e.done_on, e.running_hours
      from public.maintenance_events e order by e.task_id, e.done_on desc),
  due as (
    select t.id, t.fleet_id, t.interval_days, t.interval_hours,
           case when t.interval_days is not null and d.done_on is not null
                then d.done_on + t.interval_days end due_on,
           case when t.interval_hours is not null and d.running_hours is not null and hn.h is not null
                then hn.h - d.running_hours end hours_since
      from public.maintenance_tasks t
      join last_done d on d.task_id = t.id
      left join hours_now hn on hn.fleet_id = t.fleet_id
     where t.active),
  keys as (
    select fleet_id,
           'maintdue:' || id || ':' || coalesce(due_on::text, '') || ':' ||
             coalesce((round(hours_since / greatest(interval_hours, 1) * 20))::text, '') as k
      from due
     where (due_on is not null and due_on - current_date <= 2)
        or (hours_since is not null and interval_hours is not null and hours_since >= interval_hours * 0.95))
  update public.alerts a set dismissed_at = now()
   where a.type = 'maint_due'
     and a.dismissed_at is null
     and not exists (select 1 from keys k where k.fleet_id = a.fleet_id and k.k = a.dedup_key);
  get diagnostics n = row_count; closed := closed + n;

  return closed;
end $function$;

comment on function public.resolve_activity_alerts() is
  'Closes activity and maintenance-due alerts whose condition no longer holds — the book has been written in, or the job done. Called at the top of generate_activity_alerts(). Without it an alert stayed open forever and the digest re-listed it every morning.';

grant execute on function public.resolve_activity_alerts() to authenticated;

-- generate_activity_alerts() gains, as its FIRST statement:
--
--   perform public.resolve_activity_alerts();
--
-- applied in place rather than by retyping that function, which is long and
-- where a transcription slip would be worse than the bug being fixed.
