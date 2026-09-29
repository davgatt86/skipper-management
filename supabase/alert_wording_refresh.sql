/* AN ALERT'S WORDING IS REFRESHED WHILE IT IS OPEN. Sep 2026.
 *
 * David's 29-09 digest said *"Engine log — nothing written for 2 days"* on a
 * morning when the last entry was **ten days old**, and *"Crew list — none saved
 * for 7 days"* when the last one was saved twenty days before. Neither figure was
 * wrong when it was written; both were written once, on the morning the book went
 * stale, and then re-sent every day afterwards unchanged.
 *
 * THE KEY IS RIGHT AND THE BODY IS STALE, WHICH IS WHY THIS IS NOT A DEDUP
 * PROBLEM. `nolog:engine:2026-09-19` is deliberately one alert per EPISODE — the
 * date in it is the last entry, so it stays put while the book stays quiet and
 * changes the moment somebody writes in it. That is what stops one stale book
 * raising an alert a day. But the title and body carry a COUNT OF DAYS, and a
 * count of days moves every morning while the key does not.
 *
 * So `on conflict do nothing` was keeping the row and throwing away the only part
 * of it that had changed. It is `do update` now, on the title, the body, the
 * severity and the meta.
 *
 * A DISMISSED ALERT IS NEVER TOUCHED. It has been answered, and re-wording it
 * would be arguing with the man who dismissed it. A READ one IS refreshed — the
 * digest skips it either way, and the Alerts page should not show him a sentence
 * eight days out of date.
 *
 * MAINTENANCE HAD THE SAME FAULT AND ONE WORSE. Its days-based key is
 * `maintdue:<task>:<due_on>:` — unchanged when a job crosses its due date — so a
 * task alerted two days early said **"due soon"** for ever, in `info` grey,
 * including after it fell due. The refresh flips it to "due now" and to `warn`,
 * which is the one case here where the stale wording understated the thing.
 *
 * The count these functions return now means "raised or refreshed" rather than
 * "raised". Nothing reads it — the cron discards it — and the alternative was an
 * xmax test to tell an insert from an update for a number nobody uses.
 */

create or replace function public.generate_activity_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare inserted int := 0; n int;   -- raised OR refreshed
begin
  /* FIRST: close anything whose condition no longer holds — the book has been
   * written in, or the job done. Without this an alert stayed open forever and
   * the digest re-listed it every morning; David was told the engine log was
   * two days stale on a morning he had already written in it, twice, with two
   * different dates. */
  perform public.resolve_activity_alerts();

  with cfg as (
    select f.id as fleet_id,
           coalesce((s.data->>'activity_engine_days')::int, 2)     as engine_days,
           coalesce((s.data->>'activity_fuel_days')::int, 10)      as fuel_days,
           coalesce((s.data->>'activity_garbage_days')::int, 10)   as garbage_days,
           coalesce((s.data->>'activity_crewlist_days')::int, 10)  as crewlist_days,
           coalesce((s.data->>'activity_enabled')::boolean, true)  as enabled
      from public.fleets f left join public.alert_settings s on s.fleet_id = f.id
  ),
  eng as (select c.fleet_id, max(e.log_date) last_on, c.engine_days lim
            from cfg c join public.engine_logs e on e.fleet_id=c.fleet_id
           where c.enabled group by c.fleet_id, c.engine_days),
  eng_due as (select fleet_id,last_on,(current_date-last_on) days from eng where (current_date-last_on)>=lim),
  ins_eng as (
    insert into public.alerts (fleet_id,type,severity,title,body,meta,dedup_key)
    select fleet_id,'log_engine','warn',
           'Engine log — nothing written for '||public.plural_days(days),
           'Last entry was '||to_char(last_on,'DD-MM-YYYY')||'. Readings are what show a fault coming before it arrives.',
           jsonb_build_object('last_on',last_on,'days',days,'link','/engine-logs'),
           'nolog:engine:'||last_on
      from eng_due
    on conflict (fleet_id,dedup_key) do update
       set severity=excluded.severity, title=excluded.title,
           body=excluded.body, meta=excluded.meta
     where alerts.dismissed_at is null
    returning 1),
  fuel as (select c.fleet_id, max(v.entry_date) last_on, c.fuel_days lim
             from cfg c join public.vessel_fuel_log v on v.fleet_id=c.fleet_id
            where c.enabled and v.kind='fuel' group by c.fleet_id, c.fuel_days),
  fuel_due as (select fleet_id,last_on,(current_date-last_on) days from fuel where (current_date-last_on)>=lim),
  ins_fuel as (
    insert into public.alerts (fleet_id,type,severity,title,body,meta,dedup_key)
    select fleet_id,'log_fuel','info',
           'Bunkering — nothing logged for '||public.plural_days(days),
           'Last fuel entry was '||to_char(last_on,'DD-MM-YYYY')||'. A missed bunkering is what put the fuel loop out by 271,726 litres.',
           jsonb_build_object('last_on',last_on,'days',days,'link','/fuel-log'),
           'nolog:fuel:'||last_on
      from fuel_due
    on conflict (fleet_id,dedup_key) do update
       set severity=excluded.severity, title=excluded.title,
           body=excluded.body, meta=excluded.meta
     where alerts.dismissed_at is null
    returning 1),
  garb as (select c.fleet_id, max(g.entry_date) last_on, c.garbage_days lim
             from cfg c join public.garbage_log g on g.fleet_id=c.fleet_id
            where c.enabled group by c.fleet_id, c.garbage_days),
  garb_due as (select fleet_id,last_on,(current_date-last_on) days from garb where (current_date-last_on)>=lim),
  ins_garb as (
    insert into public.alerts (fleet_id,type,severity,title,body,meta,dedup_key)
    select fleet_id,'log_garbage','warn',
           'Garbage Record Book — nothing entered for '||public.plural_days(days),
           'Last entry was '||to_char(last_on,'DD-MM-YYYY')||'. MARPOL Annex V requires the book to be kept up; it is inspectable.',
           jsonb_build_object('last_on',last_on,'days',days,'link','/garbage-log'),
           'nolog:garbage:'||last_on
      from garb_due
    on conflict (fleet_id,dedup_key) do update
       set severity=excluded.severity, title=excluded.title,
           body=excluded.body, meta=excluded.meta
     where alerts.dismissed_at is null
    returning 1),
  cl as (select c.fleet_id, max(l.created_at)::date last_on, c.crewlist_days lim
           from cfg c join public.crew_lists l on l.fleet_id=c.fleet_id
          where c.enabled group by c.fleet_id, c.crewlist_days),
  cl_due as (select fleet_id,last_on,(current_date-last_on) days from cl where (current_date-last_on)>=lim),
  ins_cl as (
    insert into public.alerts (fleet_id,type,severity,title,body,meta,dedup_key)
    select fleet_id,'log_crewlist','info',
           'Crew list — none saved for '||public.plural_days(days),
           'Last one was saved '||to_char(last_on,'DD-MM-YYYY')||'. A crew list is a border document and should match who is actually aboard.',
           jsonb_build_object('last_on',last_on,'days',days,'link','/crew-list'),
           'nolog:crewlist:'||last_on
      from cl_due
    on conflict (fleet_id,dedup_key) do update
       set severity=excluded.severity, title=excluded.title,
           body=excluded.body, meta=excluded.meta
     where alerts.dismissed_at is null
    returning 1)
  select (select count(*) from ins_eng)+(select count(*) from ins_fuel)
       + (select count(*) from ins_garb)+(select count(*) from ins_cl) into inserted;

  with hours_now as (
    select el.fleet_id, max(el.running_hours) h from public.engine_logs el
     where el.running_hours is not null group by el.fleet_id),
  last_done as (
    select distinct on (e.task_id) e.task_id, e.done_on, e.running_hours
      from public.maintenance_events e order by e.task_id, e.done_on desc),
  due as (
    select t.id,t.fleet_id,t.name,t.interval_days,t.interval_hours,d.done_on,
           case when t.interval_days is not null and d.done_on is not null then d.done_on+t.interval_days end due_on,
           case when t.interval_hours is not null and d.running_hours is not null and hn.h is not null
                then hn.h-d.running_hours end hours_since
      from public.maintenance_tasks t
      join last_done d on d.task_id=t.id
      left join hours_now hn on hn.fleet_id=t.fleet_id
     where t.active)
  insert into public.alerts (fleet_id,type,severity,title,body,meta,dedup_key)
  select fleet_id,'maint_due',
         case when (due_on is not null and due_on<=current_date)
                or (hours_since is not null and interval_hours is not null and hours_since>=interval_hours)
              then 'warn' else 'info' end,
         name||' — '||case when (due_on is not null and due_on<=current_date)
                             or (hours_since is not null and interval_hours is not null and hours_since>=interval_hours)
                           then 'due now' else 'due soon' end,
         'Last done '||to_char(done_on,'DD-MM-YYYY')||
           coalesce('. Due '||to_char(due_on,'DD-MM-YYYY'),'')||
           coalesce('. '||round(hours_since)||' of '||round(interval_hours)||' running hours used','')||'.',
         jsonb_build_object('task_id',id,'due_on',due_on,'hours_since',hours_since,'link','/maintenance'),
         'maintdue:'||id||':'||coalesce(due_on::text,'')||':'||
           coalesce((round(hours_since/greatest(interval_hours,1)*20))::text,'')
    from due
   where (due_on is not null and due_on-current_date<=2)
      or (hours_since is not null and interval_hours is not null and hours_since>=interval_hours*0.95)
  /* "due soon" becomes "due now" on the day, and grey becomes brass with it. */
  on conflict (fleet_id,dedup_key) do update
     set severity=excluded.severity, title=excluded.title,
         body=excluded.body, meta=excluded.meta
   where alerts.dismissed_at is null;
  get diagnostics n = row_count; inserted := inserted + n;
  return inserted;
end $function$;
