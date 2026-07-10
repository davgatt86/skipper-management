-- alerts.sql — ALREADY APPLIED to the live database (kept here for your records).
-- Per-fleet alert feed + editable thresholds + generator. See generate_alerts()
-- for the four price checks; the "own vessel live on forecast" alert is written
-- client-side from the Forecast page.

create table if not exists public.alert_settings (
  fleet_id uuid primary key references public.fleets(id) default public.current_fleet_id(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id),
  type text not null, severity text default 'info',
  title text not null, body text, meta jsonb default '{}'::jsonb,
  dedup_key text not null,
  created_at timestamptz default now(), read_at timestamptz, dismissed_at timestamptz,
  unique (fleet_id, dedup_key)
);
create index if not exists alerts_fleet_idx on public.alerts (fleet_id, created_at desc);

-- RLS: alert_settings skipper read+write own fleet; alerts skipper/viewer read,
-- skipper insert+update own fleet; both fleet-isolated. (Policies applied live.)

-- Defaults (editable per fleet via alert_settings.data):
--   daily_jump_pct 15 · four_week_pct 25 · pd_dk_gap_pct 20 · own_spike_pct 20
--   enable_daily / enable_four_week / enable_pd_dk / enable_own = true
-- Alerts cover each fleet's top 8 species by landed weight (last 90 days) only.
-- generate_alerts() is SECURITY DEFINER, deduped via ON CONFLICT, granted to
-- authenticated + service_role, and called from the price ingest and on Dashboard load.
-- Full function body as applied is in migration "generate_alerts_tuned".
