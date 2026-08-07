-- ============================================================
-- Vessel and crew expiry alerts.
-- Applied and verified Aug 2026.
--
-- WHY A SEPARATE STREAM
--   The alerts table already carries 5,400+ market alerts (pd_dk,
--   fourweek, daily, forecast, own_spike) and they arrive every day.
--   A passport expiry dropped into that feed is buried by lunchtime.
--   Same table, same page, its own stream — the `type` is what keeps
--   them apart, and "clear price alerts" never touches an expiry.
--
-- IDEMPOTENT
--   (fleet_id, dedup_key) is unique and every insert is ON CONFLICT DO
--   NOTHING, so the page can call this on every visit. The key carries
--   the expiry date AND the bucket, so a certificate alerts again when
--   it crosses from due into expired, and a renewed one alerts only
--   when its new expiry comes within range.
-- ============================================================

create or replace function public.generate_compliance_alerts(lead_days int default 60)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare inserted int := 0; n int;
begin
  -- 1. Crew passports
  insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select c.fleet_id,
         'crew_passport',
         case when c.passport_expiry < current_date then 'warn' else 'info' end,
         c.full_name || ' — passport ' ||
           case when c.passport_expiry < current_date then 'expired' else 'expiring' end,
         'Passport ' || coalesce(c.passport_number, '(no number)') || ' ' ||
           case when c.passport_expiry < current_date
                then 'expired on ' || to_char(c.passport_expiry, 'DD-MM-YYYY')
                else 'expires ' || to_char(c.passport_expiry, 'DD-MM-YYYY') ||
                     ' (' || (c.passport_expiry - current_date) || ' days)' end ||
           '. A crew list is a border document.',
         jsonb_build_object('crew_id', c.id, 'expiry', c.passport_expiry, 'link', '/crew'),
         'crewpass:' || c.id || ':' || c.passport_expiry || ':' ||
           case when c.passport_expiry < current_date then 'expired' else 'due' end
    from public.crew c
   where c.passport_expiry is not null
     and c.archived_at is null
     and c.status <> 'former'
     and c.passport_expiry <= current_date + lead_days
  on conflict (fleet_id, dedup_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  -- 2. Crew certificates
  insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select cc.fleet_id,
         'crew_cert',
         case when cc.expiry_date < current_date then 'warn' else 'info' end,
         c.full_name || ' — ' || cc.cert_type || ' ' ||
           case when cc.expiry_date < current_date then 'expired' else 'due' end,
         coalesce(cc.cert_type, 'Certificate') ||
           case when cc.expiry_date < current_date
                then ' expired on ' || to_char(cc.expiry_date, 'DD-MM-YYYY')
                else ' expires ' || to_char(cc.expiry_date, 'DD-MM-YYYY') ||
                     ' (' || (cc.expiry_date - current_date) || ' days)' end ||
           coalesce(' · ' || cc.issuer, ''),
         jsonb_build_object('crew_id', cc.crew_id, 'cert_id', cc.id,
                            'expiry', cc.expiry_date, 'link', '/crew-certs'),
         'crewcert:' || cc.id || ':' || cc.expiry_date || ':' ||
           case when cc.expiry_date < current_date then 'expired' else 'due' end
    from public.crew_certificates cc
    join public.crew c on c.id = cc.crew_id
   where cc.expiry_date is not null
     and c.archived_at is null
     and c.status <> 'former'
     and cc.expiry_date <= current_date + lead_days
  on conflict (fleet_id, dedup_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  -- 3. Vessel certificates
  insert into public.alerts (fleet_id, type, severity, title, body, meta, dedup_key)
  select vc.fleet_id,
         'vessel_cert',
         case when vc.expiry_date < current_date then 'warn' else 'info' end,
         vc.cert_type || ' ' ||
           case when vc.expiry_date < current_date then 'expired' else 'due' end,
         case when vc.expiry_date < current_date
              then 'Expired on ' || to_char(vc.expiry_date, 'DD-MM-YYYY') ||
                   ' (' || (current_date - vc.expiry_date) || ' days overdue)'
              else 'Expires ' || to_char(vc.expiry_date, 'DD-MM-YYYY') ||
                   ' (' || (vc.expiry_date - current_date) || ' days)' end ||
           coalesce(' · ' || vc.issuer, ''),
         jsonb_build_object('cert_id', vc.id, 'category', vc.category,
                            'expiry', vc.expiry_date, 'link', '/vessel-certs'),
         'vesselcert:' || vc.id || ':' || vc.expiry_date || ':' ||
           case when vc.expiry_date < current_date then 'expired' else 'due' end
    from public.vessel_certificates vc
   where vc.expiry_date is not null
     and vc.expiry_date <= current_date + lead_days
  on conflict (fleet_id, dedup_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  return inserted;
end $$;

grant execute on function public.generate_compliance_alerts(int) to authenticated;


-- ============================================================
-- VERIFY
-- ============================================================
select public.generate_compliance_alerts() as inserted;   -- 8 on first run
select public.generate_compliance_alerts() as second_run; -- 0, proves idempotent

select type, severity, title from public.alerts
 where type in ('crew_passport','crew_cert','vessel_cert')
 order by severity desc, type;


-- ============================================================
-- WHAT THE FIRST RUN RAISED
--   warn  Andrew Smith — passport expired 25-02-2026  (the deliberate
--         test data, so it also proves the passport path works)
--   warn  Certificate of Insurance                    129 days overdue
--   warn  Wreck removal liability cover                129 days overdue
--   warn  Gaseous Fire Suppression System               18 days overdue
--   warn  Inflatable Liferaft Service                   14 days overdue
--   warn  Liferaft Inspection & Service                  7 days overdue
--   info  Elizer Tano — ENG 1 due 19-09-2026            43 days
--   info  Portable Fire Extinguisher due 26-08-2026     19 days
--
--   The last two were not known before. Elizer Tano's medical in
--   particular had nothing chasing it.
--
-- NOT DONE YET
--   Nothing schedules this. The page calls it on every visit, which
--   covers a skipper who looks — but an expiry that falls due while
--   nobody opens the app goes unnoticed until someone does. A cron
--   calling generate_compliance_alerts() daily would close that, and
--   is the obvious next step.
-- ============================================================
