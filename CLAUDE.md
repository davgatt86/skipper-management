# Skipper Management

Multi-tenant SaaS for fishing vessel operations — sales notes, quota, crew shares,
daily market prices. Built and run by David Gatt, skipper/owner of AUDACIOUS BF83.

## Stack and deploy chain

- Vite + React front end
- Supabase (project `fbdfskjojgatsgmvxozo`, London) — Postgres + auth + RLS
- Netlify at `skipper-management.netlify.app`, builds from `main` on push
- Netlify Functions host the sales-note parsers
- Email ingest: CloudMailin → Netlify Function → `parseMarketFromDoc` → Supabase

Never deploy to Netlify directly. GitHub is the build source; a direct deploy
gets overwritten on the next push.

## Tenancy model — read this before touching any query

Every vessel is a **separate business** with its own skipper, quota and sales.
Don Fishing is only a shared selling agent, not a parent company.

**12 fleets as at Aug 2026** — Audacious BF83 · Beryl BF440 · Boy John INS110 +
Rosebloom INS353 · Guiding Light H90 + Faithlie FR220 · Our Lass WY241 &
Victory Rose WY34 · Achieve FR100 · Avrella LK174 · Boy Andrew WK170 ·
Replenish FR227 · Opportune LK209 · Hanstholm · Test Fleet.

Four of those are pair teams by name, so the missing `vessels` table is not a
someday problem. Beryl BF440 is a **separate business** from Audacious, with its
own login — not a second boat in David's fleet.

RLS pattern, confirmed across all feature tables:
- a permissive `ALL` policy, plus
- a **restrictive** `fleet_isolation` policy using `current_fleet_id()` /
  `current_user_fleet_id()` / `current_user_role()`

New tables need `GRANT USAGE ON SCHEMA public` plus SELECT/INSERT/UPDATE/DELETE
to the `authenticated` role, or new tenants get permission errors.

Never write a query that reads across fleets unless the feature is explicitly
cross-fleet and anonymised (the Price vs Fleet benchmark page, which has a
minimum-three-boats guard).

### The `su_*` (Square Up settlements) tables are the exception

They were built outside this repo and use their own model: `su_is_allowed()`
(an email allow-list in `su_allowed_users`, default **closed**) ANDed with
`su_visible_boat()` (boat scoping, historically default **open**).

`supabase/su_fleet_isolation.sql` moves them onto `fleet_id` +
`current_fleet_id()`, with cross-fleet reads made explicit in
`su_fleet_agents` — one row per (fleet, boat) instead of "unconfigured means
see everything". **Applied Aug 2026 and verified**: row counts unchanged, both
logins behave as before, the Netlify site still works.

Audacious holds one grant over Beryl. David's decision (Aug 2026) is to **keep
it until every stage of the settlements integration is complete**, then break
away with `delete from public.su_fleet_agents;` — no schema change, no redeploy.

**Storage policy bug, found and fixed Aug 2026.** The three `su_docs_*`
policies on `storage.objects` were written with a bare `name` inside
`exists (select 1 from su_boats b where b.id::text =
(storage.foldername(name))[1] ...)`. `su_boats` has its own `name` column, so
the inner relation shadowed the outer one and the expression read the **boat's
name** rather than the object's path. "Audacious" never equals a uuid, so the
EXISTS was always false and **every authenticated read, insert and delete on
`su-documents` was denied** — 45 objects, 32 of them referenced by a
settlement. `pg_policies` printing it back as `storage.foldername(b.name)` is
the only visible symptom.

Always write `storage.objects.name` in these policies. The same shape is safe
in `crew_certs_*` and `su_samples_*` only because their `foldername(name)`
sits at the top level of the policy, not inside a subquery.

`su_user_boat_access` is now inert. If the Netlify app offers a screen for
managing boat access it will appear to work and change nothing; visibility
comes from `fleet_id` and `su_fleet_agents`.

`su_parse_jobs` is deliberately still unscoped — the AI reader edge function
inserts with the service-role key, so `current_fleet_id()` is null there, and
the **client polls that table with its own session** to collect the result.
Scoping it would hang every read until the six-minute deadline; it needs the
edge function changed to set `fleet_id` from the caller's JWT first. See the
notes in `supabase/su_fleet_isolation.sql` and `src/lib/su/parse.js`.

### Settlements (stage 2, in progress)

`Settlements.jsx` reads the `su_*` tables; `SettlementImport.jsx` adds one from
the office PDF or a photo via the `su-parse-document` edge function, with the
client in `src/lib/su/parse.js`.

- No fleet filter is applied in those queries on purpose. RLS decides what comes
  back; a client-side filter would hide where the boundary actually is.
- The reader is a model reading a photo, so the review screen shows each total
  **twice** — as printed on the sheet and as the lines add up — and a difference
  must be acknowledged before saving. What gets stored is the line-derived
  figure, so a settlement's own totals always add up from its own lines.
- Two formats, driven off `su_boats.format`: the Audacious posting report
  (income/expense/recovery) and the Beryl one-page sheet (all expense, plus
  `boat_share` / `fuel_pct` / `commission`). Beryl sheets carry no reference, so
  one is derived from the settling date — `su_settlements` is unique on
  (boat_id, reference).
- The Beryl **xlsx template reader is not carried over, and is not wanted**: it
  was only used once, to load their historical settlements. Ongoing sheets
  arrive as a PDF.

**One vessel per fleet is currently baked into the schema.** `vessel_details`
has `fleet_id` as its primary key, and no table anywhere carries a `vessel_id`.
A pair team is therefore two fleets today, not two vessels in one fleet. See
Outstanding work before promising any multi-vessel behaviour.

## Live modules

Dashboard · Fish Sales · Sales Insights · Daily Prices · Where to Land /
Estimator · Square Up · Crew · Contracts · Landings · Month Closeout ·
One-Off Bonuses (skipper only) · Rota · Quota (position + forecast) ·
Price vs Fleet · Alerts · Forecast · Crew List

## Parsers

`parse-core.cjs` (this repo, Netlify Functions) and `parse-core.js` (in
`davgatt86/fish-sales-tracker`) are **identical files**. Any fix must be applied
to both, and the version bumped. Currently 1.3.0.

Supported sales notes: Peterhead / Don (P&J Johnstone), Hanstholm Afregning
(DKK → GBP via ECB cross-rate), Hanstholm GBP Invoice, Shetland (LHD + SSA),
Scrabster.

Rules learned the hard way:
- Test against real PDF text extracted with pdf.js, never against an assumed
  line format. Two P&J buyer fixes failed because they were written blind.
- P&J buyer extraction anchors on the Withdrawn Y/N flag at x≈467 and collects
  buyer tokens from the Name column (x 500–634) by nearest band within 9px.
- A+ grades (A+1 to A+5) must be captured — regex `A\+?[0-5]`. Dropping them
  silently undercounts revenue.
- Duplicate landing → replace in place: update the landing fields, delete its
  `sales_rows`, re-insert from a fresh parse. This keeps the landing ID so
  days-at-sea and crew links survive re-ingestion.
- DKK landings store `value_dkk` / `ppk_dkk` in metadata and land rate-pending
  if no FX rate is available. Never enter DKK at face value.
- `reconcile_ok = false` means the parse failed, not that the display is off.
  Trip values on those landings cannot be trusted.

## Domain rules that affect code

- A4 haddock sub-grades: mini = cheapest boxes, chipper = dearest, metro = the
  remainder. Never the other way round.
- Grade labels are matched as exact strings by the estimator — SPRAG, ROBBY,
  BABY, CHIPPER, METRO, MINI METRO, FROGS, CATS, RANS, MEGS, LYTHE, HADD, WHIT,
  MONK. Do not normalise or retitle them.
- Species canonicalisation: Witches→Witch, Pollack→Lythe, CATFISH→CAT,
  MEGS→MEGRIM, RANS→ROE, ROBBY/BABY→A5 cod, COLAS/PODS→A4 saithe,
  BOBBY DAZLER→A1 cod, BYROS/PINS→A5 hake.
- Vessel labels are always "NAME REG" — "AUDACIOUS BF83". "AUDACIOUS" alone is
  the same vessel.
- Peterhead volume is box counts per species. Denmark is kg landed, and only the
  fiskeauktion.dk export carries per-species kg — the emailed Hanstholm day
  sheet has a day total only, rounded to 100 kg.

## Pair teams

Sandy and Gavin each run two boats towing one net. Two boats, one trip.

- Show a vessel picker **only when the fleet has more than one vessel.**
  Single-vessel tenants never see one.
- Combined view: sum gross and boxes. Do **not** sum days at sea — both boats
  fished the same days, so the pair rate is pair gross ÷ the trip's days.
- Never combine crew shares. Different crews, different numbers aboard.
- Never combine quota. Separate businesses, separate allocations — summing hides
  one boat running short behind one that isn't.

**CORRECTION (Aug 2026): a pair is ONE fleet, not two.** The earlier note that
"a pair team is two fleets today" is wrong for sales. `BOY JOHN INS110 +
ROSEBLOOM INS353` and `GUIDING LIGHT H90 + FAITHLIE FR220` are each a single
fleet, and the two boats are told apart by `sales_landings.vessel`. So a
side-by-side comparison needed no `vessels` table at all — it is
`byVessel(rows, landingById)` in `src/lib/salesAgg.js`, shown on Fish Sales
whenever a fleet has more than one vessel label in scope.

The vessels schema is still needed for crew, quota and rota, which have no
vessel column. It is not needed for sales.

**Vessel labels split the same boat.** `BOYJOHN INS110` (no space) held 6
landings and £556,164 apart from `BOY JOHN INS110`, making the boat look like
it landed 25 trips against Rosebloom's 31. Merged Aug 2026 — both now read 31
landings, £3,566,572 vs £3,533,893, within 1%, which is what a pair towing one
net should look like. Third instance of the same pattern after `crew_ranks`
and fuel suppliers: **anything typed rather than picked will drift.**

Still open: `FAITHFUL II`, one landing on 03-03-2026 worth £24,755 in the
Guiding Light fleet. Either a third boat or a misread of FAITHLIE — not
guessed either way.

**Pair analysis on Fish Sales (Aug 2026).** A vessel picker appears only when
a fleet has more than one vessel in scope; it drives the whole page, so you
get pair-combined figures or one boat's. The four pair panels always use both
boats regardless, since comparing a boat with itself is meaningless:
- **Boat against boat** — landings, gross, share, boxes, tonnes, £/kg + pair
  total. Days at sea are never summed.
- **Same-day price gap** — `samedayPriceGap()`. Baseline for Boy John /
  Rosebloom: 29 paired days, average gap £0.151/kg (4.8%), worst £0.786. But
  **15 days one boat, 14 the other, mean difference £0.000** — the gap is
  noise, not bias. Treat a big single day as its own event, not a trend.
- **Species mix divergence** — `speciesMixDivergence()`, share of each boat's
  own total, widest spread first. Towing one net they should match.
- **Which boat sold where** — `vesselMarketSplit()`. A split market on one day
  is a decision worth reviewing.

## Design system (agreed Aug 2026, shipped Aug 2026)

- Type: Big Shoulders Display for vessel names, registrations and headings,
  IBM Plex Sans for body, IBM Plex Mono for every figure so columns align.
  Self-hosted via `@fontsource` and imported in `main.jsx` — fonts are bundled,
  not fetched, so a boat on patchy signal still gets the right typeface.
- Palette: ink `#0A1D26`, hull cobalt `#1749A8`, paper `#ECEFEE`,
  rust `#C2342A` for short/over, brass `#A97614` for watch, kelp `#26654F` for
  on track. Defined once in `src/index.css`.
- The legacy token names (`--navy`, `--green`, `--amber`, `--red`, `--grey-*`)
  are kept and remapped onto the new palette, so every page picked up the
  rebrand without being individually rewritten. New work should prefer the
  semantic names: `--hull`, `--kelp`, `--brass`, `--rust`, `--mute`.
- The registration number is the identity. Vessel plates are solid cobalt with
  one angled white flash on the far right, well clear of the lettering.
  No repeating chevron pattern anywhere behind text — it was tried and cut.
  `VesselPlate.jsx` / the `.plate` class.
- Section rules are a hairline with a short cobalt tick, not a patterned bar.
  `SectionRule.jsx` / the `.rule` class.
- Login: a photo of an unidentified trawler at dusk. `login-trawler-dusk-1600.jpg`
  (1600px, 190 KB) on desktop, `login-trawler-dusk.jpg` (1200px, 116 KB) below
  820px. Deliberately not Audacious — other skippers log in here.
  The boat sits in the lower left of the frame, so the sign-in column is on the
  **right** on desktop and the veil runs from the right. Darkening the left
  instead would bury the boat, which is the one thing the photo is there to show.
  On narrow screens the crop is pulled to 28% so the boat stays in shot.
- Every page is a sidebar shell (`AppShell.jsx` + `nav.js`), not a tile wall.
  The menu is the only way back — there is no BackNav — so `nav.js` must always
  carry a Dashboard entry (`to: '/'` with `end: true`, or NavLink marks it
  active everywhere). The sidebar wordmark links home as a second route.
  Pages open with `PageHeader` (title, optional sub and eyebrow, actions on the
  right) — the sidebar handles getting back, so no page carries a BackNav or a
  "← Dashboard" link. `AppShell` takes `maxWidth` for pages built narrow.
  Permission-denied early returns must also render inside `AppShell`, or a
  viewer who hits a skipper-only page lands on a bare screen with no menu.
  The menu groups the same destinations the tiles offered, with the same role
  gating — the grouping changes how they are found, not who can reach them.
  Below 900px the sidebar becomes a drawer. The main column carries figures:
  the plate, a trip strip (last trip gross, per day at sea, boxes, rolling 12
  months) and the quota position, all from real queries.
- The dashboard quota block reads `quota_lines` off the latest statement for the
  current year. That is the **statement position only** — it does not include
  trips landed since, which is why it is labelled with the statement date and
  points at the Quota page. Do not present it as a live position.
- Charts use `var(--hull)` etc. rather than literal hex, so they follow the
  day/dark choice. The exceptions are Square Up and the Estimator, whose
  palettes are literal because they also draw PDFs outside the DOM, and the
  categorical series colours in `EngineLogs.jsx` and `Rota.jsx`, which are
  chosen for distinguishability rather than brand.
- Dark mode is the night wheelhouse: cobalt is far too dark to read on an unlit
  screen, so `--hull` lifts to `#6FA3EE` and the signal colours are dimmed so
  red/green don't wreck night vision.

## Agreed next build (Aug 2026) — crew, logs and vessel certs

Aegir (`aegirfleet.com`) is a paid vessel-management subscription David uses.
It was explored Aug 2026 to decide what to copy. **Wanted**: crew page rebuild,
familiarisation, rota planner, log page, vessel certs, days-at-sea repair.
**Not wanted**: hours of rest, PLB tracking, crew schedule (same as rota
planner), inspection pack, AI audit.

### Crew — one page, five sections
Replaces the crew-hub tile wall (a second menu duplicating the sidebar).
1. **Crew status** — all crew, both types. Status changed here and nowhere else.
2. **Contracted crew** — merges what are now five separate tiles (Contracts,
   Landings, Month Closeout, One-Off Bonuses, Bonus Settings). They are all
   contracted-crew-only and are one workflow: contract runs → boxes land →
   month closes → bonus falls due.
3. **Crew list** — generated from the status just set, then asks only for the
   voyage bits. Aim for the IMO FAL 5 form, which is what Aegir exports.
4. **Rota planner** — renamed from Rota, rebuilt for legibility.
5. **Certificates** — largely kept; it is the strongest page in the app.

The crew record must gain **rank, nationality, passport number + expiry and
embarked date** first, or the crew list cannot be produced. Aegir holds all of
it for the 10 crew aboard and it can be migrated.

Self-employed crew must stop being shown contract language ("no ended contract
on record") — contracts only apply to contracted crew.

### Known defects found Aug 2026
- ~~Money renders as `GBP192.30`~~ — fixed. `settings.currency` really is the
  string `GBP`, so it was being concatenated raw. Both crew pages now map a
  currency **code** to its symbol and only pass through something already short
  enough to be one. Other pages may still do this; grep for `settings.currency`.
- **The going-home-bonus figure was always wrong** (found Aug 2026). CrewHub
  queried a table called `wage_payments`, which does not exist — it is
  `payments` — and it never checked that query's error. So "GHB on return"
  showed the **full** bonus even where half had already been paid. Fixed in the
  rebuilt `Crew.jsx`. Worth checking whether anything else reads `wage_payments`
  or silently drops a `.error`.
- ~~Every crewman shows "no passport on file"~~ — fixed Aug 2026 by the Aegir
  migration; 17 of Audacious's 20 crew now carry a passport. **Rank still
  defaults to Deckhand on every voyage**: it is now stored on the crewman
  (`crew.rank_code`) but `CrewList.jsx` does not read it, and its free-text
  `RANKS` list does not use the `crew_ranks` codes. Wire it up in section 3.
- ~~The certificates page tells the user to run a `.sql` backfill~~ — fixed
  Aug 2026 by the in-app categoriser. **But it was not the only one.** The
  same defect is in two more places, though **both are dead code today**:
  - `Quota.jsx:454` offers to have the skipper run
    `supabase/quota_manual.sql`. That migration **is** applied —
    `quota_manual_stocks` and `quota_manual_entries` both exist with the
    right grants and both policies. `manualReady` only goes false if the
    query errors, so the message cannot currently show.
    (The tables are named `quota_manual_stocks` / `quota_manual_entries`, not
    `quota_manual` — checking the filename as a table name gives a false
    negative.)
  - `DailyPrices.jsx:131` says the same about `supabase/market_prices.sql`.
    That table exists too.

  Both will surface for a **new tenant** whose tables are not set up, which
  is exactly when a skipper is least able to act on them.

  The general rule: a missing table is an operator problem, not something to
  hand to a skipper. Grep for `.sql` in `src/pages/` before assuming it is
  clean.
- Three current contracts have no going-home bonus set.
- `Sales.jsx` single-landing view still does not expose the days-at-sea input,
  though `updateDaysAtSea` already exists. Days at sea currently only arrive
  via logbook/quota uploads.

### Deliberately kept as test data
Andrew Smith's passport (expired 25-02-2026) and the Certificate of Insurance
(expired 31-03-2026) are **left expired on purpose**, to prove out how notices
and alerts look. Do not "fix" them.

Alerts should go through the **existing** Alerts page and `generate_alerts`
RPC rather than a new mechanism — it already exists for price alerts.

### Logs
Copy Aegir's fuel/oil log. Its structure: fuel, lube oil, dirty oil discharged,
oil waste — each entry litres, grade, date, location, supplier, recorded by.

**Fuel is recorded in three places and nothing reconciles them**: the Aegir
fuel log, the Square Up worksheet (litres taken, where) and the settlement
(`fuel_used`). Close that loop — fuel is 49.7% of Audacious's expenses. Derive
average consumption per day at sea per trip.

Engine logs: permission granted (Aug 2026) to correct clear clerical errors in
the imported data — decimal slips such as Charge Air Pressure 150/175 Bar
(normally ~2), Lube Oil Pressure 42 Bar (normally 4.6), Gearbox Oil Press 28
bar (normally 2.8), and a duplicated 25-05-2026 entry.

Going forward, keep a rolling average per parameter and flag an entry outside a
set percentage as a possible mis-key **or a genuine engine problem**. Aegir has
"parameter limits" and they do not catch any of the above, so limits must
actually block or flag on entry rather than decorate the form.

### Certificate reader
Ours already beats Aegir's on one point: a cert is filed against a **type**
chosen on entry, where Aegir keys off the typed name — so their matrix carries
several spellings of the same certificate and ours does not. Keep that.
The reader itself still needs firming up; Aegir stores the original photo/PDF
against each certificate, which is worth copying.

### Action list — agreed, not yet built (Aug 2026)

In the order agreed:

1. ~~**Crew record fields**~~ — **done and applied Aug 2026.**
   `supabase/crew_voyage_fields.sql`, plus `place_of_birth` added by the
   migration below because FAL 5 asks for place as well as date of birth.
2. ~~**Migrate the Aegir passport data**~~ — **done and applied Aug 2026.**
   `supabase/crew_aegir_migration.sql`. It covers all 17 matchable crew, not
   just the 10 aboard, since it was one trip to the same source.
   Read from Aegir → Team → Members (20 profiles) and Team → Crew List
   (the only place Aegir shows an embarked date, so only the 10 aboard have one).

   All six open questions were then resolved by David and applied in
   `supabase/crew_gundarovs_and_dedupe.sql`:
   - **Andrejs Gundarovs — added.** Contracted, aboard, Chief Engineer,
     embarked 13-07-2026. The vessel had **eleven** aboard and this app knew
     about ten. His nationality is **Russian**, from the passport itself —
     Aegir's "Lativan" is wrong twice over. The issuing country is still
     Aegir's word (Latvia) and is worth a glance.
   - **John Binggan / John Gabriel — confirmed one man, duplicate deleted.**
     No merge was needed: the "John Gabriel" row referenced nothing at all,
     while all the history (3 contracts, 81 landings, 24 closeouts, 2 bonuses,
     30 payments) was already on "John Binggan". He is still recorded under the
     short name; Aegir has him as "John Gabriel Binggan", which is what a
     passport and a crew list want.
   - **William Gatt — deleted.** Referenced nothing.
   - **Arnel Nobel — asked for, NOT deleted.** He carries 3 contracts, 95
     landing_crew, 29 month closeouts, 34 payments and 1 certificate, and those
     FKs are `ON DELETE RESTRICT`, so the delete would be refused anyway.
     Forcing it would destroy his settled share of real landings and part of
     already-reported months. He is `former` and archived, which is how this
     app retires a crewman while keeping the books. Erasing him properly is a
     separate, deliberate job.
   - **Ian Anderson and Bryan Reid — to be deleted in Aegir, by David.** They
     exist only there, so there is nothing in this database to remove.
   - **Status:** Aegir's shift list is stale, not ours — no status was changed
     except Gundarovs joining as aboard.

   **`crew` has three CASCADE children — `crew_certificates`, `rota_holidays`,
   `rota_trip_crew`.** Deleting any crewman silently takes their certificates
   with them. Check references before deleting crew, always.

   Also worth knowing: Aegir labels David Gatt and Barry Reid "Captain" on the
   member card but "Master" on its own crew list — the same free-text drift our
   `crew_ranks` lookup exists to prevent. Both were mapped to `master`.
   `crew_list_members` has no `place_of_birth`, so the generated crew list still
   cannot print it even though we now hold it.
3. **The five crew sections** — *shell and sections 1–2 built Aug 2026.*

   `CrewTabs.jsx` is the tab strip carrying the five sections; it appears on
   every crew page and **must be kept in step with the Crew group in
   `nav.js`** — same five destinations, same role gating.

   - **Section 1, Crew status** — `Crew.jsx`, rebuilt. Absorbed the old
     `CrewHub.jsx`, which is deleted; `/crew-hub` now redirects to `/crew`.
     Shows rank, nationality and passport state, counts who has no passport
     and whose has expired, and is still the only place status is changed.
   - **Section 2, Contracted crew** — `ContractedCrew.jsx`, new. The five
     tiles are now one ordered workflow (contract runs → boxes land → month
     closes → bonus falls due), each step carrying the figure that says
     whether it needs attention. Self-employed crew never appear.
   - **Section 3, Crew list** — `CrewList.jsx`, rebuilt. It is now *generated*
     from the status set in section 1 rather than asking you to tick everyone
     off again; the only thing it asks for is the voyage (date, port of
     departure, last port, next port). A "papers missing" panel names exactly
     who would print blank on the form, because a crew list is a border
     document. Adjusting who sailed is possible but framed as a one-off, and
     says so — status belongs to section 1.
     Output is a proper **IMO FAL Form 5** (landscape, numbered fields).
     `supabase/crew_list_fal5_fields.sql` adds the two fields that had nowhere
     to live: `crew_list_members.place_of_birth` and
     `vessel_details.flag_state` (editable on the Vessel page, deliberately
     not defaulted — a crew list should not guess its own flag).
   - **Section 4, Rota planner** — `Rota.jsx`, rebuilt for legibility. A trip
     now reads as one continuous band across the days it covers, rounded at
     the ends and squared at the joins, labelled with its crew count — it was
     a run of separate coloured squares you had to count by eye. Band edges
     compare **trip id**, not just "is there a trip", so two trips back to
     back do not merge into one. Crew are chips rather than a comma string
     that ran off the row, a holiday clash during a trip is called out by
     name, and the calendar has a caption (days at sea this month) and an
     "at sea now" strip showing which day of the trip you are on.
     Its categorical palette stays literal — the documented exception.
     **Bug fixed:** the holidays empty state tested *all* holidays but
     rendered only upcoming ones, so once every holiday was in the past the
     section showed neither a row nor a message. There are 4 on record, 2
     already past.

     **The rota unit is the LANDING, not the day** (Aug 2026,
     `supabase/rota_landings_and_teams.sql`). David works 2 landings on,
     2 landings off in two watches, and a man can swap in the *middle* of a
     trip to cover a holiday — which one crew list per trip cannot express:

         Crew A  david/david  2/0     Crew A  david/barry  3/3
         Crew B  barry/barry  2/2     Crew B  barry/david  4/4

     New tables: `rota_teams` + `rota_team_members` (fixed watches),
     `rota_trip_landings` (normally two per trip, not fixed at two, with an
     optional `landing_id` link to the real landing once it happens), and
     `rota_landing_crew` (where a swap actually lives). `rota_trips` gains
     `team_id`.

     **A landing's crew resolves in this order** — explicit per-landing
     override → the trip's watch → the trip-level `rota_trip_crew`. The last
     is how the 29 older trips were recorded, so they keep reading as before.
     An empty override means *inherit*, not "nobody aboard".

     **The tally cannot come from `landing_crew`.** That table is only
     populated for contracted agency crew because it drives the box bonus —
     across 164 landings, David, Barry and every self-employed rotation man
     have none. So the rota counts its own per-landing crew. If those two
     ever need to agree, that is a reconciliation job, not a join.

     The 29 existing trips were **not** backfilled with landings. We do not
     know how many each actually ran, and inventing two apiece would be
     making up history.

     **Back-to-back pairs** (`supabase/rota_back_to_back.sql`). Two men share
     a berth — when one is on, the other is off. `crew_a_id` is the Crew A
     man, `crew_b_id` the Crew B man, so both watches fill from the pairs in
     one action, and a swap on a landing is one tap because the man who
     covers David is always Barry.
     Seeded: Skipper `David Gatt ⇄ Barry Reid` and Cook
     `Jackson Gatt ⇄ Alfie Reid` are David's own pairings. Chief Engineer
     `David Henderson ⇄ Norman Wood` is **inferred** — the only two chief
     engineers, on opposite watches — and is worth confirming.
     **The six deckhands are deliberately unpaired**: Andrew Smith, Duncan
     Cruikshank, Paul Craib and Ronald Beagrie are aboard against Gregor
     Smith and James Napier ashore, which is four to two and does not pair
     one-to-one. The page lists them as "not yet paired".
   - **Section 5, Certificates** — kept, as agreed; it was already the
     strongest page. Two things changed.
     **The SQL nag is gone.** It told the skipper to "run the
     `crew_cert_categories.sql` backfill" — a filename and a database console
     put in front of a man on a boat. In its place is a categoriser that
     works in the app, grouped by cert **type** rather than by row: filing
     "Man Overboard Awareness" files all six at once, which is the whole
     point of filing against a type. Each type gets a suggested category from
     `suggestCategory()` in `CrewCerts.jsx`, and nothing is filed without the
     skipper confirming — a regex does not know his tickets better than he
     does. Viewers see a plain count instead.
     **`Other` added Aug 2026.** It was only ever the bucket the matrix swept
     unfiled certificates into, never a pickable category — so a ticket that
     genuinely fits none of the others could not be filed and the register
     nagged about it forever. `catOf()` still falls back to `Other` for
     anything unfiled, and the matrix guards against adding the column twice.
     **`Radio` added to `CERT_CATEGORIES`.** GMDSS and the Long Range
     Radiotelephone ticket had no bucket at all, which is why four
     certificates were stranded. 16 were uncategorised in total.
     Hint order matters: Engineer is tested before Deck, and Radio before
     everything, or "GMDSS General Certificate of **Competence**" drifts into
     an officer ticket.

   The one crew list saved before the migration is junk — no passports, no
   dates of birth, a nationality of "Engineer", and "Andrejs Gundravos"
   misspelled with a null `crew_id`. It is left exactly as saved, as a record
   of what the page used to produce. Anything generated now comes off the crew
   records.

   `CrewDetails.jsx` now edits rank (from `crew_ranks`), place of birth,
   embarked date and passport issued-at, so the migrated data is reachable in
   the app. `CrewList.jsx` defaults each man to the rank on his own record and
   takes its rank options from `crew_ranks`, so a voyage is no longer a list of
   Deckhands.

   **All five sections are built.** What remains against them is the
   certificate reader (firm it up; store the original photo/PDF as Aegir
   does), the itemised 42-point familiarisation list, and `place_of_birth`
   on the generated crew list document.
4. ~~**Days-at-sea repair**~~ — **done Aug 2026.** The single-landing view now
   carries a days-at-sea input under the KPIs. The handler is called
   `saveDays`, not `updateDaysAtSea`, and it rounds to the nearest quarter day
   exactly as the list views do, so a trip typed in either place lands on the
   same figure. The `£/day at sea` KPI used to read "add days below" in a view
   that has no table below it.
   **79 of Audacious's 118 landings still have no days at sea** (average on
   the 39 that do: 4.48 days), so `£/day` is unreliable until those are filled
   in. They only ever arrived via logbook/quota uploads before this.
5. ~~**Vessel certificates page.**~~ — **done Aug 2026.** `VesselCerts.jsx`
   at `/vessel-certs`, under Vessel in the sidebar (kept apart from crew
   certificates on purpose — they expire on different clocks and are chased
   from different places). `supabase/vessel_certificates.sql`.
   Same column shape and the same `certStatus` helper as `crew_certificates`,
   so "expired" means the same thing on both pages. Filed against a category
   chosen on entry, not guessed from the name — the point where this beats
   Aegir. Grouped by category, filterable, searchable, with a PDF export.

   **All 15 of Audacious's vessel certificates were migrated from Aegir.**
   Two of their oddities are recorded in `notes` rather than silently
   corrected: the ILO 188 certificate number is a UUID (a system id entered
   by mistake), and Certificate of Measurement is filed by Aegir under Safety
   when it is Statutory.

   **`file_path` is null for all of them.** `file_name` records what Aegir
   holds, but the images are still only in Aegir — storing the original
   photo/PDF needs a bucket with the same fleet isolation and is still on the
   list.

   **What it surfaced, which is the argument for the page existing:** five
   certificates are expired and only **one** is the test data recorded below.
   The wreck-removal cover shares that date so is likely the same renewal.
   The other three look like genuine lapses on safety gear — Gaseous Fire
   Suppression (20-07-2026), Inflatable Liferaft Service (24-07-2026),
   Liferaft Inspection (31-07-2026) — with the Portable Fire Extinguisher
   certificate due 26-08-2026. They sat in Aegir where nothing chased them.
6. **Logs** — fuel/oil log **done Aug 2026**; the fuel loop is *visible* but
   not yet closed. `FuelLog.jsx` at `/fuel-log`, under Vessel.
   `supabase/vessel_fuel_log.sql`. One table for all four kinds — they share
   every column that matters and differ only in direction: fuel and lube oil
   come aboard, dirty oil and waste go ashore.
   All 34 Audacious entries migrated from Aegir; each kind's total matches
   Aegir's own to the litre.

   **`su_settlements.fuel_used` is LITRES, not pounds.** Settle this before
   trusting anything fuel-related. It averages **74%** of `total_expenses`
   (range 54–92%) across the twelve settlements carrying it — impossible for
   a cost that is about half the expense bill — and `fuel_used ÷ days_at_sea`
   gives 3,945–7,233, a working day's burn. The "fuel is 49.7% of expenses"
   figure is a *cost* share from elsewhere and is a different quantity.

   **Average consumption: 5,846 L per day at sea** (12 settlements, Jan–Jul
   2026). The page flags any trip more than 25% off that.

   **The loop does not balance.** Over 08-01-2026 → 29-07-2026 the settlements
   say 1,093,158 L used; this log says 821,432 L bunkered — a gap of
   **−271,726 L**, about 46 days of burn. Timing explains some of it (fuel
   bunkered at the end of a period burns in the next, and tank levels are
   recorded nowhere) but not that much. Either bunkerings are missing from
   the Aegir log, or `fuel_used` is overstated, or fuel is being bought and
   burned outside both records. **Not resolvable from the data — it needs the
   paper.**

   **The third leg is still missing.** `su_worksheets` and
   `su_worksheet_lines` are both **empty**, so "litres taken, where" cannot be
   compared. That leg closes with the stage-2 worksheet rework.

   **Seven spellings of one fuel supplier** — "Smith & Sons", "Smith's",
   "Smith", "Smith & sons", "Smiths &sons", "Smith's & Sons",
   "John a smith &sons" — 12 entries and 559,938 L split across names that
   are almost certainly one firm, which makes "who do we buy most fuel from"
   unanswerable. Also "Maropa 150" vs "Meropa 150" on the lube side. The page
   groups and shows these rather than correcting the log silently; a supplier
   lookup is the real fix, same lesson as `crew_ranks`.

   Still to do: the itemised engine-parameter range checks (rolling average
   per parameter, flag outside a set percentage — Aegir's "parameter limits"
   do not catch the known decimal slips), and the **garbage log** — Aegir has
   one in Beta, so the MARPOL Garbage Record Book question is answered: it is
   being kept there, not on paper only.

Also agreed, not yet scheduled:

- **Garbage log.** A Garbage Record Book is a MARPOL requirement at Audacious's
  size. Confirm whether one is being kept elsewhere before assuming it is not.
- ~~**Vessel/crew alerts kept SEPARATE from market alerts.**~~ — **done Aug
  2026.** `supabase/compliance_alerts.sql` adds
  `generate_compliance_alerts(lead_days default 60)`, raising `crew_passport`,
  `crew_cert` and `vessel_cert` alerts into the existing `alerts` table.
  `Alerts.jsx` renders two streams: **Vessel & crew** first, then Market.
  "Clear price alerts" is scoped so it can never take an expiry with it.
  Idempotent — `(fleet_id, dedup_key)` is unique and the key carries the
  expiry date *and* the bucket, so a cert re-alerts when it crosses due →
  expired, and a renewed one only when its new expiry comes into range. The
  page calls it on every visit.
  First run raised 8, of which two were unknown: **Elizer Tano's ENG 1**
  (due 19-09-2026) and the Portable Fire Extinguisher certificate.
  **Nothing schedules it yet** — an expiry falling due while nobody opens the
  app goes unnoticed. A daily cron calling the function is the obvious next
  step. Engine-parameter and bonus-due alerts can join the same stream.
- **Familiarisation** — 42 items in Aegir. The list itself has not been seen
  yet; look at a crewman's page (read-only) before building. Permission given.
- **Dedicated pair-team fish sales analysis.** Sandy and Gavin tow one net
  between two boats: sum gross and boxes, never sum days at sea (both boats
  fished the same days, so the pair rate is pair gross ÷ the trip's days),
  never combine crew shares or quota. Blocked on the vessels schema.
- **Certificate reader** — firm it up; store the original photo/PDF against
  each certificate as Aegir does.

Explicitly NOT wanted: hours of rest, PLB tracking, crew schedule (the rota
planner covers it), inspection pack, AI audit, and Aegir's own landings page.

## Outstanding work

- **Vessels are not in the schema.** The pair-team and vessel-picker design
  cannot be built as a front-end change: `vessel_details.fleet_id` is a primary
  key and every feature table (landings, sales, quota, crew, rota) keys on
  `fleet_id`. Multi-vessel needs a `vessels` table, a `vessel_id` on each of
  those tables, backfill, and the fleet-isolation policies extended. That is a
  migration, not a restyle.
- Login hero is JPEG only. WebP would cut roughly a third off both files, but
  Windows has no WebP encoder and the machine this was built on had no Node, so
  the pair was produced with System.Drawing at q70. Re-encode from
  `IMG_1629.jpg` (3090×2075) with `cwebp` or `sharp` when there is a toolchain.
- `SquareUp.jsx` is the last page still on `.container` + `BackNav`. It was
  held back deliberately: the worksheet is being reworked in stage 2 alongside
  the settlements page, so restyling it first would be thrown away.
- Vessel photo inside the app comes from the signed-in fleet. Needs a
  `hero_path` column on `fleets` and a storage bucket with the same fleet
  isolation. Falls back to the solid plate when null.
- `parseTripXlsx` for mcatch Excel trip exports — reads 'trip summary' and
  'catch by zone' sheets, reconciles to 'Catch by species', apportions
  year-straddling trips by haul date. Dispatcher: AFPO has 'ITQ CATCHES' in A1,
  mcatch-xlsx has a 'trip summary' sheet. Trip uploader must accept .xlsx.
- A4 haddock manual-totals auto-allocation in Sales — skipper enters trip totals
  for mini/metro/chipper, app allocates across that trip's A4 rows by price rank,
  residual to metro, flag if the gap is over 2–3 boxes.
- P&J buyer coordinate fix — written and validated, but do not ship without the
  3 Feb Guiding Light PDF to test against. 147 blank-buyer rows across 11
  landings currently carry `reconcile_ok = false`.
- `Sales.jsx` single-landing view doesn't expose the days-at-sea input.
- Buyer league table — best-paying buyer per species/grade.

## Toolchain

**Node 24.19.0 is installed** (Aug 2026, winget `OpenJS.NodeJS.LTS`, user
scope). `npm run build` works and is the check to run before handing anything
over. If a shell has a stale PATH, prefix it:

    $env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;" + $env:Path

There is still **no poppler**, so `Read` cannot render a PDF page.

## Reading the boat certificates on this machine

Most of the boat certificates in `iCloudDrive\Audacious_\Boat Certs` are
**photographs**: a single-page PDF wrapping one JPEG, zero fonts, no text
layer. Word extraction gets nothing from them and hangs on the PDF-reflow
dialog — don't bother. What works is pulling the JPEG straight out of the PDF
in PowerShell (scan for `FF D8 FF` … `FF D9`, write those bytes to `.jpg`) and
reading that as an image.

Check first with a byte scan for `/Font` and `/DCTDecode`: no fonts plus one
`DCTDecode` means it is a photo and the JPEG trick applies. `L.S.A Certs.pdf`
(98 pages) and `UKFVC.pdf` (66) are **bundles** of many certificates in one
file, which the one-file-per-certificate model in `crew_certificates` and
`vessel_certificates` does not fit. Decide that before building cert upload.

## Working style

- Validate against real files before shipping. Nothing goes live on a guess.
- Prefer whole-file replacements over patches.
- Run an esbuild compile check before handing anything over.
- Keep explanations short. Working code first.
