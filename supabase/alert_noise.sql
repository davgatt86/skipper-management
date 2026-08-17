-- Market price alerts: stop shouting.
--
-- Measured Aug 2026, five weeks after the cron was scheduled: 4,781 LIVE
-- unread price alerts across 7 fleets — 28.7 per fleet per day — against
-- exactly 2 live alerts for the things that actually need doing (a crew
-- ticket expiring, a logbook gone quiet). The compliance alerts this app was
-- built to raise were buried under a five-week drift of price noise.
--
-- Nobody reads 29 alerts a day, and an alert stream nobody reads is worse
-- than none: it trains the reader to ignore the sender, including on the day
-- it matters. It also makes push notifications a non-starter — the first
-- thing anyone would do is switch them off.
--
-- TWO CAUSES, measured, and the second is the bigger:
--
--   grade fan-out    one species moving was announced once PER GRADE
--                    1.6x on daily, 3.7x on pd_dk
--   day repetition   the same standing condition re-announced every board day
--                    14.4 days running on daily, 18.3 on pd_dk
--
-- Rolled up per species and issued once per episode: 6,714 rows become 252.
--
-- THREE FIXES:
--
--  1. ONE ALERT PER SPECIES, not per grade. The grade-level breach detection
--     is unchanged — it still only fires on grades the fleet actually lands —
--     but the output collapses to one row naming the grades that moved. "Cod
--     A1 up 18%, A2 up 22%, A3 up 16%" is one fact told three times.
--
--  2. A COOLDOWN. "Peterhead is £1.10 over Denmark on cod" is a STATE, not an
--     event, and it held for 18 board days. The same shape as the activity
--     alerts, which already learned this: one alert per episode, not one per
--     day. Default 7 days, per fleet in alert_settings.
--
--  3. A CAP PER RUN, so a wild board cannot flood the page whatever the
--     thresholds say. Default 3 of each type, biggest move first — a skipper
--     wants the notable moves, not all of them.
--
-- And price alerts now AGE OUT (dismissed, not deleted — the row stays for
-- the record). A board move from five weeks ago is not news, and leaving it
-- on the page is what let 4,781 accumulate.
--
-- Expiry alerts are deliberately untouched by all of this. A certificate that
-- ran out three weeks ago is MORE urgent, not less, and there is no such
-- thing as too many of them — there were two.

-- ---------------------------------------------------------------- settings
-- Defaults live in the function's coalesce() calls so a fleet with no row
-- behaves sensibly; these are the knobs the Alerts page exposes.
--
--   price_cooldown_days   7   don't re-announce the same species+type inside this
--   price_max_per_run     3   most alerts of one type from a single run
--   price_expire_days    21   auto-dismiss a price alert older than this

create or replace function public.generate_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  ---------------------------------------------------------------- age out
  -- Before raising anything new, clear what is no longer news. Dismissed,
  -- not deleted: the row is the record that it was raised.
  update alerts a
     set dismissed_at = now()
    from (
      select f.id fleet_id,
             coalesce((s.data->>'price_expire_days')::int, 21) expire_days
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
      coalesce((s.data->>'price_max_per_run')::int, 3)      max_per_run
    from fleets f left join alert_settings s on s.fleet_id = f.id
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

  /* Per-GRADE breaches, exactly the detection that was there before —
   * including the filter that only lets through grades this fleet actually
   * lands. Only the OUTPUT changes below. */
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

  /* FIX 1 — one row per species. The headline is the grade that moved most;
   * the body names the rest, so nothing is hidden, it is just said once. */
  rolled as (
    select fleet_id, type, source, species,
           max(price_date) as price_date,
           count(*) as grades,
           (array_agg(gr    order by abs(pct) desc))[1] as top_gr,
           (array_agg(pct   order by abs(pct) desc))[1] as top_pct,
           (array_agg(a_val order by abs(pct) desc))[1] as a_val,
           (array_agg(b_val order by abs(pct) desc))[1] as b_val,
           -- From the SECOND grade: the first is already the headline, and
           -- listing it again read "on A3. Also apart: A3, A2, A1".
           array_to_string((array_agg(gr order by abs(pct) desc))[2:5], ', ') as gr_list
    from breaches
    group by fleet_id, type, source, species
    union all
    -- own-sales spikes have no grade, so the rollup is a no-op; they join here
    -- to pick up the cooldown and the cap.
    select ol.fleet_id, 'own_spike', 'OWN', ol.sp, ol.landing_date, 1,
           ''::text, (ol.pkg-oa.avgp)/oa.avgp*100, oa.avgp, ol.pkg, ''
    from settings st
    join own_latest ol on ol.fleet_id = st.fleet_id
    join own_avg oa on oa.fleet_id = ol.fleet_id and oa.sp = ol.sp
    where st.en_own and oa.nl >= 1 and oa.avgp > 0
      and (ol.pkg-oa.avgp)/oa.avgp*100 >= st.own_pct
  ),

  /* FIX 2 — a cooldown. A price gap that holds for a fortnight is one piece
   * of news, not fourteen. Keyed on fleet+type+species+source so a DIFFERENT
   * species still gets through immediately. */
  fresh as (
    select rl.*, st.max_per_run
    from rolled rl
    join settings st on st.fleet_id = rl.fleet_id
    where not exists (
      select 1 from alerts a
       where a.fleet_id = rl.fleet_id
         and a.type = rl.type
         and a.meta->>'species' = rl.species
         and coalesce(a.meta->>'source','') = coalesce(rl.source,'')
         and a.created_at >= now() - make_interval(days => st.cooldown_days)
    )
  ),

  /* FIX 3 — a cap, biggest move first. A wild board cannot flood the page
   * whatever the thresholds are set to. */
  capped as (
    select f.*, row_number() over (partition by f.fleet_id, f.type order by abs(f.top_pct) desc) rn
    from fresh f
  ),

  final as (
    select fleet_id, type,
      (case type
         when 'daily'     then (case when top_pct >= 0 then 'good' else 'warn' end)
         when 'pd_dk'     then 'info'
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
        when 'daily' then 'Board price £'||round(a_val,2)::text||' → £'||round(b_val,2)::text
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
  )
  insert into alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select fleet_id, type, sev, title, body, meta, dk from final
  on conflict (fleet_id, dedup_key) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

-- ------------------------------------------------------- clear the backlog
-- 4,781 live price alerts, oldest 13-07-2026. None of it is news. Dismissed
-- rather than deleted, so the record of what was raised survives; expiry
-- alerts are excluded by type and are not touched.
update public.alerts
   set dismissed_at = now()
 where type in ('daily','fourweek','pd_dk','own_spike','forecast')
   and dismissed_at is null
   and created_at < now() - interval '2 days';
