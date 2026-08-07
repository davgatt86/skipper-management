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

None of this is buildable until the schema carries vessels. See Outstanding work.

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
- Money renders as `GBP192.30` — the currency setting is concatenated raw
  instead of a `£` symbol (CrewHub).
- Every crewman shows "no passport on file"; rank defaults to Deckhand on every
  voyage because it is not stored on the crewman.
- The certificates page tells the user to "run the `crew_cert_categories.sql`
  backfill" — SQL surfaced to a skipper.
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

1. **Crew record fields** — rank, nationality, passport number + expiry,
   embarked date. Everything else sits on this.
2. **Migrate the Aegir passport data** for the 10 crew aboard.
3. **The five crew sections** (see above).
4. **Days-at-sea repair** — small: `updateDaysAtSea` already exists in
   `Sales.jsx`, only the input is missing from the single-landing view.
5. **Vessel certificates page.**
6. **Logs** — fuel/oil log, plus the fuel loop across three systems.

Also agreed, not yet scheduled:

- **Garbage log.** A Garbage Record Book is a MARPOL requirement at Audacious's
  size. Confirm whether one is being kept elsewhere before assuming it is not.
- **Vessel/crew alerts kept SEPARATE from market alerts.** Certificates,
  passports, bonuses due and out-of-range engine parameters must not land in
  the same feed as price alerts and get lost. Same Alerts page, separate
  stream — the price alerts are frequent and would bury a passport expiry.
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

## Working style

- Validate against real files before shipping. Nothing goes live on a guess.
- Prefer whole-file replacements over patches.
- Run an esbuild compile check before handing anything over.
- Keep explanations short. Working code first.
