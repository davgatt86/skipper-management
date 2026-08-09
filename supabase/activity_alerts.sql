-- Alerts for a book that has quietly stopped being written in.
--
-- The compliance alerts catch a certificate running out. These catch the other
-- failure: nobody has touched the engine log for three days, or the garbage
-- record book since last month. Nothing expires, so nothing else notices.
--
--   engine log      no entry for 48 hours
--   bunkering       no fuel entry for 10 days
--   garbage book    no entry for 10 days
--   crew list       none saved for 10 days
--   maintenance     a task falling due within 2 days
--
-- THE GUARD THAT MAKES THIS USABLE. A fleet is only alerted about a book it has
-- ALREADY USED at least once. Eleven of the twelve fleets have never made an
-- engine-log or garbage entry, and nagging them daily about a book they have
-- never opened is how a person learns to ignore the sender. "You have not
-- started the garbage record book" is a conversation, not a recurring alert.
--
-- ONE ALERT PER EPISODE, NOT ONE PER DAY. The dedup key carries the date of the
-- LAST ENTRY, so a book that goes stale raises one alert and stays quiet until
-- somebody writes in it and lets it go stale again. The digest keeps showing it
-- while it is unread, which is the nagging — the alert table does not repeat.
--
-- Thresholds are per fleet in alert_settings.data, so a boat that logs weekly
-- is not held to a daily standard. Defaults below.

-- "nothing written for 1 days" is the kind of thing that makes a tool feel
-- unfinished, and this text goes straight into an email to a skipper.
create or replace function public.plural_days(n int)
returns text language sql immutable as $fn$
  select n || ' day' || case when n = 1 then '' else 's' end
$fn$;

create or replace function public.generate_activity_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare inserted int := 0; n int;
begin
  -- Per-fleet thresholds, defaulted.
  with cfg as (
    select f.id as fleet_id,
           coalesce((s.data->>'activity_engine_days')::int, 2)     as engine_days,
           coalesce((s.data->>'activity_fuel_days')::int, 10)      as fuel_days,
           coalesce((s.data->>'activity_garbage_days')::int, 10)   as garbage_days,
           coalesce((s.data->>'activity_crewlist_days')::int, 10)  as crewlist_days,
           coalesce((s.data->>'activity_enabled')::boolean, true)  as enabled
      from public.fleets f
      left join public.alert_settings s on s.fleet_id = f.id
  ),

  -- 1. Engine log ----------------------------------------------------------
  eng as (
    select c.fleet_id, max(e.log_date) as last_on, c.engine_days as lim
      from cfg c join public.engine_logs e on e.fleet_id = c.fleet_id
     where c.enabled
     group by c.fleet_id, c.engine_days
  ),
  eng_due as (
    select fleet_id, last_on, (current_date - last_on) as days
      from eng where (current_date - last_on) >= lim
  ),
  ins_eng as (
    insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
    select fleet_id, 'log_engine', 'warn',
           'Engine log — nothing written for ' || public.plural_days(days),
           'Last entry was ' || to_char(last_on, 'DD-MM-YYYY') ||
             '. Readings are what show a fault coming before it arrives.',
           jsonb_build_object('last_on', last_on, 'days', days, 'link', '/engine-logs'),
           'nolog:engine:' || last_on
      from eng_due
    on conflict (fleet_id, dedup_key) do nothing
    returning 1
  ),

  -- 2. Bunkering -----------------------------------------------------------
  fuel as (
    select c.fleet_id, max(v.entry_date) as last_on, c.fuel_days as lim
      from cfg c join public.vessel_fuel_log v on v.fleet_id = c.fleet_id
     where c.enabled and v.kind = 'fuel'
     group by c.fleet_id, c.fuel_days
  ),
  fuel_due as (
    select fleet_id, last_on, (current_date - last_on) as days
      from fuel where (current_date - last_on) >= lim
  ),
  ins_fuel as (
    insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
    select fleet_id, 'log_fuel', 'info',
           'Bunkering — nothing logged for ' || public.plural_days(days),
           'Last fuel entry was ' || to_char(last_on, 'DD-MM-YYYY') ||
             '. A missed bunkering is what put the fuel loop out by 271,726 litres.',
           jsonb_build_object('last_on', last_on, 'days', days, 'link', '/fuel-log'),
           'nolog:fuel:' || last_on
      from fuel_due
    on conflict (fleet_id, dedup_key) do nothing
    returning 1
  ),

  -- 3. Garbage record book -------------------------------------------------
  garb as (
    select c.fleet_id, max(g.entry_date) as last_on, c.garbage_days as lim
      from cfg c join public.garbage_log g on g.fleet_id = c.fleet_id
     where c.enabled
     group by c.fleet_id, c.garbage_days
  ),
  garb_due as (
    select fleet_id, last_on, (current_date - last_on) as days
      from garb where (current_date - last_on) >= lim
  ),
  ins_garb as (
    insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
    select fleet_id, 'log_garbage', 'warn',
           'Garbage Record Book — nothing entered for ' || public.plural_days(days),
           'Last entry was ' || to_char(last_on, 'DD-MM-YYYY') ||
             '. MARPOL Annex V requires the book to be kept up; it is inspectable.',
           jsonb_build_object('last_on', last_on, 'days', days, 'link', '/garbage-log'),
           'nolog:garbage:' || last_on
      from garb_due
    on conflict (fleet_id, dedup_key) do nothing
    returning 1
  ),

  -- 4. Crew list -----------------------------------------------------------
  cl as (
    select c.fleet_id, max(l.created_at)::date as last_on, c.crewlist_days as lim
      from cfg c join public.crew_lists l on l.fleet_id = c.fleet_id
     where c.enabled
     group by c.fleet_id, c.crewlist_days
  ),
  cl_due as (
    select fleet_id, last_on, (current_date - last_on) as days
      from cl where (current_date - last_on) >= lim
  ),
  ins_cl as (
    insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
    select fleet_id, 'log_crewlist', 'info',
           'Crew list — none saved for ' || public.plural_days(days),
           'Last one was saved ' || to_char(last_on, 'DD-MM-YYYY') ||
             '. A crew list is a border document and should match who is actually aboard.',
           jsonb_build_object('last_on', last_on, 'days', days, 'link', '/crew-list'),
           'nolog:crewlist:' || last_on
      from cl_due
    on conflict (fleet_id, dedup_key) do nothing
    returning 1
  )
  select (select count(*) from ins_eng) + (select count(*) from ins_fuel)
       + (select count(*) from ins_garb) + (select count(*) from ins_cl)
    into inserted;

  -- 5. Maintenance falling due --------------------------------------------
  -- Kept out of the CTE above because it needs the latest running hours, and
  -- the two clocks are worked out differently:
  --   days-based  → alert when the due DATE is within the lead time
  --   hours-based → alert at 95% of the interval. "48 hours before due" has no
  --                 meaning for an hours interval without knowing the daily
  --                 burn, and guessing that would be worse than a percentage.
  -- max(), not "the latest log's reading": running hours only ever go up, so
  -- the two agree — and max() is not fooled by a trip entered out of order.
  with hours_now as (
    select el.fleet_id, max(el.running_hours) as h
      from public.engine_logs el
     where el.running_hours is not null
     group by el.fleet_id
  ),
  last_done as (
    select distinct on (e.task_id) e.task_id, e.done_on, e.running_hours
      from public.maintenance_events e
     order by e.task_id, e.done_on desc
  ),
  due as (
    select t.id, t.fleet_id, t.name, t.interval_days, t.interval_hours,
           d.done_on, d.running_hours as done_at_h, hn.h as now_h,
           case when t.interval_days is not null and d.done_on is not null
                then d.done_on + t.interval_days end as due_on,
           case when t.interval_hours is not null and d.running_hours is not null and hn.h is not null
                then hn.h - d.running_hours end as hours_since
      from public.maintenance_tasks t
      join last_done d on d.task_id = t.id
      left join hours_now hn on hn.fleet_id = t.fleet_id
     where t.active
  )
  insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select fleet_id, 'maint_due',
         case when (due_on is not null and due_on <= current_date)
                or (hours_since is not null and interval_hours is not null and hours_since >= interval_hours)
              then 'warn' else 'info' end,
         name || ' — ' ||
           case when (due_on is not null and due_on <= current_date)
                  or (hours_since is not null and interval_hours is not null and hours_since >= interval_hours)
                then 'due now' else 'due soon' end,
         'Last done ' || to_char(done_on, 'DD-MM-YYYY') ||
           coalesce('. Due ' || to_char(due_on, 'DD-MM-YYYY'), '') ||
           coalesce('. ' || round(hours_since) || ' of ' || round(interval_hours) || ' running hours used', '') || '.',
         jsonb_build_object('task_id', id, 'due_on', due_on, 'hours_since', hours_since, 'link', '/maintenance'),
         'maintdue:' || id || ':' || coalesce(due_on::text, '') || ':' ||
           coalesce((round(hours_since / greatest(interval_hours,1) * 20))::text, '')
    from due
   where (due_on is not null and due_on - current_date <= 2)
      or (hours_since is not null and interval_hours is not null
          and hours_since >= interval_hours * 0.95)
  on conflict (fleet_id, dedup_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  return inserted;
end $$;

comment on function public.generate_activity_alerts() is
  'Raises alerts for logs that have stopped being written and maintenance '
  'falling due. Only alerts a fleet about a book it has already used at least '
  'once. SECURITY DEFINER and fleet_id taken from each source row, so it runs '
  'correctly from cron with no auth.uid().';

-- Onto the existing daily job, beside the expiry checks.
select cron.unschedule('compliance-alerts-daily')
where exists (select 1 from cron.job where jobname = 'compliance-alerts-daily');

select cron.schedule(
  'compliance-alerts-daily',
  '0 6 * * *',
  $$select public.generate_compliance_alerts(60),
           public.generate_bonus_alerts(30),
           public.generate_activity_alerts();$$
);
