-- ============================================================
-- Square Up — move the su_* tables onto fleet isolation.
--
-- Run in the Supabase SQL editor, STEP 1 first. Check the
-- verification block, then run STEP 2. They are deliberately
-- separate: step 1 changes no behaviour at all, so if anything
-- looks wrong you can stop before the switch.
--
-- WHY THIS EXISTS
--   The su_* tables were built outside this repo and gate on
--   su_is_allowed() — an email allow-list — plus su_visible_boat(),
--   which is default-OPEN (no rows for a user = sees every boat).
--   Everything else in this app keys on fleet_id with a restrictive
--   fleet_isolation policy. This brings su_* onto the same model.
--
-- WHAT IT DOES NOT DO
--   * Deletes nothing. su_allowed_users and su_user_boat_access are
--     left in place, unused, so this is reversible.
--   * Touches no settlement, line, payment or invoice row.
--   * Does not scope su_parse_jobs — see the note at the bottom.
--
-- STATE WHEN WRITTEN (2026-08-06)
--   su_boats            2      su_settlements       375
--   su_settlement_lines 3281   su_crew_payments    1798
--   su_invoices         4      su_crew                0
--   Audacious BF83 -> 12 settlements, Beryl BF440 -> 363
-- ============================================================


-- ============================================================
-- STEP 1 — ADDITIVE. No behaviour change.
-- su_visible_boat() and every policy are untouched here, so both
-- logins keep seeing exactly what they see today.
-- ============================================================

-- 1. Give each boat a fleet, matched on "NAME REG" against fleets.name.
alter table public.su_boats
  add column if not exists fleet_id uuid references public.fleets(id) on delete restrict;

update public.su_boats b
   set fleet_id = f.id
  from public.fleets f
 where b.fleet_id is null
   and upper(f.name) = upper(b.name || ' ' || b.registration);

-- 2. A fleet column for parse jobs. Left nullable and UNSCOPED for now —
--    see the note at the bottom of this file.
alter table public.su_parse_jobs
  add column if not exists fleet_id uuid references public.fleets(id) on delete set null;

-- 3. Cross-fleet grants: named, auditable, one row per (fleet, boat).
--    This replaces "no rows means you see everything" with "you see your
--    own fleet, plus anything explicitly granted here".
create table if not exists public.su_fleet_agents (
  agent_fleet_id uuid not null references public.fleets(id) on delete cascade,
  boat_id        uuid not null references public.su_boats(id) on delete cascade,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (agent_fleet_id, boat_id)
);

alter table public.su_fleet_agents enable row level security;
-- No permissive policy on purpose: only the SECURITY DEFINER visibility
-- function reads this table, and it bypasses RLS.

-- 4. Keep Audacious's sight of Beryl until the integration is proven.
insert into public.su_fleet_agents (agent_fleet_id, boat_id, note)
select f.id, b.id,
       'Audacious keeps sight of Beryl until the integration is proven. Delete this row to break away.'
  from public.fleets f, public.su_boats b
 where upper(f.name) = 'AUDACIOUS BF83'
   and upper(b.name || ' ' || b.registration) = 'BERYL BF440'
on conflict do nothing;

-- 5. Only once every boat has a fleet.
alter table public.su_boats
  alter column fleet_id set not null;


-- ---- VERIFY STEP 1 -----------------------------------------
-- Expect: 2 boats, each with the right fleet; 1 agent grant;
-- and the row counts unchanged from the header above.
select b.name, b.registration, f.name as fleet
  from public.su_boats b join public.fleets f on f.id = b.fleet_id
 order by b.name;

select count(*) as agent_grants from public.su_fleet_agents;

select 'su_settlements' t, count(*) n from public.su_settlements
union all select 'su_settlement_lines', count(*) from public.su_settlement_lines
union all select 'su_crew_payments',    count(*) from public.su_crew_payments
union all select 'su_invoices',         count(*) from public.su_invoices
 order by t;
-- ------------------------------------------------------------


-- ============================================================
-- STEP 2 — THE SWITCH. Run only once step 1 verifies.
-- ============================================================

-- 1. Visibility now means: your own fleet's boat, or one explicitly
--    granted to you. No more "unconfigured user sees everything".
create or replace function public.su_visible_boat(boat uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.su_boats b
     where b.id = boat
       and b.fleet_id = public.current_fleet_id()
  ) or exists (
    select 1 from public.su_fleet_agents g
     where g.boat_id = boat
       and g.agent_fleet_id = public.current_fleet_id()
  );
$function$;

-- 2. su_crew had no boat scoping at all — any allowed user could read
--    every crew row. The table is empty today, so this is free to fix.
--    Rows with no boat are hidden rather than shared: fail closed.
drop policy if exists su_crew_allowed on public.su_crew;
create policy su_crew_allowed on public.su_crew
  for all to authenticated
  using       (public.su_is_allowed() and boat_id is not null and public.su_visible_boat(boat_id))
  with check  (public.su_is_allowed() and boat_id is not null and public.su_visible_boat(boat_id));

-- 3. Storage. Files live at "{boat_id}/{filename}" — verified across all
--    36 objects, every prefix matching a real boat. The folder is compared
--    as text against su_boats.id, never cast, so a stray folder name can
--    only fail to match; it cannot error the policy.
drop policy if exists su_docs_read on storage.objects;
create policy su_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'su-documents'
    and public.su_is_allowed()
    and exists (
      select 1 from public.su_boats b
       where b.id::text = (storage.foldername(name))[1]
         and public.su_visible_boat(b.id)
    )
  );

drop policy if exists su_docs_insert on storage.objects;
create policy su_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'su-documents'
    and public.su_is_allowed()
    and exists (
      select 1 from public.su_boats b
       where b.id::text = (storage.foldername(name))[1]
         and public.su_visible_boat(b.id)
    )
  );

drop policy if exists su_docs_delete on storage.objects;
create policy su_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'su-documents'
    and public.su_is_allowed()
    and exists (
      select 1 from public.su_boats b
       where b.id::text = (storage.foldername(name))[1]
         and public.su_visible_boat(b.id)
    )
  );


-- ---- VERIFY STEP 2 -----------------------------------------
-- The real test is signing in as each user, but this confirms the
-- grant wiring reads the way it should.
select b.name as boat,
       f.name as owning_fleet,
       coalesce(string_agg(af.name, ', '), '(none)') as also_visible_to
  from public.su_boats b
  join public.fleets f  on f.id = b.fleet_id
  left join public.su_fleet_agents g on g.boat_id = b.id
  left join public.fleets af on af.id = g.agent_fleet_id
 group by b.name, f.name
 order by b.name;

-- Expected:
--   Audacious | AUDACIOUS BF83 | (none)
--   Beryl     | BERYL BF440    | AUDACIOUS BF83
--
-- Then sign in as each and confirm:
--   davgatt86@gmail.com   -> both boats
--   cjm411@btinternet.com -> Beryl only, no sight of Audacious
-- ------------------------------------------------------------


-- ============================================================
-- BREAKING AWAY LATER
-- Once the integration is proven and Beryl's settlements are being
-- done from their own login, one statement ends the arrangement.
-- No schema change, no redeploy:
--
--   delete from public.su_fleet_agents;
--
-- ============================================================


-- ============================================================
-- DEFERRED — su_parse_jobs
-- Its policy is still su_is_allowed() alone, so both allowed users
-- can read each other's parse results (which contain crew names and
-- wages). NOT fixed here, deliberately:
--
--   The AI reader edge function (su-parse-document) inserts these rows
--   with the SERVICE ROLE key, so auth.uid() is null and
--   current_fleet_id() returns null. Scoping the policy now would make
--   the client unable to read back its own job, breaking document
--   reading for Beryl while the Netlify site is still in use.
--
--   The fix is to have the edge function set fleet_id from the caller's
--   JWT, then scope the policy on it. That belongs with the stage 2 port
--   of the reader, when the function is being changed anyway.
--
--   Mitigating: the function deletes jobs older than 24 hours
--   (index.ts, line 177), so this is a transient queue, not a store.
-- ============================================================


-- ============================================================
-- ROLLBACK
-- Step 2 is the only part that changes behaviour. To undo it:
--
--   create or replace function public.su_visible_boat(boat uuid)
--   returns boolean language sql stable security definer
--   set search_path to 'public' as $function$
--     select not exists (select 1 from public.su_user_boat_access
--                         where lower(email) = lower(coalesce(auth.jwt()->>'email','')))
--         or exists (select 1 from public.su_user_boat_access
--                     where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
--                       and boat_id = boat);
--   $function$;
--
-- su_allowed_users and su_user_boat_access are untouched by this file,
-- so that restores the previous behaviour exactly.
-- ============================================================
