/* THE PRICE ALERTS WERE BURYING THE ONES THAT MATTER — Sep 2026.
 *
 * THIS SUPERSEDES `generate_alerts()` AS DEFINED IN `alert_noise.sql` (Aug
 * 2026), which is the file that first tamed this stream: it rolled a species up
 * from its grades, added a cooldown so a standing condition is one episode
 * rather than one alert a day, and capped each run. Its measurement — 4,781 live
 * price alerts against 2 that mattered — is still the argument for all three,
 * and none of it is undone here. What is added is the cap this one missed.
 *
 * THIS SUPERSEDES `generate_alerts()` AS DEFINED IN `alert_noise.sql` (Aug
 * 2026), which is the file that first tamed this stream: it rolled a species up
 * from its grades, added a cooldown so a standing condition is one episode
 * rather than one alert a day, and capped each run. Its measurement — 4,781 live
 * price alerts against 2 that mattered — is still the argument for all three,
 * and none of it is undone here. What is added is the cap this one missed.
 *
 * David: *"fix alert noise to reduce alerts."* Measured first: 105 unread alerts
 * on Audacious, and **104 of them were market prices**. The one that was not —
 * a fire extinguisher certificate reported expired — was the only alert on the
 * page worth acting on, and it was thirteenth from the top.
 *
 * THREE CAUSES, AND THE CAP WAS THE WORST OF THEM.
 *
 * 1. `price_max_per_run` is 3, which reads like "three a day" and was not:
 *    `market-alerts` runs EVERY THREE HOURS, so the real ceiling was 3 x 5
 *    types x 8 runs. The note in `alert_cron.sql` said the extra runs "raise
 *    nothing new" because the dedup key carries the board's date — true of one
 *    species and false of the stream: the key is per species, so each run was
 *    free to raise three MORE species. A cap per run is not a cap.
 *
 *    So there is now a cap per DAY as well (`price_max_per_day`, 4), counted
 *    across every price type. It takes the biggest movers first, so what
 *    survives the cap is the part worth reading. `price_max_per_run` stays as
 *    the per-run limit.
 *
 * 2. A price alert lived 21 days. A board that moved three weeks ago is not
 *    news; it is not even true any more. `price_expire_days` is 7.
 *
 * 3. The Forecast page raised one alert PER FORECAST DAY — 26 in a single
 *    visit, about the table the skipper was looking at while it happened. That
 *    half is fixed in `src/pages/Forecast.jsx`: the soonest likely landing per
 *    boat, and nothing else.
 *
 * AND THE COMPLIANCE ALERTS NEVER CLEARED THEMSELVES, which is the other half
 * of the same complaint. `resolve_activity_alerts.sql` closed this for the
 * books — write in a log and its alert goes — but an EXPIRY alert stayed open
 * for ever once raised. Audacious's extinguisher certificate now runs to
 * 05-03-2030 and the "expired on 26-08-2026" alert was still sitting unread,
 * so the one stream that must stay believable was carrying a stale row.
 *
 * `resolve_compliance_alerts()` dismisses an expiry alert whose subject no
 * longer matches: the dedup key carries the id AND the expiry date it was
 * raised for, so a renewal changes the date and the old alert resolves. It is
 * deliberately keyed on the row rather than on a date comparison — a
 * certificate that was deleted, or a crewman since archived, resolves too.
 *
 * The generator is left alone otherwise. Nothing here changes what counts as a
 * breach: the thresholds are the skipper's in `alert_settings`, and a quieter
 * stream is a cap on how much is said at once, not a decision that less is
 * happening.
 */

-- 1. The price generator, capped per day -------------------------------------
-- The `todays` CTE is WHAT HAS ALREADY BEEN SAID TODAY, across every price type
-- and however it got there — the Forecast page writes into this stream too, so
-- it spends from the same budget rather than beside it.
create or replace function public.generate_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  update alerts a
     set dismissed_at = now()
    from (
      select f.id fleet_id,
             coalesce((s.data->>'price_expire_days')::int, 7) expire_days
        from fleets f left join alert_settings s on s.fleet_id = f.id
    ) st
   where a.fleet_id = st.fleet_id
     and a.type in ('daily','fourweek','pd_dk','own_spike','forecast')
     and a.dismissed_at is null
     and a.created_at < now() - make_interval(days => st.expire_days);

  with
  g as (
    select source, species, price_date,
           grade || coalesce(' ' || subgrade, '') as gr,
           avg(ave)::numeric as pkg
    from market_prices where ave > 0
    group by source, species, price_date, grade, subgrade
  ),
  r as (select *, dense_rank() over (partition by source, species order by price_date desc) rd from g),
  cur as (select * from r where rd = 1),
  prv as (select * from r where rd = 2),
  dgrade as (
    select c.source, c.species, c.gr, c.price_date, p.pkg as was, c.pkg as now,
           (c.pkg - p.pkg) / p.pkg * 100 as pct
    from cur c
    join prv p on p.source = c.source and p.species = c.species and p.gr = c.gr
    where p.pkg > 0
  ),
  fw as (
    select source, species, gr, avg(pkg) as avg4, count(*) as nd
    from g where price_date >= current_date - 28
    group by source, species, gr
  ),
  fwgrade as (
    select c.source, c.species, c.gr, c.price_date, f.avg4, c.pkg as now,
           (c.pkg - f.avg4) / f.avg4 * 100 as pct
    from cur c
    join fw f on f.source = c.source and f.species = c.species and f.gr = c.gr
    where f.nd >= 5 and f.avg4 > 0
  ),
  pddk as (
    select pd.species, pd.gr, pd.pkg as pd_pkg, dk.pkg as dk_pkg,
           greatest(pd.price_date, dk.price_date) as price_date,
           abs(pd.pkg - dk.pkg) / least(pd.pkg, dk.pkg) * 100 as pct
    from cur pd
    join cur dk on dk.species = pd.species and dk.gr = pd.gr and dk.source = 'DK'
    where pd.source = 'PD' and least(pd.pkg, dk.pkg) > 0
  ),
  fleet_species as (
    select fleet_id, sp from (
      select l.fleet_id, r2.species_canon sp, sum(r2.weight_kg) kg,
             row_number() over (partition by l.fleet_id order by sum(r2.weight_kg) desc) rnk
      from sales_rows r2 join sales_landings l on l.id = r2.landing_id
      where l.landing_date >= current_date - 90 and r2.species_canon is not null and r2.weight_kg > 0
      group by l.fleet_id, r2.species_canon
    ) x where rnk <= 8
  ),
  fleet_grade_mix as (
    select l.fleet_id, r2.species_canon sp,
           coalesce(nullif(btrim(r2.grade), ''), '') gr,
           sum(r2.weight_kg) kg
    from sales_rows r2 join sales_landings l on l.id = r2.landing_id
    where l.landing_date >= current_date - 90 and r2.weight_kg > 0
    group by l.fleet_id, r2.species_canon, coalesce(nullif(btrim(r2.grade), ''), '')
  ),
  settings as (
    select f.id fleet_id,
      coalesce((s.data->>'daily_jump_pct')::numeric,15) daily_pct,
      coalesce((s.data->>'four_week_pct')::numeric,25)  fourweek_pct,
      coalesce((s.data->>'pd_dk_gap_pct')::numeric,20)  gap_pct,
      coalesce((s.data->>'own_spike_pct')::numeric,20)  own_pct,
      coalesce((s.data->>'enable_daily')::boolean,true)     en_daily,
      coalesce((s.data->>'enable_four_week')::boolean,true) en_fourweek,
      coalesce((s.data->>'enable_pd_dk')::boolean,true)     en_pddk,
      coalesce((s.data->>'enable_own')::boolean,true)       en_own,
      coalesce((s.data->>'price_cooldown_days')::int, 7)    cooldown_days,
      coalesce((s.data->>'price_max_per_run')::int, 3)      max_per_run,
      coalesce((s.data->>'price_max_per_day')::int, 4)      max_per_day
    from fleets f left join alert_settings s on s.fleet_id = f.id
  ),
  todays as (
    select fleet_id, count(*) n
      from alerts
     where type in ('daily','fourweek','pd_dk','own_spike','forecast')
       and created_at >= date_trunc('day', now())
     group by fleet_id
  ),
  own_g as (
    select l.fleet_id, r2.species_canon sp, l.landing_date,
           sum(r2.value)/nullif(sum(r2.weight_kg),0) pkg
    from sales_rows r2 join sales_landings l on l.id = r2.landing_id
    where l.landing_date >= current_date - 60 and r2.value > 0 and r2.weight_kg > 0
      and (l.currency is distinct from 'DKK' or l.fx_rate is not null)
    group by l.fleet_id, r2.species_canon, l.landing_date
  ),
  own_ranked as (
    select fleet_id, sp, landing_date, pkg,
           row_number() over (partition by fleet_id, sp order by landing_date desc) rn
    from own_g
  ),
  own_latest as (select fleet_id, sp, landing_date, pkg from own_ranked where rn = 1),
  own_avg as (select fleet_id, sp, avg(pkg) avgp, count(*) nl from own_ranked where rn > 1 group by fleet_id, sp),
  breaches as (
    select fs.fleet_id, 'daily'::text type, d.source::text source, d.species::text species,
           d.gr::text gr, d.price_date, d.pct, d.was as a_val, d.now as b_val
    from settings st
    join fleet_species fs on fs.fleet_id = st.fleet_id
    join dgrade d on d.species = fs.sp
    where st.en_daily and abs(d.pct) >= st.daily_pct
      and (not exists (select 1 from fleet_grade_mix m where m.fleet_id = fs.fleet_id and m.sp = fs.sp and m.gr <> '')
           or exists (select 1 from fleet_grade_mix m where m.fleet_id = fs.fleet_id and m.sp = fs.sp
                        and (upper(d.gr) like upper(m.gr)||'%' or upper(m.gr) like upper(d.gr)||'%')))
    union all
    select fs.fleet_id, 'fourweek', f.source::text, f.species::text, f.gr::text,
           f.price_date, f.pct, f.avg4, f.now
    from settings st
    join fleet_species fs on fs.fleet_id = st.fleet_id
    join fwgrade f on f.species = fs.sp
    where st.en_fourweek and f.pct >= st.fourweek_pct
    union all
    select fs.fleet_id, 'pd_dk', 'PD/DK', x.species::text, x.gr::text,
           x.price_date, x.pct, x.pd_pkg, x.dk_pkg
    from settings st
    join fleet_species fs on fs.fleet_id = st.fleet_id
    join pddk x on x.species = fs.sp
    where st.en_pddk and x.pct >= st.gap_pct
  ),
  rolled as (
    select fleet_id, type, source, species,
           max(price_date) as price_date,
           count(*) as grades,
           (array_agg(gr    order by abs(pct) desc))[1] as top_gr,
           (array_agg(pct   order by abs(pct) desc))[1] as top_pct,
           (array_agg(a_val order by abs(pct) desc))[1] as a_val,
           (array_agg(b_val order by abs(pct) desc))[1] as b_val,
           array_to_string((array_agg(gr order by abs(pct) desc))[2:5], ', ') as gr_list
    from breaches
    group by fleet_id, type, source, species
    union all
    select ol.fleet_id, 'own_spike', 'OWN', ol.sp, ol.landing_date, 1,
           ''::text, (ol.pkg-oa.avgp)/oa.avgp*100, oa.avgp, ol.pkg, ''
    from settings st
    join own_latest ol on ol.fleet_id = st.fleet_id
    join own_avg oa on oa.fleet_id = ol.fleet_id and oa.sp = ol.sp
    where st.en_own and oa.nl >= 1 and oa.avgp > 0
      and (ol.pkg-oa.avgp)/oa.avgp*100 >= st.own_pct
  ),
  fresh as (
    select rl.*, st.max_per_run,
           greatest(0, st.max_per_day - coalesce(t.n, 0)) as room_today
    from rolled rl
    join settings st on st.fleet_id = rl.fleet_id
    left join todays t on t.fleet_id = rl.fleet_id
    where not exists (
      select 1 from alerts a
       where a.fleet_id = rl.fleet_id
         and a.type = rl.type
         and a.meta->>'species' = rl.species
         and coalesce(a.meta->>'source','') = coalesce(rl.source,'')
         and a.created_at >= now() - make_interval(days => st.cooldown_days)
    )
  ),
  capped as (
    select f.*,
           row_number() over (partition by f.fleet_id, f.type order by abs(f.top_pct) desc) rn,
           row_number() over (partition by f.fleet_id order by abs(f.top_pct) desc) rn_fleet
    from fresh f
  ),
  final as (
    select fleet_id, type,
      (case type
         when 'daily' then (case when top_pct >= 0 then 'good' else 'warn' end)
         when 'pd_dk' then 'info'
         else 'good' end)::text sev,
      (case type
        when 'daily' then source||': '||species||' '||(case when top_pct>=0 then 'up ' else 'down ' end)
                          ||round(abs(top_pct))::text||'%'
                          ||(case when grades>1 then ' ('||grades::text||' grades)' else '' end)
        when 'fourweek' then source||': '||species||' '||round(top_pct)::text||'% above 4-wk average'
                          ||(case when grades>1 then ' ('||grades::text||' grades)' else '' end)
        when 'pd_dk' then species||': '||(case when a_val >= b_val then 'Peterhead' else 'Denmark' end)
                          ||' +£'||round(abs(a_val-b_val),2)::text||'/kg'
        else 'Your '||species||' made £'||round(b_val,2)::text||'/kg, +'||round(top_pct)::text||'%'
      end)::text title,
      (case type
        when 'daily' then 'Board price £'||round(a_val,2)::text||' -> £'||round(b_val,2)::text
                          ||'/kg on '||top_gr||' vs last board.'
                          ||(case when grades>1 then ' Also moved: '||gr_list||'.' else '' end)
        when 'fourweek' then 'Now £'||round(b_val,2)::text||'/kg vs £'||round(a_val,2)::text
                          ||' four-week average on '||top_gr||'.'
                          ||(case when grades>1 then ' Also above: '||gr_list||'.' else '' end)
        when 'pd_dk' then 'Peterhead £'||round(a_val,2)::text||' vs Denmark £'||round(b_val,2)::text
                          ||'/kg ('||round(top_pct)::text||'%) on '||top_gr||'.'
                          ||(case when grades>1 then ' Also apart: '||gr_list||'.' else '' end)
        else 'Last landing £'||round(b_val,2)::text||' vs your recent average £'||round(a_val,2)::text||'/kg.'
      end)::text body,
      jsonb_build_object('source',source,'species',species,'grade',top_gr,'grades',grades,
                         'from',round(a_val,2),'to',round(b_val,2),'pct',round(top_pct)) meta,
      (type||':'||source||':'||species||':'||price_date::text)::text dk
    from capped
    where rn <= max_per_run
      and rn_fleet <= room_today
  )
  insert into alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select fleet_id, type, sev, title, body, meta, dk from final
  on conflict (fleet_id, dedup_key) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

-- 2. An expiry alert clears when the thing it names is renewed ---------------
-- The dedup key carries the row's id AND the expiry it was raised for, so a
-- renewal moves the date and the old alert no longer matches anything. Keyed on
-- the ROW rather than on "is it still expired", so a certificate that was
-- deleted, or a crewman since archived, resolves for the same reason.
create or replace function public.resolve_compliance_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int; total int := 0;
begin
  update alerts a set dismissed_at = now()
   where a.dismissed_at is null
     and a.type = 'vessel_cert'
     and split_part(a.dedup_key, ':', 1) = 'vesselcert'
     and not exists (
       select 1 from vessel_certificates vc
        where vc.id::text = split_part(a.dedup_key, ':', 2)
          and vc.expiry_date::text = split_part(a.dedup_key, ':', 3));
  get diagnostics n = row_count; total := total + n;

  update alerts a set dismissed_at = now()
   where a.dismissed_at is null
     and a.type = 'crew_cert'
     and split_part(a.dedup_key, ':', 1) = 'crewcert'
     and not exists (
       select 1 from crew_certificates cc join crew c on c.id = cc.crew_id
        where cc.id::text = split_part(a.dedup_key, ':', 2)
          and cc.expiry_date::text = split_part(a.dedup_key, ':', 3)
          and c.archived_at is null and c.status <> 'former');
  get diagnostics n = row_count; total := total + n;

  update alerts a set dismissed_at = now()
   where a.dismissed_at is null
     and a.type = 'crew_passport'
     and split_part(a.dedup_key, ':', 1) = 'crewpass'
     and not exists (
       select 1 from crew c
        where c.id::text = split_part(a.dedup_key, ':', 2)
          and c.passport_expiry::text = split_part(a.dedup_key, ':', 3)
          and c.archived_at is null and c.status <> 'former');
  get diagnostics n = row_count; total := total + n;

  return total;
end $function$;

-- 3. The daily job resolves before it generates ------------------------------
-- Resolve FIRST: an alert that should be gone must not be re-counted as news by
-- anything downstream, and the digest reads this table an hour later.
select cron.unschedule('compliance-alerts-daily')
where exists (select 1 from cron.job where jobname = 'compliance-alerts-daily');

select cron.schedule(
  'compliance-alerts-daily',
  '0 6 * * *',
  $job$select public.resolve_compliance_alerts(), public.generate_compliance_alerts(60),
               public.generate_bonus_alerts(30), public.generate_activity_alerts();$job$
);
