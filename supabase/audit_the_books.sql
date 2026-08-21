-- AUDIT THE BOOKS.
--
-- Deleting the 30-07-2026 engine log entry (21-08-2026) left NO TRACE AT ALL,
-- because engine_logs had no audit trigger — and neither did the garbage record
-- book, the fuel log, the maintenance record or any of the gear log.
--
-- Twenty-one other tables had had one since Aug 2026, added to the rota tables
-- precisely because 60 crew assignments vanished with nothing to show what
-- happened. The three books closest to being LEGAL RECORDS were the ones
-- without it, and a Garbage Record Book is a MARPOL requirement at Audacious's
-- size.
--
-- 34 tables are audited after this.
--
-- WHAT IS DELIBERATELY NOT AUDITED, and why this is a chosen list rather than
-- "every table":
--
--   sales_landings / sales_rows — re-uploading one note DELETES its rows and
--     re-inserts them from a fresh parse, thousands at a time. Auditing that
--     writes thousands of rows per upload and buries everything a person did by
--     hand under machine noise. Landings already carry `reconcile_diff`, which
--     is the record that actually matters there.
--   su_* — settlements arrive in bulk from an edge function holding the
--     service-role key, where `auth.uid()` is null. The trail would record that
--     nobody did it, which is worse than no trail.
--   stores_* — a grocery list. Nobody needs to know who changed the biscuits.
--
-- THE RULE THE LIST FOLLOWS: books and settings written BY HAND, a few entries
-- at a time, where a silent change or deletion would matter. Apply that test
-- before adding a table here; a log that fills with machine writes is a log
-- nobody reads.
do $$
declare
  t text;
  books text[] := array[
    -- the three books
    'engine_logs', 'garbage_log', 'vessel_fuel_log', 'fuel_suppliers',
    -- the maintenance record
    'maintenance_tasks', 'maintenance_events',
    -- the gear log, all four
    'gear_nets', 'gear_parts', 'gear_components', 'gear_measurements',
    -- a limit that decides whether a warning fires is a safety setting:
    -- turning one off quietly is exactly the change worth finding later
    'engine_limits',
    -- certificates: an expiry date drives the alerts and the port state
    'vessel_certificates', 'crew_certificates'
  ];
  has_id boolean;
begin
  foreach t in array books loop
    /* audit_trigger() reads NEW.id / OLD.id, so a table without one fails at
     * RUN time rather than here — which would mean discovering it the first
     * time somebody wrote to the book. Check rather than assume.
     * A table with no id column wants audit_trigger_link(), which anchors
     * record_id on the parent; see rota_audit_triggers.sql. */
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'id'
    ) into has_id;
    if not has_id then
      raise exception 'public.% has no id column — it needs audit_trigger_link(), not audit_trigger()', t;
    end if;

    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I '
      'for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- VERIFIED BY PROBE, as an officer, inside a transaction that was aborted:
--
--   captured: engine_logs:insert, engine_logs:update, engine_logs:delete,
--             gear_nets:insert, gear_components:insert,
--             gear_nets:delete, gear_components:delete
--   every row names the man who did it: 7 of 7
--   the CASCADE delete of the component was caught too
--
-- That last one matters: deleting a net takes its components and measurements
-- with it, and the whole reason the rota tables got triggers was a CASCADE that
-- removed 60 rows silently.
--
-- audit_log stays SKIPPER-ONLY to read, and carries its own fleet_isolation
-- policy — added Aug 2026 when a viewer was found able to read 715 rows across
-- two fleets. The trigger is SECURITY DEFINER, so an officer's writes are
-- recorded even though he cannot read the record.
--
-- Indexes already present and sufficient: (fleet_id, occurred_at desc) for the
-- Activity page, (table_name, record_id) for one row's history.
