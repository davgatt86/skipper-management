-- THE DEMO FLEET — a whole working boat that is nobody's real boat.
--
-- WHY IT EXISTS. Showing the app to a potential customer meant showing him
-- AUDACIOUS's books: her gross, her buyers, her crew's wages. And not only
-- hers — Sandy's and Colin's landings sit in the same database, and a
-- side-by-side page could put another man's figures on the screen. That is a
-- commercial problem before it is a sales one.
--
-- WHAT IT IS NOT. It is not a second copy of the app, and it must never
-- become one. Every parser, every page and every policy is the same code the
-- real fleets run; the ONLY difference is which rows RLS hands back. A
-- "demo mode" branch would drift out of step and nobody would see it — the
-- same failure as the two parser copies, where the browser path ran 1.2.1 for
-- months against the webhook's 1.3.2 and it was invisible because the version
-- that mattered lived on a server nobody looked at.
--
-- THE BOAT. `NORTH WIND BCK500`. A Peterhead prefix so the market pages, the
-- clocks and the sales notes all make sense, and a registration number far
-- above any real PD boat so it cannot be mistaken for one. Every sample
-- document generated for this fleet carries a SAMPLE banner as well; the
-- banner is what does the safety work, not the name.
--
-- THE ID IS FIXED at ...00de and everything here is scoped to it. That is not
-- decoration: this file DELETES, and a reset pointed at the wrong fleet would
-- take a real boat's books with it. Every destructive statement is guarded.

-- ---------------------------------------------------------------------------
-- 1. The fleet, the boat, and her particulars
-- ---------------------------------------------------------------------------

insert into public.fleets (id, name)
values ('00000000-0000-0000-0000-0000000000de', 'NORTH WIND BCK500 (DEMO)')
on conflict (id) do update set name = excluded.name;

insert into public.vessels (id, fleet_id, name, pln, label, active, sort)
values ('00000000-0000-0000-0000-00000000d001',
        '00000000-0000-0000-0000-0000000000de',
        'NORTH WIND', 'BCK500', 'NORTH WIND BCK500', true, 1)
on conflict (id) do update
  set name = excluded.name, pln = excluded.pln, label = excluded.label;

-- ---------------------------------------------------------------------------
-- 2. THE WIPE, GENERATED FROM THE SCHEMA
--
-- A hand-written list of tables to clear would silently miss every table added
-- afterwards, and the demo would slowly fill with a previous visitor's typing.
-- That is exactly the shape of bug the role deny-loops exist to avoid, so this
-- is built the same way: walk every table in `public` that carries a
-- `fleet_id`, and delete this fleet's rows from it.
--
-- Children hang off their parents by CASCADE, so `sales_rows` goes with
-- `sales_landings` whether or not it carries a fleet_id of its own. Deleting
-- twice is harmless.
--
-- `fleets`, `vessels` and `app_users` are skipped: those three ARE the tenant,
-- and everything else points at them.
--
-- `app_users` JOINED THAT LIST THE HARD WAY. It carries a `fleet_id`, so the
-- generated loop took it, and the first real reset deleted the demo LOGIN and
-- locked the visitor out of the boat he was being shown. Found by probing as
-- the actual account AFTER a reset rather than before one — nothing about
-- reading the function says it, the row count does.
-- ---------------------------------------------------------------------------

create or replace function public.wipe_demo_fleet()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  demo constant uuid := '00000000-0000-0000-0000-0000000000de';
  t record;
  n integer := 0;
  cnt integer;
begin
  /* THE GUARD IS THE POINT OF THIS FUNCTION. It exists so that no caller can
   * ever hand a fleet id to a delete loop. The id is a constant in here and
   * takes no argument at all — there is nothing to get wrong at the call
   * site, which is the only way to be sure a reset cannot take a real boat's
   * books with it. */
  if demo is null then
    raise exception 'demo fleet id missing';
  end if;

  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'fleet_id'
       and tb.table_type = 'BASE TABLE'
       -- The tenant itself: the fleet, her boats, and the people who log in.
       and c.table_name not in ('fleets', 'vessels', 'app_users')
     order by c.table_name
  loop
    execute format('delete from public.%I where fleet_id = $1', t.table_name)
      using demo;
    get diagnostics cnt = row_count;
    n := n + cnt;
  end loop;

  return n;
end $function$;

comment on function public.wipe_demo_fleet() is
  'Clears every row belonging to the demo fleet. The fleet id is a CONSTANT inside the function and takes no argument, so no caller can point it at a real boat. The table list is generated from the schema, so a table added later is cleared without anyone remembering to add it.';

revoke all on function public.wipe_demo_fleet() from public, anon, authenticated;
create or replace function public.seed_demo_sales()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  demo    constant uuid := '00000000-0000-0000-0000-0000000000de';
  boat    constant uuid := '00000000-0000-0000-0000-00000000d001';
  label   constant text := 'NORTH WIND BCK500';
  -- Peterhead's own species, priced from the real board so the figures read
  -- like a market and not like a random number generator.
  sp      text[] := array['COD','HADDOCK','WHITING','MONKS','LING','LYTHE','BLACK','CAT',
                          'HAKE','LEMONS','MEGS','PLAICE','WITCH','HALIBUT','TURBOT'];
  base    numeric[] := array[4.50,2.10,1.30,5.20,2.40,1.80,2.05,1.60,
                             6.40,5.80,3.60,2.20,3.10,9.50,11.00];
  -- Buyers are invented. They have to be: a demo carrying a real firm's name
  -- beside invented prices is somebody else's commercial information.
  buyers  text[] := array['Harbour Fish Co','Blue Water Seafoods','Kirkbay Fish Ltd',
                          'Northline Fish','Baytree Seafoods','Merrick Fish Ltd'];
  gmul    numeric[] := array[1.35,1.15,1.00,0.82,0.64];   -- A1 dearest, A5 cheapest

  lid     uuid;
  ldate   date;
  i       int; s int; g int;
  nsp     int; ngr int;
  bx      numeric; bw numeric; wt numeric; ppk numeric; val numeric;
  tb numeric; tw numeric; tv numeric;
  jit     int;
  trips   int := 0; rows_made int := 0;
begin
  for i in 1..25 loop
    ldate := date '2026-01-06' + ((i - 1) * 9);
    lid   := gen_random_uuid();
    tb := 0; tw := 0; tv := 0;

    /* THE LANDING IS INSERTED WITH ZERO TOTALS AND UPDATED FROM ITS OWN ROWS.
     * That is how the real ingest does it — `sales_landings.boxes/weight/value`
     * are written from the row sum — so the demo reconciles for the same
     * reason a real note does, rather than because the totals were typed in to
     * agree. */
    insert into public.sales_landings
      (id, dedup_key, vessel, market, port, sale_no, landing_date, filename,
       boxes, weight_kg, value, consigned, reconcile_ok, fleet_id, days_at_sea,
       currency, vessel_id)
    values (lid, 'demo-' || i, label, 'Peterhead', 'Peterhead',
            'PD' || lpad(i::text, 4, '0'), ldate,
            'SAMPLE sales note ' || to_char(ldate, 'DD-MM-YYYY') || '.pdf',
            0, 0, 0, false, true, demo, 4 + (i % 4), 'GBP', boat);

    nsp := 9 + (abs(hashtext('sp' || i)) % 6);          -- 9–14 species a trip
    for s in 1..nsp loop
      ngr := 2 + (abs(hashtext('gr' || i || '-' || s)) % 3);   -- 2–4 grades each
      for g in 1..ngr loop
        jit := abs(hashtext('j' || i || '-' || s || '-' || g));
        bx  := 3 + (jit % 38);
        bw  := 30 + (jit % 9);
        wt  := round(bx * bw, 1);
        ppk := round(base[s] * gmul[g] * (0.88 + ((jit / 7) % 25)::numeric / 100), 2);
        val := round(wt * ppk, 2);

        insert into public.sales_rows
          (id, landing_id, buyer, species, species_canon, presentation, grade,
           boxes, box_weight, weight_kg, price_per_kg, price_per_box, value, msc, fleet_id)
        values (gen_random_uuid(), lid,
                buyers[1 + (jit % array_length(buyers, 1))],
                sp[s], sp[s], 'GUT', 'A' || g,
                bx, bw, wt, ppk, round(val / bx, 2), val,
                (jit % 3) = 0, demo);

        tb := tb + bx; tw := tw + wt; tv := tv + val;
        rows_made := rows_made + 1;
      end loop;
    end loop;

    update public.sales_landings
       set boxes = tb, weight_kg = tw, value = tv
     where id = lid;

    /* The logbook trip the landing belongs to. `Trips.jsx` takes days at sea
     * from HERE, not from the typed figure, so without it the demo's rate per
     * day would be the one thing on the page that is made up. */
    insert into public.quota_trips
      (id, fleet_id, trip_nr, vessel, departure_port, departure_at,
       arrival_port, arrival_at, captain, total_live_kg, printed_total_kg,
       reconcile_ok, filename, vessel_id)
    values (gen_random_uuid(), demo, 'T' || lpad(i::text, 3, '0'), label,
            'Peterhead', (ldate - (4 + (i % 4)))::timestamptz + interval '6 hours',
            'Peterhead', ldate::timestamptz + interval '4 hours',
            'A Skipper', round(tw * 1.08, 1), round(tw * 1.08, 1),
            true, 'SAMPLE logbook ' || i || '.xlsx', boat);
    trips := trips + 1;
  end loop;

  return trips || ' landings, ' || rows_made || ' rows';
end $function$;

revoke all on function public.seed_demo_sales() from public, anon, authenticated;

create or replace function public.seed_demo_boat()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  demo constant uuid := '00000000-0000-0000-0000-0000000000de';
  boat constant uuid := '00000000-0000-0000-0000-00000000d001';
  cid  uuid;
  sid  uuid;
  tid  uuid;
  i    int; d date; jit int;
  hrs  numeric;
  out_ text := '';
  n    int;
  -- Invented people. A demo carrying a real crewman's name and passport is a
  -- data-protection problem however sample the rest of it is.
  names text[]  := array['Alan Reid','Peter Gallacher','Iain Wisely','Sandy Cormack',
                         'Tomasz Wilk','Rolando Cruz','Ben Wiseman','Callum Tait',
                         'Marek Nowak','Danny Ross'];
  ranks text[]  := array['skipper','mate','chief_engineer','second_engineer','cook',
                         'deckhand','deckhand','deckhand','deckhand','deckhand'];
  nats  text[]  := array['British','British','British','British','Polish',
                         'Filipino','British','British','Polish','British'];
begin
  ---------------------------------------------------------------- particulars
  insert into public.vessel_details
    (fleet_id, vessel_id, vessel_name, pln, call_sign, home_port, owner,
     skipper_name, flag_state, length_overall, breadth, depth, gross_tonnage,
     net_tonnage, year_built, engine_make, engine_kw)
  values (demo, boat, 'NORTH WIND', 'BCK500', 'MSAMPLE', 'Peterhead',
          'North Wind Fishing Co (sample)', 'Alan Reid', 'United Kingdom',
          26.5, 8.2, 5.4, 320, 96, 2014, 'Sample Marine 8L', 1100)
  on conflict (fleet_id, vessel_id) do update
    set vessel_name = excluded.vessel_name, pln = excluded.pln;

  ---------------------------------------------------------------------- crew
  for i in 1..array_length(names, 1) loop
    cid := gen_random_uuid();
    jit := abs(hashtext('c' || i));
    insert into public.crew
      (id, fleet_id, vessel_id, full_name, status, crew_type, rank_code,
       nationality, passport_number, passport_country, passport_expiry,
       date_of_birth, place_of_birth, embarked_date)
    values (cid, demo, boat, names[i],
            case when i <= 8 then 'on_boat' else 'on_leave' end::crew_status,
            case when i <= 6 then 'self_employed' else 'contracted' end,
            ranks[i], nats[i],
            'SAMPLE' || lpad(i::text, 5, '0'), nats[i],
            /* One passport is DELIBERATELY expired and one falls due inside the
             * alert window. A demo where nothing is ever wrong shows none of
             * the work the app actually does — the whole point of the crew page
             * is catching the ticket that has run out. */
            case i when 4 then date '2026-07-02'
                   when 7 then date '2026-09-20'
                   else date '2026-01-01' + ((jit % 1400) + 400) end,
            date '1968-01-01' + (jit % 9000),
            'Sample', date '2026-01-06')
    ;

    insert into public.crew_certificates
      (id, fleet_id, crew_id, cert_type, category, cert_number, holder_name,
       issuer, issue_date, expiry_date)
    select gen_random_uuid(), demo, cid, c.t, c.cat,
           'SAMPLE-' || i || '-' || c.n, names[i], 'Sample Maritime Authority',
           date '2023-03-01' + ((jit + c.n * 37) % 400),
           date '2026-06-01' + (((jit + c.n * 53) % 900) - 90)
      from (values ('Basic Sea Survival','Safety',1),
                   ('Fire Prevention and Fire Fighting','Safety',2),
                   ('Elementary First Aid','Medical',3),
                   ('Personal Safety and Social Responsibility','Safety',4),
                   ('ENG 1 Medical Certificate','Medical',5)) as c(t, cat, n);
  end loop;
  get diagnostics n = row_count;
  out_ := out_ || array_length(names, 1) || ' crew';

  ----------------------------------------------------------- vessel certificates
  insert into public.vessel_certificates
    (id, fleet_id, vessel_id, cert_type, category, cert_number, issuer,
     issue_date, expiry_date)
  select gen_random_uuid(), demo, boat, c.t, c.cat, 'SAMPLE-V' || c.n,
         'Sample Maritime Authority', c.iss, c.exp
    from (values
      ('UK Fishing Vessel Certificate','Statutory','01', date '2024-05-14', date '2027-05-13'),
      ('Certificate of Registry','Statutory','02', date '2023-02-01', date '2028-01-31'),
      ('Radio Licence','Radio','03', date '2025-01-10', date '2027-01-09'),
      ('Inflatable Liferaft Service','LSA','04', date '2025-07-20', date '2026-07-24'),
      ('Portable Fire Extinguisher Service','FFA','05', date '2025-08-26', date '2026-08-26'),
      ('Certificate of Insurance','Insurance','06', date '2025-04-01', date '2027-03-31'),
      ('Medical Stores Certificate','Medical','07', date '2025-06-01', date '2027-05-31'),
      ('TBT-Free Antifouling','Pollution','08', date '2024-09-01', date '2029-08-31')
    ) as c(t, cat, n, iss, exp);
  out_ := out_ || ', 8 vessel certs';

  --------------------------------------------------------------------- quota
  sid := gen_random_uuid();
  insert into public.quota_snapshots
    (id, fleet_id, vessel_id, year, vessel, last_landing_date, last_updated,
     filename, reconcile_ok)
  values (sid, demo, boat, 2026, 'NORTH WIND BCK500', date '2026-08-10', now(),
          'SAMPLE quota statement 2026-08.pdf', true);

  insert into public.quota_lines
    (id, snapshot_id, fleet_id, section, stock, allocation, catch_total, balance)
  select gen_random_uuid(), sid, demo, q.sec, q.stock, q.alloc, q.caught,
         q.alloc - q.caught
    from (values
      ('North Sea','COD 4',        420000, 331500),
      ('North Sea','HAD 4',       1180000, 902000),
      ('North Sea','WHG 4',        240000, 118400),
      ('North Sea','POK 4',        610000, 588200),
      ('North Sea','MON 4',        150000, 141800),
      ('North Sea','LIN 4',         96000,  52300),
      ('North Sea','HKE 4',         74000,  71900),
      ('North Sea','PLE 4',        130000,  41200),
      ('North Sea','LEM 4',         58000,  33100),
      ('West of Scotland','COD 6a',  18000,   4200),
      ('West of Scotland','HAD 6a',  62000,  28700),
      ('West of Scotland','MON 6a',  44000,  39500)
    ) as q(sec, stock, alloc, caught);
  out_ := out_ || ', 12 quota lines';

  ----------------------------------------------------------- engineer's books
  hrs := 41200;
  for i in 1..18 loop
    d := date '2026-04-02' + (i * 8);
    jit := abs(hashtext('e' || i));
    hrs := hrs + 90 + (jit % 40);
    insert into public.engine_logs
      (id, fleet_id, vessel_id, log_date, running_hours, readings, logged_by)
    values (gen_random_uuid(), demo, boat, d, hrs,
      jsonb_build_object(
        'Main Engine 1', jsonb_build_object(
          'RPM', 860 + (jit % 40),
          'Running Hours', hrs,
          'Lube Oil Pressure', round(4.4 + ((jit % 6)::numeric / 10), 1),
          'Charge Air Pressure', round(1.6 + ((jit % 9)::numeric / 10), 1),
          'HT OUT Temp', 76 + (jit % 7),
          'Turbo IN Temp', 470 + (jit % 30),
          'Unit 1 Exhaust Temp', 405 + (jit % 30),
          'Unit 2 Exhaust Temp', 408 + ((jit / 3) % 30)),
        'Gearbox 1', jsonb_build_object(
          'Clutch Pressure', 26 + (jit % 5),
          'Oil Temp IN', 32 + (jit % 6)),
        'Generator 1', jsonb_build_object(
          'RPM', 1500 + (jit % 30),
          'Jacket Water Temp', 78 + (jit % 5),
          'Running Hours', 6100 + i * 40)),
      'Sample Engineer');
  end loop;
  out_ := out_ || ', 18 engine logs';

  for i in 1..14 loop
    d := date '2026-03-01' + (i * 12);
    jit := abs(hashtext('f' || i));
    insert into public.vessel_fuel_log
      (id, fleet_id, vessel_id, kind, entry_date, litres, grade, location,
       counterparty, recorded_by, price_per_litre, currency)
    values (gen_random_uuid(), demo, boat,
            case when i % 5 = 0 then 'lube_oil' else 'fuel' end, d,
            case when i % 5 = 0 then 200 + (jit % 200) else 28000 + (jit % 22000) end,
            case when i % 5 = 0 then 'Sample 40' else 'MGO' end,
            'Peterhead', 'Sample Fuels Ltd', 'Sample Engineer',
            /* The demo carries a PRICE, which Audacious's own log does not.
             * That is the difference between a fuel page that reports litres
             * and one that reports money, and it is worth a visitor seeing. */
            round(0.62 + ((jit % 14)::numeric / 100), 3), 'GBP');
  end loop;
  out_ := out_ || ', 14 fuel entries';

  for i in 1..6 loop
    insert into public.garbage_log
      (id, fleet_id, vessel_id, entry_date, category, disposition, quantity_m3,
       port, recorded_by)
    values (gen_random_uuid(), demo, boat, date '2026-04-10' + (i * 20),
            /* MARPOL's own coded categories — the CHECK on this table holds
             * them to the Garbage Record Book's wording, which is right: it is
             * a legal record and 'Food waste' is not what the book says. */
            case i % 3 when 0 then 'A Plastics' when 1 then 'B Food wastes' else 'F Operational wastes' end,
            'To reception facility', round((0.3 + (i::numeric / 10)), 1), 'Peterhead', 'Sample Mate');
  end loop;
  out_ := out_ || ', 6 garbage entries';

  ---------------------------------------------------------------- maintenance
  for i in 1..6 loop
    tid := gen_random_uuid();
    insert into public.maintenance_tasks
      (id, fleet_id, vessel_id, name, component, interval_days, interval_hours,
       sort_order, active)
    select tid, demo, boat, m.n, m.c, m.days, m.hours, i, true
      from (values (case i when 1 then 'Main engine oil and filters'
                          when 2 then 'Gearbox oil change'
                          when 3 then 'Generator 1 service'
                          when 4 then 'Sea water pump impeller'
                          when 5 then 'Steering gear inspection'
                          else 'Liferaft service' end,
                    case i when 1 then 'Main Engine 1'
                          when 2 then 'Gearbox 1'
                          when 3 then 'Generator 1'
                          when 4 then 'Main Engine 1'
                          when 5 then 'Steering'
                          else 'Safety' end,
                    case i when 6 then 365 else null end,
                    case i when 6 then null else 250 * i end)) as m(n, c, days, hours);

    insert into public.maintenance_events
      (id, fleet_id, task_id, done_on, running_hours, done_by)
    values (gen_random_uuid(), demo, tid,
            date '2026-05-01' + (i * 9), 41300 + (i * 120), 'Sample Engineer');
  end loop;
  out_ := out_ || ', 6 maintenance tasks';

  return out_;
end $function$;

revoke all on function public.seed_demo_boat() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE RESET
--
-- A demo tenant is scribbled on within a day of the first visitor, so putting
-- it back is part of the design and not something to bolt on afterwards.
--
-- It takes NO ARGUMENT. The fleet id is a constant inside `wipe_demo_fleet()`,
-- so there is nothing to get wrong at the call site — the only way to be sure
-- a reset can never take a real boat's books with it.
-- ---------------------------------------------------------------------------

create or replace function public.reset_demo_fleet()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cleared int; a text; b text; noise int;
begin
  cleared := public.wipe_demo_fleet();
  a := public.seed_demo_sales();
  b := public.seed_demo_boat();

  /* The seed writes through the audit triggers, so the demo boat opened her
   * audit book on 312 machine entries done by nobody. That is a worse
   * demonstration than an empty one: the page exists to show WHO changed WHAT.
   * Cleared AFTER the seed, so the book fills with the visitor's own edits. */
  delete from public.audit_log
   where fleet_id = '00000000-0000-0000-0000-0000000000de';
  get diagnostics noise = row_count;

  return 'cleared ' || cleared || ' rows; seeded ' || a || '; ' || b
      || '; audit book emptied of ' || noise || ' seeding entries';
end $function$;

revoke all on function public.reset_demo_fleet() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE LOGIN — and the one flag that must not be set on it
--
-- `app_users.is_owner` is the PLATFORM owner flag, not "this man owns his
-- boat". It grants read AND update on every row of `fleets`, deliberately, so
-- branding can be administered across tenants (see VesselDetails.jsx). A demo
-- visitor given it would list every real customer's vessel and could rename
-- their fleets.
--
-- So the demo login is created with is_owner = false, and so is every customer.
--
-- The auth user itself is NOT created here. It is made in the Supabase
-- dashboard so the password never passes through a migration file or a
-- transcript, and only the `app_users` row that binds it to this fleet is
-- version-controlled:
--
--   insert into public.app_users (id, fleet_id, role, display_name, email, is_owner)
--   values ('<auth user id>', '00000000-0000-0000-0000-0000000000de',
--           'skipper', 'Demo Skipper', '<the demo address>', false);
--
-- Live as at Aug 2026: demo@skippermanagement.co.uk, and it SURVIVES a reset
-- now that app_users is on the wipe's skip list.
--
-- Probed as that user, not inspected:
--   fleets=[NORTH WIND BCK500 (DEMO)]  ·  another fleet's rename -> 0 rows
--   landings=25  rows=838  trips=25  quota=12  crew=10  crew certs=50
--   vessel certs=8  engine=18  fuel=14  garbage=6  maintenance=6
--   app_users=1 (its own)
-- ---------------------------------------------------------------------------

create or replace function public.seed_demo_settlements()
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  demo constant uuid := '00000000-0000-0000-0000-0000000000de';
  bid  constant uuid := '00000000-0000-0000-0000-00000000d0b1';
  sid  uuid;
  i    int;
  fish numeric; tow numeric; exp numeric; rec numeric;
  wt numeric; days numeric; nland int;
  share numeric; wages numeric;
  made int := 0;
  r    record;
begin
  insert into public.su_boats (id, fleet_id, name, registration, format, agent, active, ledger_no)
  values (bid, demo, 'North Wind', 'BCK500', 'audacious', 'Sample Fish Selling Co', true, '99')
  on conflict (id) do update set name = excluded.name, registration = excluded.registration;

  /* EIGHT SETTLEMENTS OVER TWENTY-FOUR LANDINGS, three to a sheet.
   *
   * The twenty-fifth is left UNSETTLED on purpose. The office settles a run of
   * trips at a time and the most recent one has not been paid yet, so a landing
   * with no settlement is the normal state — and `solveSettlementRuns` is built
   * to leave leading and trailing landings unassigned rather than force them
   * onto a sheet. A demo where every landing is settled would hide the one
   * behaviour that took the most work to get right. */
  for i in 0..7 loop
    select sum(l.value), sum(l.weight_kg), sum(coalesce(l.days_at_sea, 0)), count(*)
      into fish, wt, days, nland
      from (select * from public.sales_landings
             where fleet_id = demo order by landing_date
             offset i * 3 limit 3) l;
    exit when nland < 3;

    /* TOWAGE ON ONE SHEET, and it is the point of putting it there.
     *
     * `Reconcile.jsx` compares against the FISH SALES line, never
     * `total_income`, because a settlement can carry income the boat never
     * landed — the real books show towage of £73,347 on one sheet, against
     * which the boat looked as though she had earned fish she never caught.
     * The demo carries one so the page can be shown doing the right thing. */
    tow := case when i = 4 then 18400.00 else 0 end;

    exp := round(fish * 0.446, 2);
    rec := round(fish * 0.011, 2);
    share := round(fish + tow - exp + rec, 2);
    wages := round(share * 0.40, 2);

    sid := gen_random_uuid();
    insert into public.su_settlements
      (id, boat_id, reference, settling_date, period, status,
       total_income, total_expenses, total_recoveries,
       crew_owners_share, crew_wages_total, owners_share,
       trips, days_at_sea, fuel_used, weight_landed, trip_type)
    values (sid, bid, 'SAMPLE/' || lpad((i + 1)::text, 3, '0'),
            (select max(landing_date) + 5 from
              (select landing_date from public.sales_landings
                where fleet_id = demo order by landing_date offset i * 3 limit 3) z),
            'Trips ' || (i * 3 + 1) || '–' || (i * 3 + 3), 'final',
            fish + tow, exp, rec, share, wages, round(share - wages, 2),
            3, days,
            /* LITRES, not pounds. `su_settlements.fuel_used` is a volume — it
             * averages 74% of the expense bill on the real sheets, which is
             * impossible for a cost, and works out at a working day's burn per
             * day at sea. Seeding it as money would teach the wrong thing. */
            round(days * 5846, 0),
            wt, 'fishing');

    insert into public.su_settlement_lines (id, settlement_id, section, label, amount, sort)
    values (gen_random_uuid(), sid, 'income', 'Fish Sales', fish, 1);
    if tow > 0 then
      insert into public.su_settlement_lines (id, settlement_id, section, label, amount, sort)
      values (gen_random_uuid(), sid, 'income', 'Towage', tow, 2);
    end if;

    -- The expense labels the real sheets carry, in the proportions they run at.
    insert into public.su_settlement_lines (id, settlement_id, section, label, amount, sort)
    select gen_random_uuid(), sid, 'expense', e.l, round(exp * e.f, 2), e.s
      from (values ('Fuel', 0.497, 10), ('Ice', 0.041, 11), ('Boxes', 0.052, 12),
                   ('Landing Dues', 0.063, 13), ('Harbour Dues', 0.028, 14),
                   ('Commission', 0.092, 15), ('Provisions', 0.048, 16),
                   ('Stores', 0.037, 17), ('Insurance / Rentals', 0.055, 18),
                   ('Levies', 0.031, 19), ('Crew Pro', 0.026, 20),
                   ('Sundries', 0.030, 21)) as e(l, f, s);

    insert into public.su_settlement_lines (id, settlement_id, section, label, amount, sort)
    select gen_random_uuid(), sid, 'recovery', v.l, round(rec * v.f, 2), v.s
      from (values ('Rec. Stores', 0.55, 30), ('Rec. Sundries', 0.45, 31)) as v(l, f, s);

    made := made + 1;
  end loop;

  return made || ' settlements over ' || (made * 3) || ' landings, one carrying towage';
end $function$;

revoke all on function public.seed_demo_settlements() from public, anon, authenticated;
