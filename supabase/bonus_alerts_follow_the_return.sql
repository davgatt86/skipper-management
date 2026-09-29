/* THE GOING-HOME BONUS IS CHASED WHEN IT IS DUE, AND THE ALERT CLEARS ITSELF.
 * Sep 2026.
 *
 * David: *"elizer bonus was already paid, why won't it clear? i keep getting
 * emails."* Two separate faults, and the first is the one that made it feel
 * broken.
 *
 * NOTHING EVER RESOLVED A BONUS ALERT. The logs got `resolve_activity_alerts`
 * and the certificates got `resolve_compliance_alerts`; `generate_bonus_alerts`
 * only ever INSERTED. So an alert raised on 18-09 stays open whatever is paid
 * afterwards, and the 07:00 digest re-lists it every morning. Dismissing it by
 * hand would have silenced it — and, because the unique key is (fleet_id,
 * dedup_key) whether or not a row is dismissed, that alert could then never
 * raise again on that contract while the money was still owed. Both halves of
 * that are wrong.
 *
 * AND IT CHASED MONEY THAT WAS NOT DUE. The boat's rule is HALF ON GOING HOME,
 * HALF ON RETURN, and the Contracts page says so on the row — "2nd £3,500 on
 * return". The generator took the whole outstanding balance from `end_date`, so
 * a man who went home in August was reported as owing the second half in
 * September, months before he is back. The page and the alert disagreed and the
 * page was right. Elizer Tano is the case: £7,000, first half paid 27-08, and
 * the second half genuinely not due yet — David, asked: *"not paid yet — due
 * when he returns."*
 *
 * SO EACH HALF IS ITS OWN ALERT, with its own key and its own date:
 *   first   due at end_date     — he has gone home
 *   second  due at return_date  — he is back
 *
 * ONE DEFINITION OF "DUE", USED BY BOTH. `bonus_halves_due()` is the only place
 * the rule lives; the generator raises what it returns and the resolver closes
 * anything NOT in it. Two copies of this rule would drift the first time one was
 * edited, and the drift would look like an alert that will not clear.
 *
 * A MAN WHO DOES NOT RETURN FORFEITS THE SECOND HALF. David's call, asked
 * outright: *"forfeited outright."* The status enum had no way to say it — only
 * current / pending_return / completed — so the only way out of "gone home" was
 * **Returned**, which would have recorded a return that never happened and made
 * the second half due. `not_returning` is the fourth value, `not_returning_on`
 * records the day it was decided, and the contract drops out of the due list
 * altogether: nothing is chased and the page stops offering to pay it.
 *
 * THE OTHER TWO LINES OF THAT SAME DIGEST WERE A DIFFERENT FAULT, and it is
 * worth writing down what it was NOT. "Engine log — nothing written for 2 days"
 * arrived on a day when the last entry was ten days old, and the obvious reading
 * is that nothing had closed a superseded episode. It is the wrong reading:
 * `generate_activity_alerts` performs `resolve_activity_alerts` on its own first
 * line, so it ran every morning, and it correctly left that alert open because
 * the book was still stale and its key — the last entry date — had not moved.
 * The COUNT OF DAYS in the title had. See supabase/alert_wording_refresh.sql.
 *
 * So this generator closes before it raises, the same shape, and refreshes an
 * open alert rather than leaving yesterday's sentence on it. The cron calls two
 * generators instead of three resolvers and three generators, because an order
 * that cannot be got wrong is better than one written down correctly.
 */

-- The column lives with the enum in supabase/contract_status_not_returning.sql.
alter table public.contracts add column if not exists not_returning_on date;

/* WHAT IS ACTUALLY DUE, one half at a time.
 *
 * `lead_days` looks ahead, so the daily run can say "due soon" before the day
 * arrives; the resolver passes a decade, because a half that will be due one day
 * is not an alert to close.
 *
 * The halves are split the way the page splits them — `settings.ghb_first_half_pct`
 * per fleet, defaulting to half — and paid-ness is the EXISTENCE of a payment of
 * that type, not a sum, which is again what the page reads. A part payment is a
 * question for the skipper, not something to net off silently.
 */
create or replace function public.bonus_halves_due(lead_days integer default 30)
returns table (fleet_id uuid, contract_id uuid, crew_id uuid, full_name text,
               half text, amount numeric, total numeric, due_on date, dedup_key text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cfg as (
    select f.id as fleet_id,
           coalesce(case when s.ghb_first_half_pct > 1 then s.ghb_first_half_pct / 100
                         else s.ghb_first_half_pct end, 0.5) as pct
      from public.fleets f
      left join public.settings s on s.fleet_id = f.id
  ),
  ct as (
    select c.fleet_id, c.id, c.crew_id, cr.full_name, c.end_date, c.return_date,
           c.going_home_bonus as total,
           round(c.going_home_bonus * cfg.pct, 2) as first_amt,
           c.going_home_bonus - round(c.going_home_bonus * cfg.pct, 2) as second_amt,
           exists (select 1 from public.payments p
                    where p.contract_id = c.id and p.payment_type = 'ghb_first_half') as first_paid,
           exists (select 1 from public.payments p
                    where p.contract_id = c.id and p.payment_type = 'ghb_second_half') as second_paid
      from public.contracts c
      join public.crew cr on cr.id = c.crew_id
      join cfg on cfg.fleet_id = c.fleet_id
     where c.going_home_bonus is not null
       and c.going_home_bonus > 0
       and cr.archived_at is null
       -- Forfeited: he went home and is not coming back.
       and c.status <> 'not_returning'
  )
  select fleet_id, id, crew_id, full_name, 'first', first_amt, total, end_date,
         'bonus:' || id || ':' || end_date || ':first'
    from ct
   where not first_paid
     and end_date is not null
     and end_date <= current_date + lead_days
  union all
  select fleet_id, id, crew_id, full_name, 'second', second_amt, total, return_date,
         'bonus:' || id || ':' || return_date || ':second'
    from ct
   where not second_paid
     and return_date is not null
     and return_date <= current_date + lead_days
$function$;

/* Close any open bonus alert that is no longer a thing to chase — paid,
 * forfeited, not due yet, the crewman archived, the contract deleted, or the
 * figure changed. Keyed off the same due list the generator raises from, so
 * there is nothing to keep in step. */
create or replace function public.resolve_bonus_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  update public.alerts a set dismissed_at = now()
   where a.type = 'crew_bonus'
     and a.dismissed_at is null
     and not exists (
       select 1 from public.bonus_halves_due(3650) d
        where d.fleet_id = a.fleet_id and d.dedup_key = a.dedup_key);
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.generate_bonus_alerts(lead_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare inserted int;  -- raised OR refreshed; the cron discards it
begin
  /* CLOSE BEFORE RAISING, the same shape as generate_activity_alerts. One duty in
   * one call is what stops it being scheduled in the wrong order — or left out
   * altogether, which is exactly what happened to resolve_activity_alerts. */
  perform public.resolve_bonus_alerts();

  insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select d.fleet_id,
         'crew_bonus',
         case when d.due_on <= current_date then 'warn' else 'info' end,
         d.full_name || ' — going-home bonus, ' || d.half || ' half '
           || case when d.due_on <= current_date then 'due now' else 'due soon' end,
         case when d.half = 'first'
              then 'Went home ' || to_char(d.due_on, 'DD-MM-YYYY') || '. First half '
                   || to_char(d.amount, 'FM999999990.00') || ' of '
                   || to_char(d.total, 'FM999999990.00')
                   || '. The second half is not due until he returns.'
              else 'Returned ' || to_char(d.due_on, 'DD-MM-YYYY') || '. Second half '
                   || to_char(d.amount, 'FM999999990.00') || ' of '
                   || to_char(d.total, 'FM999999990.00') || ' now due.'
         end,
         jsonb_build_object('crew_id', d.crew_id, 'contract_id', d.contract_id,
                            'half', d.half, 'amount', d.amount, 'link', '/contracts'),
         d.dedup_key
    from public.bonus_halves_due(lead_days) d
  /* REFRESH AN OPEN ONE RATHER THAN LEAVING YESTERDAY'S SENTENCE ON IT. The key
   * carries the DATE, so it does not move while the money stays owed — but the
   * wording says "due soon" or "due now", and that does. Left alone, an alert
   * raised a week before the day still reads "due soon" after it has fallen due.
   * A DISMISSED one is never touched: it has been answered. */
  on conflict (fleet_id, dedup_key) do update
     set severity = excluded.severity, title = excluded.title,
         body = excluded.body, meta = excluded.meta
   where alerts.dismissed_at is null;
  get diagnostics inserted = row_count;
  return inserted;
end $function$;

revoke all on function public.bonus_halves_due(integer) from anon;
revoke all on function public.resolve_bonus_alerts() from anon;

/* The daily job. The bonus and activity generators each close before they raise,
 * so there is no order to get wrong; only the compliance pair is still two calls.
 * Supersedes the command recorded in supabase/alert_cron.sql, which called the
 * compliance resolver and the three generators — and so never closed a bonus or
 * a book alert at all. */
select cron.schedule(
  'compliance-alerts-daily',
  '0 6 * * *',
  $$select public.resolve_compliance_alerts(), public.generate_compliance_alerts(60),
           public.generate_bonus_alerts(30), public.generate_activity_alerts();$$
);
