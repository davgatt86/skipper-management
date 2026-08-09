-- The alert schedule, in one place.
--
-- This supersedes the `cron.schedule` call in
-- `fuel_suppliers_and_vessel_cert_upload.sql`, which only ever scheduled the
-- compliance alerts. `generate_bonus_alerts` was added to the live job later
-- and never written back to the repo — so the database and the migration had
-- drifted apart. Keep this file as the single record of what is scheduled, and
-- re-run it after changing anything; it is idempotent.
--
-- WHY THESE RUN AT ALL WITHOUT A SESSION
--
-- All three functions are SECURITY DEFINER and take `fleet_id` from each source
-- row rather than from `current_fleet_id()`. That is what makes them safe to
-- run from cron, which has no `auth.uid()`: they cover EVERY fleet, not just
-- whoever logged in last. A function written the usual way — scoped by
-- `current_fleet_id()` — would silently do nothing here, and the failure would
-- look exactly like "no alerts due".
--
-- All three are idempotent: `alerts` is unique on (fleet_id, dedup_key), and
-- every key carries the date and the bucket. So a missed run, a repeated run,
-- or two runs in the same hour all cost nothing.

create extension if not exists pg_cron with schema cron;

-- ---------------------------------------------------------------------------
-- 1. Expiries and money owed — once a day
-- ---------------------------------------------------------------------------
-- 06:00 UTC. Certificates and passports move on a scale of weeks, so more
-- often than daily tells nobody anything new.
select cron.unschedule('compliance-alerts-daily')
where exists (select 1 from cron.job where jobname = 'compliance-alerts-daily');

select cron.schedule(
  'compliance-alerts-daily',
  '0 6 * * *',
  $$select public.generate_compliance_alerts(60), public.generate_bonus_alerts(30);$$
);

-- ---------------------------------------------------------------------------
-- 2. Market alerts — through the day
-- ---------------------------------------------------------------------------
-- These were never scheduled: they fired only when somebody opened the Alerts
-- page, which is the same hole the compliance cron was built to close.
--
-- Every three hours rather than daily, because a board arriving at midday is
-- worth knowing about that afternoon, not the next morning — the whole point of
-- a price alert is that it is still actionable. The dedup key carries the
-- board's own date, so the extra runs raise nothing new.
select cron.unschedule('market-alerts')
where exists (select 1 from cron.job where jobname = 'market-alerts');

select cron.schedule(
  'market-alerts',
  '0 */3 * * *',
  $$select public.generate_alerts();$$
);


-- ============================================================
-- VERIFY
-- ============================================================
-- What is scheduled:
--   select jobname, schedule, command, active from cron.job order by jobname;
--
-- Whether it is actually running — a job that exists but never fires looks
-- identical to no alerts being due, so check this rather than the job list:
--   select j.jobname, d.status, d.return_message, d.start_time
--     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--    order by d.start_time desc limit 20;
--
-- NOTE: generating an alert is not the same as telling anyone about it. These
-- jobs write rows into `alerts`; the rows sit there until somebody opens the
-- app. Closing that last gap needs email or push, and is not built.
