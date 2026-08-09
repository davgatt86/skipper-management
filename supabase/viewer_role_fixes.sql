-- Three holes in the `viewer` role, found by probing before handing out logins.
--
-- Context: every one of the 13 users is a skipper today, so none of this is
-- currently exploited. But "Viewer" is offered in the Users picker, so all
-- three open the moment one is created — which is exactly what was about to
-- happen.
--
-- The common cause is the shape of the `viewer_read` policies:
--
--     using (exists (select 1 from app_users u
--                     where u.id = auth.uid() and u.role = 'viewer'))
--
-- That says "if you are a viewer you may read this ROW" — any row, in any
-- fleet. On most tables it is saved by the RESTRICTIVE `fleet_isolation`
-- policy sitting beside it, which ANDs the fleet check back on. On the two
-- tables below there is no such policy, and nothing else was holding the line.

-- ---------------------------------------------------------------------------
-- 1. audit_log — a viewer could read EVERY fleet's audit trail
-- ---------------------------------------------------------------------------
-- Measured: a viewer in one fleet saw all 715 rows across 2 fleets — the whole
-- table. The audit log carries old and new values of changed records, so this
-- is other tenants' data, not just metadata.
--
-- Dropped rather than fleet-scoped: `audit_read` already covers the intended
-- reader (own fleet, skipper), and the Activity page that reads this table is
-- skipper-only in nav.js. A viewer has no page for it and no reason to see it.
drop policy if exists viewer_read on public.audit_log;

-- Belt and braces: give it the same restrictive fleet boundary every other
-- feature table has, so a future permissive policy cannot reopen this.
drop policy if exists fleet_isolation_audit_log on public.audit_log;
create policy fleet_isolation_audit_log on public.audit_log
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

-- ---------------------------------------------------------------------------
-- 2. fleets — a viewer could read all 13 fleets
-- ---------------------------------------------------------------------------
-- `fleets_member_read` already grants `id = current_fleet_id()`, which covers a
-- viewer's own boat. `viewer_read` added nothing except the leak.
-- `fleets_owner_read` stays: the owner reading every fleet is deliberate, and
-- is what drives the boat picker on the vessel photo upload.
drop policy if exists viewer_read on public.fleets;

-- ---------------------------------------------------------------------------
-- 3. payments — a viewer could see one-off bonuses
-- ---------------------------------------------------------------------------
-- No cross-fleet leak here; fleet_isolation held. The problem is subtler and
-- worse in its way: `payments_read` deliberately withholds `one_off` payments
-- from the office AND from the crewman himself —
--
--     (role = 'skipper')
--     OR (payment_type <> 'one_off'
--         AND (role = 'office' OR crew_id = current_user_crew_id()))
--
-- — and `viewer_read` bypassed that carve-out entirely, so the most junior
-- read-only role saw what the office cannot. Measured on Audacious: a viewer
-- read all 194 payments including the 8 one-offs (£4,000); the office correctly
-- saw 186.
--
-- A discretionary payment to one man is the most sensitive line in the table.
-- Replaced with a policy that respects the same rule.
drop policy if exists viewer_read on public.payments;
create policy viewer_read on public.payments
  for select to authenticated
  using (
    fleet_id = current_user_fleet_id()
    and current_user_role() = 'viewer'::user_role
    and payment_type <> 'one_off'::payment_type
  );

-- ---------------------------------------------------------------------------
-- Note on the ones deliberately left alone
-- ---------------------------------------------------------------------------
-- `viewer_read` on sales_landings, sales_rows, contracts, crew, settings and
-- the rest is the same unscoped shape, but each has a restrictive
-- `fleet_isolation` policy behind it, so the boundary holds. That is the
-- documented pattern for this database and rewriting them all would be churn.
-- What matters is the rule it implies:
--
--   A NEW TABLE NEEDS ITS fleet_isolation POLICY BEFORE IT NEEDS ANYTHING ELSE.
--   The permissive policies here do not carry a fleet check of their own, so
--   without it a table is open to every tenant from the moment it exists.

-- ============================================================
-- VERIFY
-- ============================================================
-- Tables with a viewer_read policy and no restrictive fleet isolation —
-- should return NO rows:
--
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     left join pg_policies p on p.schemaname='public' and p.tablename=c.relname
--    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
--    group by c.relname
--   having bool_or(p.policyname='viewer_read')
--      and not bool_or(p.permissive='RESTRICTIVE' and p.qual like '%current_fleet_id%');
