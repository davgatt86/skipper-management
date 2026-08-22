-- THE DEMO FLEET — a whole working boat that is nobody's real boat.
--
-- WHY IT EXISTS. Showing the app to a potential customer meant showing him
-- AUDACIOUS's books: her gross, her buyers, her crew's wages. And not only
-- hers — Sandy's and Colin's landings sit in the same database. That is a
-- commercial problem before it is a sales one.
--
-- WHAT IT IS NOT. It is not a second copy of the app and must never become
-- one. Every parser, page and policy is the code the real fleets run; the ONLY
-- difference is which rows RLS hands back. A "demo mode" branch would drift out
-- of step and nobody would see it — the same failure as the two parser copies,
-- where the browser path ran 1.2.1 against the webhook's 1.3.2 for months.
--
-- THE BOAT. `NORTH WIND BCK500` — lands at Peterhead, registered at Buckie,
-- which is the ordinary arrangement (AUDACIOUS is BF83 and sells there too).
-- Every sample document carries a SAMPLE banner; the banner does the safety
-- work, not the name.
--
-- SHE WAS PD999 FIRST AND COULD NOT BE READ OFF HER OWN SALES NOTE.
-- `VESSEL_STOP` in parse-core holds "PD" deliberately: a note prints PD as the
-- PORT code, and treating it as a registration prefix would name a phantom
-- vessel on every note. The cost is that no Peterhead-REGISTERED boat is
-- auto-detected. It has never bitten — none of the thirteen real fleets is
-- PD-registered — but it would for a Peterhead customer, and it is not a thing
-- to change without real notes to test against.
--
-- THE ID IS FIXED at ...00de and everything here is scoped to it. That is not
-- decoration: this file DELETES, and a reset pointed at the wrong fleet would
-- take a real boat's books with it.
--
-- APPLIED Aug 2026. This file mirrors the live definitions.

-- ---------------------------------------------------------------------------
-- 1. The tenant
-- ---------------------------------------------------------------------------

alter table public.fleets
  add column if not exists is_demo boolean not null default false;

-- `fleets.is_demo` is what shows the sample-document card, NOT the fleet id.
-- "If this is fleet ...00de" scattered through the pages would be a branch on a
-- magic value, and the point of the demo being a FLEET rather than a MODE is
-- that there are no such branches.
comment on column public.fleets.is_demo is
  'True for the demonstration tenant. Shows the sample-document card so a visitor has something to upload. Never set on a real customer.';

insert into public.fleets (id, name, is_demo)
values ('00000000-0000-0000-0000-0000000000de', 'NORTH WIND BCK500 (DEMO)', true)
on conflict (id) do update set name = excluded.name, is_demo = true;

insert into public.vessels (id, fleet_id, name, pln, label, active, sort)
values ('00000000-0000-0000-0000-00000000d001',
        '00000000-0000-0000-0000-0000000000de',
        'NORTH WIND', 'BCK500', 'NORTH WIND BCK500', true, 1)
on conflict (id) do update
  set name = excluded.name, pln = excluded.pln, label = excluded.label;

-- The boat's label was written out in three places and one was missed when it
-- changed, so a reset put the old registration back on her particulars while
-- her vessels row carried the new one. One source now — same lesson as
-- crew_ranks, the fuel suppliers and the buyer names.
create or replace function public.demo_vessel()
returns text language sql immutable as $$ select 'NORTH WIND BCK500'::text $$;

-- ---------------------------------------------------------------------------
-- 2. THE WIPE, GENERATED FROM THE SCHEMA
--
-- A hand-written list of tables would silently miss every table added
-- afterwards, and the demo would slowly fill with the last visitor's typing.
-- That is the shape of bug the role deny-loops exist to avoid, so this is built
-- the same way: walk every table in `public` carrying a `fleet_id`.
--
-- `fleets`, `vessels` and `app_users` are skipped: those three ARE the tenant.
-- `app_users` JOINED THAT LIST THE HARD WAY — it carries a `fleet_id`, so the
-- loop took it, and the first real reset deleted the demo LOGIN and locked the
-- visitor out of the boat he was being shown. Found by probing as the actual
-- account AFTER a reset rather than before one.
--
-- IT GOES ROUND AGAIN. The walk is alphabetical, which is arbitrary, and `crew`
-- comes before `landing_crew` — whose foreign keys are ON DELETE RESTRICT on
-- purpose, so a crewman cannot be deleted out from under his settled share of
-- real landings. The first wipe worked and the second was refused halfway.
-- Hand-ordering sixty-four tables would fix it and would rot, so each pass
-- deletes what it can and swallows only foreign-key refusals; when a pass
-- clears nothing new it is done. Any other error is raised rather than
-- swallowed into a reset that quietly half-works.
-- ---------------------------------------------------------------------------

create or replace function public.wipe_demo_fleet()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  demo constant uuid := '00000000-0000-0000-0000-0000000000de';
  t record;
  total integer := 0;
  cnt integer;
  pass integer := 0;
  moved integer;
  blocked text;
begin
  if demo is null then
    raise exception 'demo fleet id missing';
  end if;

  loop
    pass := pass + 1;
    moved := 0;
    blocked := '';

    for t in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables tb
          on tb.table_schema = c.table_schema and tb.table_name = c.table_name
       where c.table_schema = 'public'
         and c.column_name = 'fleet_id'
         and tb.table_type = 'BASE TABLE'
         and c.table_name not in ('fleets', 'vessels', 'app_users')
       order by c.table_name
    loop
      begin
        execute format('delete from public.%I where fleet_id = $1', t.table_name)
          using demo;
        get diagnostics cnt = row_count;
        total := total + cnt;
        moved := moved + cnt;
      exception
        when foreign_key_violation then
          blocked := blocked || t.table_name || ' ';
      end;
    end loop;

    exit when blocked = '';
    if moved = 0 then
      raise exception 'wipe_demo_fleet stuck after % passes; still referenced: %', pass, blocked;
    end if;
    if pass > 20 then
      raise exception 'wipe_demo_fleet did not settle in 20 passes; still: %', blocked;
    end if;
  end loop;

  return total;
end $function$;

revoke all on function public.wipe_demo_fleet() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE RESET
--
-- Runs on cron at 03:30 — clear of the 06:00 alert run and the 07:00 digest,
-- and an hour nobody is being shown a boat. Deliberately not during the day: a
-- reset mid-conversation takes the visitor's work out from under him.
--
--   select cron.schedule('demo-reset-nightly', '30 3 * * *',
--                        $$select public.reset_demo_fleet();$$);
--
-- And from a button on the Users page, for the case a nightly job does not
-- cover. THE GUARD IS INSIDE THE FUNCTION rather than in a Netlify handler
-- holding the service key: there is no argument to get wrong, the privilege is
-- not copied to a second place, and cron — which has no auth.uid() — still
-- passes. Probed both ways: the demo visitor is refused by name, the platform
-- owner is allowed.
--
-- ORDER MATTERS. The sales landings come first because the settlements, the
-- crew's box counts and the month closeouts are all computed FROM them. A seed
-- that invented its own figures would drift from the notes the moment either
-- changed.
--
-- THE AUDIT BOOK IS EMPTIED AFTER THE SEED. Seeding writes ~400 rows through
-- the audit triggers, so the demo opened her audit page on hundreds of machine
-- entries done by nobody — a worse demonstration than an empty one, since the
-- page exists to show who changed what. It fills with the visitor's own edits.
-- ---------------------------------------------------------------------------

create or replace function public.reset_demo_fleet()
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare cleared int; a text; b text; c text; d text; e text; noise int;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.app_users u
                      where u.id = auth.uid() and u.is_owner = true) then
    raise exception 'Only the platform owner can reset the demonstration fleet.';
  end if;

  cleared := public.wipe_demo_fleet();
  a := public.seed_demo_sales();
  b := public.seed_demo_boat();
  c := public.seed_demo_settlements();
  d := public.seed_demo_crew_work();
  e := public.seed_demo_gear_parts();

  delete from public.audit_log
   where fleet_id = '00000000-0000-0000-0000-0000000000de';
  get diagnostics noise = row_count;

  return 'cleared ' || cleared || '; ' || a || '; ' || b || '; ' || c
      || '; ' || d || '; ' || e || '; audit emptied of ' || noise;
end $function$;

revoke all on function public.reset_demo_fleet() from public, anon;
grant execute on function public.reset_demo_fleet() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE SEEDS — what each one holds and why
--
-- The bodies are long and live in the applied migrations, named at the foot of
-- this section. The reasoning is here, because that is the part worth keeping.
--
-- SALES  `seed_demo_sales()`
--   25 landings / 838 rows / £2.28m / 599 t at £3.81 a kilo, plus a logbook
--   trip apiece so `Trips.jsx` takes days at sea from the LOGBOOK rather than
--   the typed figure. THE LANDING TOTALS ARE WRITTEN FROM THE ROW SUMS, exactly
--   as the real ingest does it, so the demo reconciles for the same reason a
--   real note does rather than because the totals were typed to agree.
--
-- THE BOAT  `seed_demo_boat()`
--   Particulars, 10 crew with 50 tickets, 8 vessel certificates, a quota
--   statement, 18 engine logs, 14 fuel entries (carrying a PRICE PER LITRE,
--   which Audacious's own log lacks), 6 garbage entries, 6 maintenance tasks.
--   SOME THINGS ARE DELIBERATELY WRONG — one passport expired, one falling due,
--   a liferaft service run out. A demo where nothing is ever amiss shows none
--   of the work the app actually does.
--
-- SETTLEMENTS  `seed_demo_settlements()`
--   Eight sheets over 24 of the 25 landings, three to a sheet, each Fish Sales
--   line tying exactly to its run. Verified by running the app's own
--   `solveSettlementRuns` against the seeded data: 8 of 8 confirm exactly on
--   BOTH value and weight.
--   · The 25th landing is LEFT UNSETTLED. The office settles a run at a time
--     and the latest trip has not been paid yet, and the solver is built to
--     leave leading and trailing landings unassigned rather than force them
--     onto a sheet. A demo where every landing is settled would hide the
--     behaviour that took the most work to get right.
--   · ONE SHEET CARRIES TOWAGE, £18,400 on top of the fish line, because
--     Reconcile compares against Fish Sales and never `total_income` — the real
--     books carry £73,347 of towage on one sheet, against which the boat looked
--     as though she had earned fish she never caught.
--   · `fuel_used` is LITRES, at 5,846 a day at sea. It is a volume, not money.
--
-- CREW WORK  `seed_demo_crew_work()`, `seed_demo_contracts()`
--   The crew's own box counts (`landings` — what the box bonus is paid on, not
--   the sales note), 4 current contracts, 24 month closeouts, 12 rota trips
--   over two watches, 3 back-to-back pairs, 2 holidays, the 42-item
--   familiarisation list.
--   · THE RATES ARE THE REAL ONES — £350 a month and 15p a box. My first guess
--     of £1,450 and 55p was invented, and `ghb_first_half_pct` is a FRACTION
--     (numeric(5,4)), so seeding it as 50 overflowed the column.
--   · A CURRENT CONTRACT HAS NO END DATE. The constraint says so and it is
--     right: the end date is the day the man actually goes home, not a date
--     planned for him.
--   · ONE COMPLETED TOUR with only the FIRST HALF of the going-home bonus paid.
--     That is the case the rebuilt Crew page exists for — the old one read a
--     table that does not exist, never checked the error, and showed the FULL
--     bonus still due on a man who had already had half of it.
--   · A HOLIDAY FALLS INSIDE A TRIP, because that is the clash the planner
--     exists to catch and a rota with no clashes demonstrates nothing.
--
-- GEAR, PARTS, STORES, LIMITS  `seed_demo_gear_parts()`
--   2 nets with three generations of each of the five parts, 10 spares, a
--   stores list, 11 engine limits.
--   · THREE GENERATIONS: two finished lives to average and one still running to
--     compare against. A set still on the net is NOT a life — it has not
--     finished — so without closed ones the Life tab can only say "no renewals
--     logged yet".
--   · COST IS LEFT OFF ONE on purpose ("a lot of the time this isn't known"),
--     so the page has to average over the ones that have it and say how many
--     that was.
--   · EIGHT OF THE TEN PARTS carry a stock take and two do not. The page must
--     render counted, never-counted and nothing-recorded differently — calling
--     a part short on a balance nobody has verified is how a reorder list stops
--     being believed — and a demo where everything is counted shows one state
--     of the three.
--   · THE ENGINE LIMITS ARE UNCONFIRMED, which is the honest state: a limit
--     nobody has signed off is a suggestion. Same as the real boat, 0 of 50.
--
-- Applied migrations carrying the bodies:
--   demo_fleet_scaffold · demo_fleet_sales_seed · demo_fleet_boat_seed_fix
--   demo_vessel_single_source · demo_settlements_seed
--   demo_crew_work_real_rates · demo_gear_parts_fixed_kinds
--   wipe_demo_retries_for_fk_order · demo_reset_all_seeds
--   demo_reset_nightly_and_button · fleets_is_demo
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. THE LOGIN — and the one flag that must not be set on it
--
-- `app_users.is_owner` is the PLATFORM owner flag, not "this man owns his
-- boat". It grants read AND update on every row of `fleets`, deliberately, so
-- branding can be administered across tenants (see VesselDetails.jsx). A demo
-- visitor given it would list every real customer's vessel and could rename
-- their fleets.
--
-- The auth user is made in the Supabase dashboard so the password never passes
-- through a migration or a transcript; only the binding row is here.
--
--   insert into public.app_users (id, fleet_id, role, display_name, email, is_owner)
--   values ('<auth user id>', '00000000-0000-0000-0000-0000000000de',
--           'skipper', 'Demo Skipper', '<the demo address>', false);
--
-- Live as at Aug 2026: demo@skippermanagement.co.uk, and it SURVIVES a reset.
--
-- PROBED AS THAT ACCOUNT, after a reset, not inspected:
--   fleets [NORTH WIND BCK500 (DEMO)] · another fleet's rename -> 0 rows
--   landings 25 · rows 838 · trips 25 · quota 12 · crew 10 · crew certs 50
--   vessel certs 8 · engine 18 · fuel 14 · maintenance 6 · particulars 1
--   audit 0 · app_users 1 (its own) · payments 0
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. THE LOGBOOK CATCH DETAIL  `seed_demo_catches()`
--
-- The only thing `gear_ground_days()` reads. Without it the whole Grounds tab
-- is dead — no wear-by-ground table, no ground mix on a renewal, and the
-- confidence line stuck on "no finished sets yet".
--
-- BUILT FROM THE LANDINGS, not invented beside them: each trip's catch is its
-- own landing's weight spread over its days at sea and its species, lifted 8%
-- for gutting loss — the same figure the trip's `total_live_kg` carries. Two
-- records of one trip that disagree is the thing this app exists to catch.
--
-- FOUR GROUNDS ON A ROTATION. `groundConfidence()` is deliberately strict: three
-- finished sets AND two grounds carrying 20+ days and 2+ sets before it ranks
-- anything, because a ground with four days shows the most extreme figure on
-- the page and means nothing. Measured after seeding:
--
--     27.4.b (GBR)   41 days   17 sets   counts
--     27.6.a (GBR)   37 days   20 sets   counts
--     27.4.a (NOR)   35 days   20 sets   counts
--     27.4.a (GBR)   24 days   15 sets   counts
--
-- AND A FEW DAYS ON 27.6.a.s, on purpose. The logbook writes that local south
-- tag on the West of Scotland ground and it is NOT a division of its own —
-- `normaliseArea()` folds it into 27.6.a in the KEY and not merely the label,
-- or VIa (GBR) appears twice in the wear table. The 37 days above are the fold
-- working; without it there would be a fifth row.
--
-- Probed as the demo login: 137 ground-days, 1,502 catch rows, 25 trip dates,
-- and 0 for another fleet's boat.

-- ---------------------------------------------------------------------------
-- 7. PRICE VS FLEET IS OFF THE DEMO, in both directions
--
-- OUTWARD: `price_vs_fleet_species/grades` read every fleet's rows with no
-- exclusion, so the demo's 838 invented rows sat in the average REAL customers
-- are measured against. Nothing was corrupted — the demo writes species upper
-- case (COD) and real notes canonicalise to proper case (Cod), so they never
-- grouped — but that is luck, not design, and it breaks the first time either
-- naming changes. Both functions now join `fleets` and require `not is_demo`.
--
-- INWARD: the demo login goes to strangers and competitors, and this is the one
-- page that is deliberately cross-fleet. Excluding demo fleets from `base` does
-- both at once — the caller's own figures come back empty, so there is nothing
-- to show. Probed: demo login 0 species rows, real skipper 33 species and 23
-- cod grades, unchanged.
--
-- The menu entry carries `notOnDemo: true` as well. That hides a MENU ITEM and
-- nothing else — nav.js is presentation, the RPC is the boundary — but a page
-- answering "No sales in 2026" to a boat with 25 landings looks broken rather
-- than withheld.

-- ---------------------------------------------------------------------------
-- 8. THE DEMO MAY LOOK BUT NOT TOUCH — user management
--
-- Spotted on the demo login's own Users page: a visitor could ADD LOGINS.
--
-- Scoping was never the problem — `manage-users.js` checks the caller's fleet
-- on every branch and a visitor cannot reach another boat's users. The problem
-- is that this is the one page in the app that creates something OUTSIDE the
-- tenant: a real auth account on the project, with no limit on how many.
--
-- AND THEY WOULD OUTLIVE THE DEMO. `app_users` is on the reset's skip list on
-- purpose — the wipe took the demo login itself once and locked the visitor out
-- of the boat he was being shown — and the cost of that is that anything
-- created here is never cleared. The user list would grow for ever and never
-- come back to "Demo Skipper · you".
--
-- So `create`, `update` and `delete` are refused for a demo fleet, in the
-- function, with a sentence rather than a status code. READING IS LEFT ALONE:
-- "no Supabase dashboard required" is worth showing and the list is worth
-- seeing; it is only the writes that leave something behind.
--
-- The page says so instead of offering a form that will be turned down, which
-- is a worse way to find out. That is presentation; the refusal is the boundary.
