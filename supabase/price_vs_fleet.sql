-- price_vs_fleet.sql — ALREADY APPLIED to the live database (kept here for your records).
-- Anonymous, aggregate-only cross-fleet £/kg benchmark. SECURITY DEFINER reads
-- across fleets but returns ONLY value-weighted £/kg per species/grade + a boat
-- count. No row, identity, total, tonnage or date leaves the function. The fleet
-- figure is suppressed (NULL) unless ≥3 distinct boats are behind it, so no single
-- boat's price can be derived. Rate-pending DKK notes are excluded.

create or replace function public.price_vs_fleet_species(p_from date, p_to date)
returns table(species text, own_pkg numeric, fleet_pkg numeric, fleet_boats int)
language sql security definer set search_path = public stable as $$
  with base as (
    select r.fleet_id, r.species_canon as sp, r.value::numeric as val, r.weight_kg::numeric as kg
    from sales_rows r join sales_landings l on l.id = r.landing_id
    where l.landing_date >= p_from and l.landing_date <= p_to
      and r.weight_kg > 0 and r.value > 0
      and (l.currency is distinct from 'DKK' or l.fx_rate is not null)
  ),
  fid as (select fleet_id as f from app_users where id = auth.uid()),
  own as (select sp, sum(val)/nullif(sum(kg),0) as pkg from base where fleet_id = (select f from fid) group by sp),
  flt as (select sp, sum(val)/nullif(sum(kg),0) as pkg, count(distinct fleet_id) as boats from base group by sp)
  select o.sp, round(o.pkg,2),
         case when f.boats >= 3 then round(f.pkg,2) else null end,
         coalesce(f.boats,0)::int
  from own o left join flt f using (sp)
  where o.pkg is not null
  order by o.sp;
$$;

create or replace function public.price_vs_fleet_grades(p_from date, p_to date, p_species text)
returns table(grade text, own_pkg numeric, fleet_pkg numeric, fleet_boats int)
language sql security definer set search_path = public stable as $$
  with base as (
    select r.fleet_id, coalesce(nullif(btrim(r.grade),''),'—') as gr, r.value::numeric as val, r.weight_kg::numeric as kg
    from sales_rows r join sales_landings l on l.id = r.landing_id
    where l.landing_date >= p_from and l.landing_date <= p_to
      and r.species_canon = p_species
      and r.weight_kg > 0 and r.value > 0
      and (l.currency is distinct from 'DKK' or l.fx_rate is not null)
  ),
  fid as (select fleet_id as f from app_users where id = auth.uid()),
  own as (select gr, sum(val)/nullif(sum(kg),0) as pkg from base where fleet_id = (select f from fid) group by gr),
  flt as (select gr, sum(val)/nullif(sum(kg),0) as pkg, count(distinct fleet_id) as boats from base group by gr)
  select o.gr, round(o.pkg,2),
         case when f.boats >= 3 then round(f.pkg,2) else null end,
         coalesce(f.boats,0)::int
  from own o left join flt f using (gr)
  where o.pkg is not null
  order by o.gr;
$$;

revoke all on function public.price_vs_fleet_species(date,date) from public;
revoke all on function public.price_vs_fleet_grades(date,date,text) from public;
grant execute on function public.price_vs_fleet_species(date,date) to authenticated;
grant execute on function public.price_vs_fleet_grades(date,date,text) to authenticated;
