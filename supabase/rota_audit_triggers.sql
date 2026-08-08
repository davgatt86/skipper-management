-- ============================================================
-- Audit trail for the rota. Applied and verified Aug 2026.
--
-- WHY
--   The rota was the only history in the app with no trail at all. When 25
--   trips and 60 crew assignments went in Aug 2026, nothing could say when,
--   by whom, or what they had held. (They were deleted deliberately — but
--   that could only be established by asking.)
--
-- THE WRINKLE
--   The existing audit_trigger() reads COALESCE(NEW.id, OLD.id), so it only
--   works on a table with an `id`. Three rota link tables have none —
--   rota_trip_crew, rota_team_members, rota_landing_crew — and they are
--   exactly the ones carrying the crew assignments. They get a variant that
--   anchors record_id on the PARENT row, passed in as a trigger argument.
--   The whole row is captured in before_data either way, so nothing is lost.
-- ============================================================

create or replace function public.audit_trigger_link()
returns trigger
language plpgsql
security definer
as $$
declare
  v_fleet uuid;
  v_row   jsonb;
  v_key   text := TG_ARGV[0];
begin
  if TG_OP = 'DELETE' then v_fleet := OLD.fleet_id; v_row := to_jsonb(OLD);
  else                     v_fleet := NEW.fleet_id; v_row := to_jsonb(NEW);
  end if;

  insert into public.audit_log
    (fleet_id, user_id, table_name, record_id, action, before_data, after_data)
  values (
    v_fleet, auth.uid(), TG_TABLE_NAME, (v_row ->> v_key)::uuid, lower(TG_OP),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end $$;

-- Tables with an id
create trigger audit_rota_trips         after insert or update or delete on public.rota_trips
  for each row execute function public.audit_trigger();
create trigger audit_rota_holidays      after insert or update or delete on public.rota_holidays
  for each row execute function public.audit_trigger();
create trigger audit_rota_teams         after insert or update or delete on public.rota_teams
  for each row execute function public.audit_trigger();
create trigger audit_rota_trip_landings after insert or update or delete on public.rota_trip_landings
  for each row execute function public.audit_trigger();
create trigger audit_rota_back_to_back  after insert or update or delete on public.rota_back_to_back
  for each row execute function public.audit_trigger();

-- Link tables, anchored on the parent
create trigger audit_rota_trip_crew    after insert or update or delete on public.rota_trip_crew
  for each row execute function public.audit_trigger_link('trip_id');
create trigger audit_rota_team_members after insert or update or delete on public.rota_team_members
  for each row execute function public.audit_trigger_link('team_id');
create trigger audit_rota_landing_crew after insert or update or delete on public.rota_landing_crew
  for each row execute function public.audit_trigger_link('rota_landing_id');


-- ============================================================
-- VERIFIED by round-tripping a throwaway trip: insert a trip, add a crew
-- link, delete the trip. All four rows appeared — including the link row's
-- CASCADE delete, which is the exact case that lost the 60 assignments —
-- with before_data populated on both deletes. Test rows were then removed.
--
-- STILL UNAUDITED, and worth considering:
--   quota_* (snapshots, lines, trips, catches, manual entries) — quota is
--   money and currently has no trail
--   sales_landings / sales_rows — re-ingestion replaces rows in place
--   crew_certificates, vessel_certificates, vessel_fuel_log
--   su_* settlements
-- ============================================================
