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

**One vessel per fleet is baked into `vessel_details`**, whose primary key is
`fleet_id`, and no table carries a `vessel_id`.

But **a pair team is ONE fleet, not two** — `BOY JOHN INS110 + ROSEBLOOM
INS353` is a single fleet whose two boats are told apart by
`sales_landings.vessel`. Sales therefore needed no schema change at all; see
Pair teams. What still needs a `vessels` table is crew, quota and rota, which
have no vessel column of any kind.

## Live modules

Dashboard · Fish Sales · Sales Insights · Daily Prices · Where to Land /
Estimator · Square Up · Crew · Contracts · Landings · Month Closeout ·
One-Off Bonuses (skipper only) · Rota · Quota (position + forecast) ·
Price vs Fleet · Alerts · Forecast · Crew List

## Parsers

`parse-core.cjs` (this repo, Netlify Functions) and `parse-core.js` (in
`davgatt86/fish-sales-tracker`) are **identical files**. Any fix must be applied
to both, and the version bumped. Now **1.3.2**.

**Checked Aug 2026 by diffing the two files: they were genuinely identical, at
1.2.1.** This document's claim of 1.3.0 was simply wrong — the identical-files
rule was being honoured. Both are now 1.3.2 with the same `BUYER_CANON` and
`VESSEL_CANON` changes, verified line for line and by running the functions on
each copy.

The `fish-sales-tracker` copy is **not in this repo**, so it has to be updated
by hand each time. Diff before assuming, rather than trusting a version note.

**Buyer names are canonicalised in `BUYER_CANON` / `canonBuyer()`**, which the
Don Fishing parser applies to every row. That is the only durable fix for the
name-variant problem, because buyer names arrive from the note rather than a
pick-list. Note `canonBuyer` is **not** applied by the P&J (JSD) or Shetland
parsers — they use their own `cleanBuyer`/`CANON` — so a variant appearing on
those notes needs handling separately.

**Vessel labels are canonicalised in `VESSEL_CANON` / `canonVessel()`** (1.3.2).
Applied in `parseExtracted`, the single point every parser's result passes
through — **seven** places set `meta.vessel` and several bypass `detectVessel`,
so patching one would have missed most of them.
The convention is `NAME REG`. Notes printing only the name are mapped up, so
`FAITHLIE` → `FAITHLIE FR220` and `AUDACIOUS` → `AUDACIOUS BF83`.
**Changing this map means backfilling `sales_landings.vessel` in the same
breath** — otherwise the parser emits the new label while history holds the
old one, which splits the boat on the next note. That was done for FAITHLIE and
GUIDING LIGHT in Aug 2026; every vessel label now carries its reg.

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

## Market layout (Aug 2026)

`MarketLayout.jsx` at `/market-layout`, under Market. Upload the wheelhouse day
tally and get back how many tiers to ask Peterhead for and what goes where.
`src/lib/market/` — `parseDayTally.js`, `layoutRules.js`, `planLayout.js`.

A **tier** is two rows back to back with a walkway between: **21 footprints on
the top row, 26 on the bottom, 47 flat.** Tiers are back to back with a walkway
every second tier. David's rule of thumb for the phone call is `total ÷ 94`
rounded up, **plus one more** if the remainder is over .7 or it lands exactly
whole. Kept in `tiersByRuleOfThumb()` because it is what gets asked for — the
allocator works out the real figure separately and the page shows both. It is a
good rule: on Trip 63 it asked 16 against a real 17.

**Four clocks** — 1 Cod · 2 Haddock & Whiting · 3 Rough · 4 Flats. Fish from one
clock stays together so its buyers walk it in one go. **Only the flats may be
split across the two rows**; every other species stays in one band.

The allocation is **Peterhead's own, off the supply catalogue dated 13-08-2026**
(one report per clock, FAO codes), not an assumption:

    Cod       COD
    Had/Whg   HAD · WHG
    Rough     ANF monks · CAT · LIN ling · POK saithe/black · POL lythe
    Flats     HAL · HKE hake · LEM lemons · LEZ megrim · PLE · TUR · WIT witch

Squid, skate, brill and tusk are absent from that catalogue because they were
not landed that day, not because they have no clock — they are placed on the
obvious reading and worth confirming when one is next landed.

### The rules are SETTINGS, not law

`/market-rules` (`MarketSettings.jsx`, `supabase/market_layout_settings.sql`),
skipper-only to change and readable by the fleet. The market moves species
between clocks; that used to be a code change and a deploy for something the
skipper knows the day it happens.

Three things are editable: the clocks (label, order, whether one may split
rows), which species goes on which, and the height grid.

**The stored document holds only what DIFFERS from the shipped defaults**, and
`resolveRules()` merges it over them. So a fleet that moves one species still
picks up later corrections to everything else, instead of freezing a copy of
today's defaults the first time it saves. A fleet with no row behaves exactly
as before — verified by test, not assumed.

**Heights are a species × size-band grid**, keyed on the tally's own code digit
(`Good Seed (1d)` is band 1, `Sma (4a)` is 4), with `*` as the species default.
That grid reproduces every one of the old name-matching rules exactly and is
something a skipper can read. A grade carrying **no** code falls to `*` where
the old regex matched on the name — no grade on a real tally does, but that is
the behaviour change to know about.

**An unfiled species is laid out anyway, on Rough, and NAMED** in the plan's
warnings with a link to the rules page. Falling to "whichever clock is last" is
not a rule; quietly sending a fish to the wrong auction is the failure worth
guarding against.

**Both rows fill in proportion.** A tier hands you 21 and 26 at the same time —
you cannot take one without the other — so the tier count is set by whichever
row runs out first, and packing the bottom tight while the top sits half empty
simply costs tiers. Species go to whichever row is furthest behind its share.

**Day tags run high number to low**, and a stack may span two days rather than
stand part-full. That is why `buildStacks` fills each stack right up before
starting the next — which also makes a grade's footprint count exactly
`ceil(boxes / height)`, the fact the drop solver is built on.

**Grades sort by the tally's own row order (`seq`), never by name.** Sorting
alphabetically put Sprag above Med and Cod above Large, which is not how anyone
reads a market. Confirmed by David: *"sheet follows my grades not alphabetical."*

### Heights are a ceiling, and the spare space goes to the dear fish

`maxHeight()` holds the guideline — M Metro and small black 4 high, Metro and
Sel 3, roes and the flats and the big cod flat, most things 2. Confirmed
including three edges that were not obvious: **Sprag is 1 high** (it sits inside
"medium cod to XL"), **BLACK XX Sma is 4** like the rest of the small black, and
**the roes lie flat**.

But the rule is *"can not go higher, but can go lower"* — high value species and
grades are always favoured low so they can be seen and handled. So `planLayout`
runs **twice**: once at ceiling heights, which fixes the tier count, then
`solveDrops()` spends whatever footprints are left inside those tiers on laying
the valuable grades lower, most valuable first, one level at a time. **The tier
count is never allowed to rise** — and because a total budget can still push one
row over while the other has room, the second pass is verified by re-running the
layout and backing the budget off until it holds, rather than trusting the
arithmetic.

**The value order is MEASURED, not guessed** — from Audacious's own sales
notes — and it is **PER GRADE, NOT PER SPECIES**. `GRADE_VALUE` in
`layoutRules.js` is keyed on the tally's own code digit, which is the market's
size band: `gradeBand('Good Seed (1d)')` is 1, `'Sma (4a)'` is 4.

A species average is not merely less precise here, it is **wrong**, because the
spread inside a species is far wider than the gap between species:

    haddock  1 → £4.91   2 → £4.07   3 → £3.20   4 → £1.65
    black    1 → £2.27   2 → £2.53   3 → £2.16   4 → £1.79

On the averages (haddock £2.02 vs black £2.05) black beats every haddock there
is. In fact the big haddock beats every grade of black by a street and only the
M Metro falls below it. **That was shipped wrong first and David caught it on
the floor** — "bigger haddock avg higher prices than black" — and the data
agrees with him.

The A-grades off the sales note are used as the price for each band because
they are the same ladder measured on the same fish. Note this is **not** the
same split as the A4 haddock sub-grades in the estimator, where mini, chipper
and metro all come off one A4 line: the market grades the box, the note grades
the fish. Only grades that stack matter — anything already flat never competes
for the spare room — so the flats and the big round fish carry a species figure
and nothing finer.

On Trip 63 this takes the spare from **41 footprints to 0**, still 17 tiers,
laying Cod B Baby, **Haddock Seed**, Whiting Med and Black Large flat. Under
the species averages the same room went to the black. The page names every
grade it dropped: this is a decision the skipper should see, not one made
silently under him.

### The chalk sheet — `MarketSheet.jsx`, `src/lib/market/sheet.js`

The screen view is a picture of the market; this is the working document, and
it goes on the floor in chalk. It prints A4 portrait, **ten tiers to a page**.

- **Tiers are COLUMNS**, read top to bottom, top row at the top of the column
  and bottom row at the bottom with the walkway between — a plan view of the
  floor rather than a diagram of it. Tier number in a black tab at the head.
- **Runs, not boxes.** Consecutive footprints of the same grade off the same
  day tag are ONE chalked block, written once. 1,424 boxes become 297 blocks.
- Three boundaries, three weights: heavy black rule = new species, medium =
  new grade, hairline in the tag's own colour = new day tag **inside** a grade.
- **Six hues × two shades.** Species carries the hue and keeps it across every
  tier so the eye can follow it down the market; grades inside it alternate the
  shade. Repeats elsewhere on the floor are fine — touching is not.

Everything is sized in **millimetres, not pixels**, because the printed page is
the only output that matters. `UNIT` (mm per footprint) is set by the page, not
by taste: 47 footprints plus the tier head, walkway, page head and legend must
come in under A4's 285mm.

**The screen view IS the sheet.** `MarketLayout.jsx` embeds `SheetBody` rather
than drawing its own picture — it used to render a horizontal strip per tier,
which is neither the shape of the floor nor something you can follow a species
down. One renderer, nothing to drift.

Embedding it created one trap: the print CSS hides `#root` so the sidebar and
cards do not come out with the sheet, and the embedded sheet is **inside**
`#root`, so printing in place gives a blank page. The embedded Print button
opens the full-screen copy and prints from there, which is the better order
anyway, and `.msheet.is-embedded` is explicitly hidden in print as well.

**`scripts/sheet-preview.mjs` is how the printed page gets checked.** It
esbuild-bundles the real component and server-renders it against a real tally,
so what is inspected is what the app produces rather than a copy that can
drift. The page itself is behind a login and a file picker. `--embedded` checks
the in-app shape the same way.

**`<style>` must use `dangerouslySetInnerHTML`, not children.** React escapes
text children, so `body > #root` renders as `body &gt; #root` and the browser
drops the whole rule — silently taking out the one that hides the app when
printing. Not a failure anyone would notice until a sheet came off the printer
with a sidebar down the side of it.

Four more things that verification caught, none visible by reading the code:

- **Greedy graph colouring made the sheet one colour.** Taking the lowest free
  hue is textbook and useless: only a handful of species ever touch, so eleven
  of sixteen came out the same blue. It now spreads across the palette first
  and only shifts on a conflict. 6 distinct fills → 12.
- **Marking every day change fired on 287 of 297 blocks**, burying the species
  rule under it. A rule that is almost always true carries no information. Day
  changes are now marked only *within* a grade, and quietly.
- **Half the blocks are a single footprint** (5.2mm tall) and 29 clipped their
  text. Those now render on one line — species, code, tag, count.
- **A4 overflow of 1mm on the last page**, because that page alone carries the
  "laid lower" sentence. Measured, not eyeballed.

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

`FAITHFUL II` — **deleted Aug 2026 as a failed parse, not a boat.** One
landing, 03-03-2026, £24,755 over 41 rows, `reconcile_ok = false`. Both real
boats already had a clean reconciled landing that same day at that same
market, and the name appears nowhere else. Its rows went with it on CASCADE;
`sales_rows` is the only table referencing `sales_landings`.
The pair now reads Faithlie 37 / Guiding Light 36.

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
- ~~`Sales.jsx` single-landing view does not expose the days-at-sea input~~ —
  fixed Aug 2026 (action list item 4). The handler is `saveDays`, not
  `updateDaysAtSea`. **79 of 118 landings still have none**, so `£/day` stays
  unreliable until they are filled in.

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

     **Those 29 trips are now 4 — David deleted them deliberately** (Aug 2026).
     Noticed during the vessels migration; the 4 survivors are all HANSTHOLM,
     every deleted one was Audacious, which is what a delete scoped by RLS in
     the app looks like.

     It could only be established by asking, because the rota had **no audit
     trail at all**. That is now fixed — `supabase/rota_audit_triggers.sql`
     covers all eight rota tables. Note `audit_trigger()` needs an `id`
     column, and `rota_trip_crew` / `rota_team_members` /
     `rota_landing_crew` have none, so they use `audit_trigger_link()` which
     anchors `record_id` on the parent. Verified to capture CASCADE deletes —
     the exact case that lost the 60 crew assignments.

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

   **Storing the original photo IS built** — on this page and on the crew
   certificate page, both uploading to a private bucket scoped by
   `(storage.foldername(name))[1] = current_fleet_id()`. The earlier note that
   it was "still on the list" was stale. What remains is data entry: 12 of 15
   vessel certificates and 108 of 112 crew certificates are still only in Aegir.

   **Photos are downscaled before upload** (`src/lib/downscale.js`). A phone
   snap of a certificate is 3–4 MB at 4032×3024; 1600px on the long edge reads
   just as well at about a tenth of the size — measured at 3,216 KB → 404 KB,
   an 87% saving. That matters twice: 127 certificates at 4 MB would be ~450 MB
   against a 1 GB allowance that also holds the settlement documents, and the
   upload happens on a boat. PDFs pass through untouched — they are already
   small, may hold several pages, and re-encoding would lose the text layer.
   The same shrunk file is sent to the reader, so the parse call is smaller too.
   Any failure returns the ORIGINAL: a large upload beats a lost certificate.

   **Abandoned uploads leave an orphan.** Both pages upload the file BEFORE the
   row is saved, deliberately, so a photo survives a failed read — and Cancel
   cleans up after itself. Closing the page instead does not: one 4.8 MB
   orphan sits in `crew-certs` from June. Worth a sweep if it ever adds up.

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

   **The loop was out by −271,726 L, and missing bunkerings were most of it.**
   The first reading (08-01 → 29-07-2026) had 1,093,158 L used against
   821,432 L bunkered. David then added the outstanding bunkerings in Aegir;
   re-reading them Aug 2026 brought the log to 1,016,806 L over the same
   window and the gap to **−76,352 L** — roughly 13 days of burn rather than
   46. So about **72% of the discrepancy was simply five unrecorded
   bunkerings.**

   What is left is the size timing alone would explain: fuel bunkered before
   08-01 burning in January, and the 05-08 Haugesund lift burning in August.
   Tank levels are still recorded nowhere, so it cannot be closed exactly —
   but it no longer looks like anything is wrong.

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
  **Scheduling is done — `supabase/alert_cron.sql` is the record of it.**
  That file supersedes the `cron.schedule` buried in
  `fuel_suppliers_and_vessel_cert_upload.sql`, which had drifted: the live job
  had gained `generate_bonus_alerts` and the migration never learned about it.

      compliance-alerts-daily   0 6 * * *     compliance(60) + bonus(30)
                                              + activity()
      market-alerts             0 */3 * * *   generate_alerts()

  **`generate_activity_alerts()`** (`supabase/activity_alerts.sql`, Aug 2026)
  catches the other failure — a book that has quietly stopped being written in,
  which nothing else notices because nothing expires. Engine log after 2 days,
  bunkering / garbage / crew list after 10, and a maintenance task falling due
  within 2 days. Thresholds are per fleet in `alert_settings.data`.

  **A fleet is only alerted about a book it has ALREADY used once.** Eleven of
  the twelve have never made an engine-log or garbage entry, and nagging them
  daily about a book they never opened is how a reader learns to filter the
  sender. "You have not started the garbage record book" is a conversation, not
  a recurring alert — and Audacious has never made one, which is worth knowing.

  **One alert per episode, not one per day.** The dedup key carries the date of
  the LAST ENTRY, so a stale book raises one alert and stays quiet until someone
  writes in it and lets it go stale again. The repetition comes from the digest
  re-listing unread alerts, not from the table filling up.

  Maintenance uses both clocks: days-based alerts 2 days before the due date,
  hours-based at 95% of the interval — "48 hours before due" is meaningless for
  an hours interval without knowing the daily burn, and guessing would be worse.

  Market alerts had **never** been scheduled — they fired only when someone
  opened the page, which is the same hole the compliance cron was built to
  close. Every three hours, not daily, because a board arriving at midday is
  worth knowing that afternoon.

  **Why these work from cron when a normal function would not:** all three are
  SECURITY DEFINER and take `fleet_id` from each source row rather than from
  `current_fleet_id()`. Cron has no `auth.uid()`, so anything scoped the usual
  way would quietly do nothing — and "no rows inserted" looks exactly like
  "nothing was due". Verified across fleets: market alerts span 7.

  **Zero is the right answer for eleven of the twelve fleets.** Only Audacious
  carries any expiry data at all (18 passports, 86 crew certs, 14 vessel certs,
  16 contracts with a bonus). Check the source data before treating a quiet
  fleet as a scoping bug.
  `cron.job_run_details` is the thing to read — a job that exists but never
  fires is indistinguishable from nothing being due.

  **Still missing: generating an alert is not telling anyone.** The rows land
  in `alerts` and sit there until somebody opens the app. Closing that needs
  email or push and is not built.
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

## Landings vs settlements

`Reconcile.jsx` at `/reconcile`, under Settlement. Compares what the sales
notes say the fish made against what the office actually paid — two records
that had never been put side by side.

**Compare against the `Fish Sales` income line, NEVER `total_income`.** Some
settlements carry income that never came from a sales note — **Towage of
£73,347 on 12-06 and £24,448 on 26-06**. Against `total_income` the boat looks
as though it earned fish it never landed; 26-06 read £24,448 out and is
exactly nil once towage is set aside. `su_settlement_lines` has the split.

**Danish sales ARE settled by Don Fishing.** Excluding Hanstholm landings was
tried on the assumption that fiskeauktion settles them separately; it made the
reconciliation dramatically worse. Don Fishing is the selling agent there too.

**The settlement does not say which landings it covers** — one `Fish Sales`
line, no breakdown — and confirmed Aug 2026 that the office does not supply
one. So the boundary has to be inferred, and a fixed date window was the wrong
way to do it: a trip landed the day after a settling date can still be on that
sheet (27-05 belongs to the 26-05 settlement), but so can a trip landed three
days before the next one.

**`solveSettlementRuns()` in `salesAgg.js` infers the boundaries instead.**
Landing days are sorted and cut into consecutive runs, one per settlement, by
dynamic programming over the cut positions — the split chosen is the one
minimising combined relative value **and** weight error across the whole year,
not settlement by settlement. Two things it must keep doing:

- **Leading and trailing landings may go unassigned.** Landings settled on a
  sheet we do not hold are not ours to place. An earlier version forced every
  landing into some settlement and dragged two December landings into the
  January sheet, throwing the first four settlements out by up to £191,038.
- **A run must be plausible in time**: its last landing within 3 days after and
  45 days before the settling date. Without that the solver reaches back months
  to make the arithmetic fit.

Verified against the real 36 landing days / 12 settlements: **9 of 12 confirm
on both value and weight**, worst difference £3,359 on six-figure sheets. The
fixed two-day window managed 4. `test-solver.mjs` in the repo root holds that
data and is the check to re-run if the solver is touched.

**Weight is the stronger signal, and `matchConfidence()` reports both.** Six
settlements match to the exact kilo. 26-06 matches value to the penny
(£327,886.69) but is 18,348 kg over — since the value is exact the landings
must be right, so that is a weight-basis difference on the settlement, not a
matching error. A row that agrees on one and not the other is information, so
never collapse the two into a single pass/fail.

Both of the corrections that made this work came from David, not from the
data: the towage line and the 26-05/27-05 pairing. The arithmetic could show
something was wrong but not what.

## The `officer` role (Aug 2026) — supersedes `engineer`

`supabase/officer_role.sql`. **Re-run that file, not `engineer_role.sql`, after
adding any table.** Same allow-list machinery, wider list.

An officer is anyone aboard who keeps records — engineer, mate. He gets the
logs, the maintenance record and **the crew paperwork**: adding a man, filing
his tickets, producing and saving a crew list. He is denied everything to do
with money — sales, settlements, quota, contracts, payments, bonuses, and the
audit log. That is the whole reason the role exists rather than handing out a
skipper login.

    writes   engine_logs · vessel_fuel_log · garbage_log · fuel_suppliers
             maintenance_tasks · maintenance_events
             crew · crew_certificates · crew_lists · crew_list_members
    reads    vessel_certificates · vessel_details · fleets · settings · app_users
    storage  crew-certs (read/write) · vessel-certs (read) — everything else shut
    denied   61 tables

`is_officer()` accepts the legacy `'engineer'` value, so an unmigrated login
keeps working; the two live logins were migrated. `is_engineer()` is dropped.

**A trap worth remembering.** The deny loop only touches tables OUTSIDE the
allow-list, so it cannot clear a denial from a table that has just JOINED it.
`crew_certificates`, `crew_lists` and `crew_list_members` kept their old
`engineer_no_access` policy and officers would have been shut out of crew certs
and crew lists with everything else looking right. It was caught only because
the file drops the old helper **without CASCADE** — Postgres refused and named
the three offending policies. Keep that DROP plain.

Verified by probe: sales, settlements, quota, payments, contracts and audit_log
all read **0**; crew 19, crew certs 112, crew lists 1, vessel certs 15 all read;
add crew, save crew list, add list member and delete crew all **succeed**;
vessel-certificate update affects **0 rows** and a sales insert is blocked.

`nav.js` gained **array access** (`['all', 'officer']`) because Crew Status
belongs to two audiences that do not nest. `CrewTabs.jsx` no longer keeps its
own copy of the sections and the role rules — it derives both from `NAV`, since
the copy had already drifted.

### Vessel certificate categories

"Safety" was a bundle of seven — liferafts, lifejackets, fire suppression,
extinguishers, medical stores and a Certificate of Measurement — which is no
more use than no grouping at all. Split into the categories the trade uses:
**Statutory · LSA · FFA · Radio · Pollution · Medical · Machinery · Insurance ·
Equipment · Safety (legacy) · Other**. The 15 Audacious certificates were
refiled: Statutory 6, LSA 3, FFA 2, Insurance 2, Medical 1, Pollution 1.
Certificate of Measurement moved to Statutory — Aegir's misfiling, previously
only noted in `notes`; TBT-Free Antifouling moved to Pollution (AFS Convention).

### The digest email

`netlify/functions/alert-digest.js`, scheduled in `netlify.toml` at 07:00 UTC —
an hour after the 06:00 generation cron, so it reports that morning's alerts.

**Generating an alert was never the same as telling anyone**, and the rows sat
in `alerts` until somebody opened the app. This closes that.

- **Expiries only** — passports, crew tickets, vessel certificates, bonuses due.
  Market price alerts are deliberately excluded: they run every three hours and
  would turn a useful note into noise, and a digest people stop reading is worse
  than no digest.
- **Nothing is sent when there is nothing to say.** A daily "all clear" trains
  the reader to ignore the sender.
- Alerts already read or dismissed are skipped, so acting on one stops it.
- **Sent to skipper, officer and office.** An expired liferaft certificate is
  the skipper's to renew, but the engine log going quiet is the engineer's to
  fix — skipper-only would mean relaying it to the man who can act. `crew` is
  excluded: a deckhand can do nothing about any of it.

**Sent via CloudMailin over SMTP** — the same vendor already handling inbound
sales notes, so there is one account rather than two. `nodemailer`, pooled to
one connection for the whole run and closed at the end, or the function holds
the session open until the runtime kills it.

Port 587 is STARTTLS, not implicit TLS: `secure: false` with `requireTLS: true`
is the correct pairing, and the second half is what stops the credentials going
in the clear. nodemailer is in `external_node_modules` because it resolves parts
of itself with dynamic `require()` — esbuild bundles it without complaint and
then it fails at run time.

Env, set in Netlify and **never in the repo**:

    CLOUDMAILIN_SMTP_USERNAME
    CLOUDMAILIN_SMTP_PASSWORD
    DIGEST_FROM                 must be on a verified domain
    SMTP_HOST / SMTP_PORT       optional, default smtp.cloudmta.net:587

Missing credentials are reported as "skipped", not an error, so the schedule
runs harmlessly until they are set.

**A CloudMailin account starts in TEST MODE: it accepts the message and
delivers nothing.** The function log will still say "sent". Verify a domain
before believing a green run — and `netlify.app` cannot be verified, so this
needs a domain David owns.

## Roles, and where the boundary actually is

**`nav.js` is presentation. RLS is the boundary.** The Supabase anon key ships
inside the JS bundle by design, so anyone holding a valid login can open a
console and query any table their policies allow — the UI is not in the path.
Hiding a menu entry hides nothing.

That mattered when the `engineer` role was added (Aug 2026,
`supabase/engineer_role.sql`), because an audit found the money tables had **no
role-aware policy at all**:

    sales_landings / sales_rows            3 policies, 0 role-aware
    su_settlements / su_settlement_lines   1 policy,   0 role-aware
    quota_lines                            2 policies, 0 role-aware

They were scoped by fleet and nothing else. That was survivable while all 13
users were skippers; it stops being survivable the moment a crewman gets a
login. `contracts` and `payments` were always done properly — those two are the
pattern to copy.

**The deny is an allow-list, generated by a loop** over every table in `public`,
skipping ten named ones. A hand-written deny-list would silently leak every
table added afterwards, which is the exact shape of the bug it fixes. **Re-run
`engineer_role.sql` after adding any table** — it is idempotent.

    writes   engine_logs · vessel_fuel_log · garbage_log · fuel_suppliers
    reads    vessel_certificates · vessel_details · fleets · settings
             app_users · crew          (own row only, via existing policies)
    denied   everything else — 64 tables — plus all of storage.objects

`not is_engineer()` is the shape used throughout, and it returns TRUE for a null
role rather than null, so **no existing role's access changed**.

Two things to know:
- **`crew_ranks` has RLS off entirely**, so no policy can cover it. It is a
  global lookup of rank codes and is readable by anyone signed in. Deliberate.
- **`vessel_details` was skipper-only for reading**, and `EngineLogs.jsx` reads
  it — an engineer would have got a blank page. The new read is scoped to
  engineers rather than opened to all fleet members, so viewers are unaffected.

**Verified by probe, not by inspection.** A throwaway engineer login was created
inside a transaction, queried, and the transaction aborted: sales, sales_rows,
settlements, quota and payments all returned **0 rows**; `app_users` returned
**1** (his own); engine log insert **1 row**; fuel log update **40 rows**;
certificate update **0 rows**; sales delete **0 rows**; sales insert blocked.
Note a `garbage_log` insert failing on a CHECK constraint is a *pass* — RLS
denial reads "violates row-level security policy", so reaching the constraint
proves the policy allowed it.

Beware two traps if re-testing: an UPDATE matching zero rows **succeeds
silently**, so assert on `ROW_COUNT` and never on "did it throw"; and
`sales_landings.boxes/weight_kg/value` are written from the row sum, so
comparing a landing to its own `sales_rows` always agrees and proves nothing.

`accessForPath()` in `nav.js` derives each route's requirement from the menu, so
adding a page to the menu guards its route in the same edit. A route the menu
does not list returns null, which `ProtectedRoute` treats as "allow, unless
engineer" — unlisted pages fail towards the tighter role. `test-roles.mjs`
covers all of this, including the `/vessel` vs `/vessel-certs` prefix trap.

Creating one: Users page → role **Engineer**. `CREATABLE_ROLES` in
`netlify/functions/manage-users.js` gates it server-side, so the picker alone is
not enough. **`check_crew_id_role` on `app_users` allows a `crew_id` ONLY for
role `crew`, and requires one there** — so an engineer must not be linked to a
crew record, and a Crew login cannot exist without one. Both sides are now
validated in words before the insert, because the raw constraint name was
reaching the skipper.

Live engineer logins: **Norman Wood** and **David Henderson**, Audacious.

### The engineer's own pages (Aug 2026)

Built after watching a real engineer login on a phone. Two things were wrong at
once: he landed on **"Not available on your login"**, and the chart picker did
not fit the screen.

**The wall was `ProtectedRoute` guarding `/`.** `accessForPath('/')` is `all`,
and `canSee('all', engineer)` is deliberately false, so the guard fired before
`RoleHome` could redirect him. `/` is now never blocked there — it is the front
door, and `RoleHome` is what routes each role. The dashboard behind it stays
skipper-only.

- **`/engine-room`** (`EngineerHome.jsx`) is where an engineer now lands. Days
  since each of the three books was written in, current running hours, what
  maintenance is falling due, and vessel certificates read-only. Reads through
  the offline cache like his other pages. `STALE_DAYS` differs per book on
  purpose — the engine log is a daily habit, the garbage book only gets an
  entry when something goes ashore, so a fortnight there is normal.
- **`/maintenance`** (`Maintenance.jsx`, `supabase/maintenance.sql`) is the
  record: `maintenance_tasks` (what this boat services) and
  `maintenance_events` (each time one was done). **Editable per fleet and
  nothing is seeded** — every engine room differs and a fixed list would be
  wrong on the second boat — but an empty page offers `SUGGESTED_TASKS` so the
  first run is one tap rather than twenty.

**Two clocks, and either can ring first.** A task carries an hours interval, a
days interval, both or neither, and the status is the worse of the two — which
is how a service schedule actually works. Neither means *tracked, not chased*,
which is the right default for something a man wants to watch without being
nagged. `src/lib/maintenance.js`, covered by `test-engineer.mjs`.

**A trap that test caught:** `Number(null)` is `0` and `Number.isFinite(0)` is
true, so an unknown running-hours reading was reporting **"0 hours since"** —
which an engineer reads as *just done*. Blank must stay blank the whole way
through.

### Charts: one axis was never going to work

`splitCharts()` in `src/lib/engineCharts.js`. Main Engine 1 carries RPM near
750, exhausts near 400, pressures between 2 and 6 and running hours in the tens
of thousands. On a shared axis the pressures are a flat line on the floor —
worse than no chart, because it looks like information. The old panel knew, and
put a tip underneath telling the reader to avoid it, which is asking a man to
do the software's job.

It now splits a selection by **unit first** — bar and °C never share an axis
whatever the numbers say — then **by magnitude within a unit**, because a 22°C
intake and a 400°C exhaust are both °C and still cannot share. `SPREAD_LIMIT`
is 10, set from those two real cases: 18x apart splits, a 90°C jacket against
the same exhaust is 4.4x and stays. Magnitude is the **median**, so one
mis-keyed 175 bar cannot drag a series onto its own chart.

Verified in a mobile viewport: plotting all 28 Main Engine parameters gives 5
charts, 28 checkboxes with **none overlapping its label**, and no horizontal
overflow at 375px. The picker was an auto-fit grid that put the box on top of
its own text and ran a second column off the side of the display.

### The `viewer` role leaked across fleets — fixed Aug 2026

Found by probing the *other* roles the same way, before handing out logins.
`supabase/viewer_role_fixes.sql`. Nothing was exploited — all users were
skippers — but "Viewer" is in the Users picker, so it would have opened the
moment one was created.

The cause is the shape of every `viewer_read` policy:

    using (exists (select 1 from app_users u
                    where u.id = auth.uid() and u.role = 'viewer'))

That grants the row to any viewer **in any fleet**. On most tables the
restrictive `fleet_isolation` policy beside it ANDs the boundary back on. On
two tables there was no such policy:

| | a viewer could see | should be |
|---|---|---|
| `audit_log` | **715 rows across 2 fleets** — the whole table | own fleet, and skipper-only |
| `fleets` | **all 13** | own fleet |

`audit_log` carries old and new values of changed records, so that was other
tenants' data. Both `viewer_read` policies were dropped — `audit_read` and
`fleets_member_read` already cover the intended reader — and `audit_log` gained
the `fleet_isolation` policy it never had.

Third, subtler: **`payments_read` deliberately withholds `one_off` payments
from the office and from the crewman himself**, and `viewer_read` bypassed that
carve-out. A viewer read all 194 Audacious payments including the 8 one-off
bonuses (£4,000); the office correctly saw 186. A discretionary payment to one
man is the most sensitive line in that table. Replaced with a policy that
respects the same rule.

Verified after: viewer sees audit_log **0**, fleets **1**, one_off **0**, and
still sees payments 186 / sales 118 / contracts 19 / crew 19. Skipper unchanged.

**The rule this leaves behind:** the permissive policies in this database do
not carry a fleet check of their own, so a **new table needs its
`fleet_isolation` policy before it needs anything else**. Without it, the table
is open to every tenant from the moment it exists.

**`crew` and `office` were probed too and are sound** — a `crew` login sees
only its own crew row and nothing else; `office` sees payments minus one-offs,
contracts and crew, and no sales at all. Note that last one is a *gap* rather
than a leak: office is described as "full except settings/crew" but
`sales_landings_skipper` is skipper-only, so an office user cannot see sales.
Decide what office is actually for before using it.

## Working offline

Built Aug 2026, because an engineer logs in the engine room and that is where
the signal is worst.

**Two halves, and the second is useless without the first.** `public/sw.js`
caches the shell so the app OPENS with no signal — capture is pointless if the
page never loads. `src/lib/offline/` is the outbox that holds what he types.

`sw.js` is hand-rolled rather than `vite-plugin-pwa`: the rule is "anything
already fetched stays fetched", which needs no knowledge of Vite's hashed
filenames and so cannot fall out of step with them. Strategies:

    navigations   network first, cached shell as fallback (a deploy is still
                  picked up on the next load ashore)
    /assets/*     cache first — content-hashed, so a URL's bytes never change
    Supabase      NEVER cached. A stale settlement read back as current is
                  worse than no figure at all.

Reads that must survive offline are cached **deliberately**, in IndexedDB, with
a timestamp — `cacheTable()` / `readCache()`.

### The outbox

`useOfflineTable(table)` is what the pages use. **Every write goes through the
outbox even on a good connection** — two code paths would mean the offline one
is the path that never gets exercised, and it is the one that has to work on a
bad day. Online, the immediate flush makes it feel direct.

Three rules it must keep:

1. **Inserts carry a client-generated `id`.** Postgres would default one, but
   then a row created offline has no identity until it syncs and cannot be
   edited or deleted before then.
2. **Replay is strictly in order, one at a time.** An update to a row created
   offline must land after its insert.
3. **A rejected write must not block the queue forever.** A dropped connection
   is temporary; a check-constraint violation or an RLS denial never is. They
   are told apart by whether PostgREST *answered*: an answer with an error code
   is a decision, a thrown fetch is a lost connection. Refusals are parked as
   `failed` and shown by name in `SyncStatus.jsx` — never silently dropped,
   because a Garbage Record Book entry is a legal record.

`applyPending()` lays unsent writes over the server rows, so an entry typed at
sea stays visible instead of appearing to vanish on save. Rows carry `_pending`
and the pages label them "not sent".

**Verified in a real browser, not by inspection.** The riskiest assumption was
that IndexedDB writes the auto-generated `seq` back into the stored object — if
it did not, `flush()` could never delete what it had sent and the queue would
never drain. Confirmed, along with insertion ordering, delete-by-generated-key,
in-place update without duplication, and the cache round-trip. Service worker
registers and activates, and the shell, JS, CSS, fonts and login hero are all in
`caches` after one load. `test-offline.mjs` covers `applyPending()`.

`flush()` **never rejects** — it is fired from an `online` event and from every
save, neither awaited with a catch, so a rejection would surface as an unhandled
rejection and leave the outbox looking idle.

Icons: `scripts/make-icons.mjs` rasterises the favicon's own geometry to PNG
with nothing but `zlib`. iOS will not use an SVG for a home-screen icon — with
no PNG the app icon is a screenshot of the page.

## The native app (Capacitor) — BUILT, THEN SHELVED

**Decision, Aug 2026: the PWA is the route. The native app is on the shelf.**
Not abandoned — `android/` and `ios/` are committed and working, and
`npm run cap:sync` picks up wherever it was left. It was shelved because the
cost is a Mac (~£600, or £30–80/month for a cloud builder) plus £79/year, and
the PWA covers the need today at nothing.

**All crew are on iPhone/iPad**, so if this is picked up again: Android is not
needed and Android Studio is not worth installing — testing there proves
nothing about WKWebView, which is where the bugs would be. The iOS project is
already universal (`TARGETED_DEVICE_FAMILY = "1,2"`, iOS 15+), so iPhone and
iPad are one app, one build, one submission.

**The one thing that should bring it back off the shelf** is storage
durability. A browser treats web storage as disposable and may reclaim it; the
outbox can be holding a Garbage Record Book entry — a legal record — for a
whole trip. `requestPersistentStorage()` in `src/lib/offline/db.js` asks for
the durable kind at boot, and being on the home screen counts in its favour,
but the browser decides and **it is a request, not a guarantee**. Measured in
a desktop browser with no engagement history: **denied**. A native app has no
such question hanging over it.

Everything below still applies whenever it is resumed.

Capacitor 8 wraps the existing Vite build — the same `dist/`
the website serves — so no page was rewritten. `android/` and `ios/` are
committed, because they carry permissions, signing and native config; the web
build copied into them is gitignored, since it is a duplicate of `dist/`.

    npm run cap:sync       build + copy into both native projects
    npm run cap:android    build + open Android Studio
    npm run cap:ios        build + open Xcode  (Mac only)

App id `uk.co.skippermanagement.app`, name **Skipper**.

**iOS generated fine on Windows** — Capacitor 8 uses Swift Package Manager, not
CocoaPods, so `cap add ios` needs no Mac. **Building and signing still does.**
Android needs Android Studio (a JDK and the SDK; neither is installed here).

### What had to change for a native shell, and why

- **The five `/.netlify/functions/…` calls were same-origin assumptions.** In
  the shell the page is served from the device — `capacitor://localhost` on
  iOS, `https://localhost` on Android — so a relative path resolves to the
  phone and fails, quietly, in a feature the skipper uses occasionally.
  `fnUrl()` in `src/lib/apiBase.js` makes them absolute when native. Supabase
  was never affected: its client is built with an absolute URL.
- **Those functions then need CORS**, which they had no reason to have while
  everything was same-origin. `netlify/functions/cors.cjs` is an **allow-list**,
  not `*` — they run with the service-role key, and there is no reason to let
  any page on the internet put a request to them. Each handler is wrapped once
  so every return path carries the headers, including the error returns.
  `Vary: Origin` matters: without it a CDN can serve one origin's response to
  another, which looks like CORS failing at random.
- **The service worker is skipped when native.** The whole build is already on
  the device, so it would be a second cache of files that cannot go missing.
- **Android's back button** closed the app mid-form by default. It now walks
  back through history and only exits from the top.
- **Safe-area insets** in `body`, plus `viewport-fit=cover` in the meta
  viewport — without the latter `env(safe-area-inset-*)` reports zero and the
  sidebar tucks under the notch. Also `overscroll-behavior-y: none`, so a pull
  down on a log form cannot trigger a reload.

### Icons

`npm run icons` writes both the PWA icons in `public/` and the 1024px sources
in `resources/`, all from the favicon's own geometry. Then
`npx @capacitor/assets generate` fans those out to every density.

**That tool is not tidy — check `git status` after running it.** It overwrote
`public/manifest.webmanifest` with `../icons/*.webp` paths that point above the
web root and are declared `image/png`, and it deleted `public/favicon.svg`. Both
were restored by hand. It also leaves a stray `icons/` directory at the repo
root that nothing serves.

### Still to do

Agreed Aug 2026: **private distribution** — Apple Business Manager custom app
or TestFlight, not a public listing.

- Neither platform has been **built or run on a device** — no JDK, no Android
  SDK, no Mac here. Everything above is verified by compile and by inspection
  of the generated projects, not by a running app.
- Signing: an Apple Developer account (£79/yr) and an Android keystore.
- The PWA remains the zero-cost route and is installable today.
### Sessions at sea

**An expired access token used to read as a signed-out user.** When the token
expires and the refresh cannot reach the server, auth-js returns
`session: null` — but it deliberately leaves storage alone, because a dropped
connection is not a refused token (`isAuthRetryableFetchError` guards the
`_removeSession` call). Treating that null as signed out sent a man an hour into
a trip to a login page that needs the network he has not got, with his outbox
stranded behind it.

`hasStoredSession()` / `sessionHeldInStorage()` in `supabaseClient.js` are the
test: a refresh token still in storage means signed in but unable to prove it.
`signOut()` clears it, so a genuine sign-out is not confused with a lost signal.
`AuthContext` exposes **`signedIn`, and routing must use that, not `session`.**
`test-session.mjs` covers the decision, corrupt storage included.

**The `app_users` query needs the network too**, so opening the app offline left
`appUser` null — `keepsLogs(null)` is false, so the engineer could not write the
very entries the outbox exists to hold, and any row he did make would have had
no `fleet_id` and been refused by RLS on sync. The record is now cached in
localStorage. **It is for rendering only** — anyone can edit their own
localStorage and claim to be a skipper; it changes which menu items they see and
nothing else, because RLS decides what data exists.

`fleet_id` is stamped by `useOfflineTable.insert()` and its absence is a refusal
rather than a queued write, so the problem surfaces while the man is still
looking at the form instead of hours later.

**Boot from cache, never wait on the network.** `getSession()` has to attempt a
refresh when the token has expired, and auth-js retries with backoff —
**measured at 20 seconds** against an unreachable server, and the banner
confirming the state took between 45 and 104 seconds. Blocking first paint on
that meant 20 seconds of "Loading…" every time. `presumed` covers the gap:
routing trusts storage immediately, while the "not reaching the office" banner
waits for a confirmed failure so it never flashes on a normal load.
**Measured after: 113 ms to a usable app** against the same dead server.

**`navigator.onLine` means "attached to a network", not "the office answers".**
A boat on wifi with a dead backhaul looks online and answers nothing. Every
outbox attempt and every table read is bounded at 15 s and a timeout is treated
as a dropped connection — without that, one hung request would wedge the outbox
for the whole session, since `flushing` refuses to start a second flush.

Verified against a build pointed at an unreachable Supabase, which fails exactly
as being at sea does: not bounced to login, sidebar correct, identity from
cache, log page usable, and the entries still on the device. Rebuild afterwards
and check the test URL has not leaked into `dist`.

Also fixed on the way past: `EngineLogs.jsx` still carried a `← Dashboard` link
and cross-links to Crew List and Crew Certificates from before the sidebar
shell — pages an engineer cannot open. It now uses `PageHeader` like everything
else, and the "set your vessel details" prompt is skipper-only for the same
reason.

## Outstanding work

- **Vessels — stage 1 DONE Aug 2026** (`supabase/vessels_schema.sql`).
  A `vessels` table, 16 vessels across 12 fleets, and a nullable `vessel_id`
  on the 16 tables that are genuinely per-vessel. **Deliberately additive:
  nothing reads `vessel_id` yet**, so no page changed behaviour.

  `vessels.label` matches `sales_landings.vessel` exactly, which made that
  backfill a real join — **316 of 316 landings filled**. Single-vessel fleets
  are fully backfilled everywhere. **Pair fleets are left NULL on purpose**:
  which boat a crewman, rota trip or quota line belongs to is not knowable
  from the data, and guessing would put a man on the wrong boat.

  Fleet-level tables deliberately have no `vessel_id` — settings, alerts,
  `sales_buyer_flags`, `fuel_suppliers`, `app_users`, `ingest_senders`.

  **Stage 2, not done:** pages reading `vessel_id` rather than matching on the
  vessel text; `vessel_details` moving off `fleet_id` as its primary key (the
  disruptive one — do it alone); a vessel picker on crew, quota and rota; and
  the pair fleets assigning their NULL rows.
**This section was audited against the code Aug 2026 and SIX entries were
already built.** Check before starting anything here — a stale to-do already
cost real effort twice in one session. Verified done and removed:
login-hero WebP · `SquareUp.jsx` (on `AppShell`, no `BackNav`) · vessel photo
(`fleets.hero_path` + `fleet-photos` bucket) · `parseTripXlsx` (241 lines,
including the `ITQ CATCHES` dispatcher) · A4 haddock manual totals
(`splitA4ByTotals` + UI) · `crew_list_members.place_of_birth` on the FAL 5.

- ~~P&J blank buyers~~ — **closed Aug 2026 as permanent, not pending.** The
  coordinate fix is in `parse-core` (Withdrawn flag x≈467, Name column
  x 500–634) and works. The **136 blank-buyer rows across 10 landings** were
  parsed before it shipped, and David confirmed the notes are not obtainable
  from P&J, so re-uploading is not an option. All ten belong to
  `GUIDING LIGHT H90 + FAITHLIE FR220`:

      08-01 Faithlie · 08-01 Guiding Light · 20-01 Guiding Light
      03-02 Guiding Light · 16-02 both · 23-02 both
      12-03 Faithlie · 22-04 Faithlie

  **The damage is narrower than it looks.** All 136 rows carry species, grade,
  weight and value — only the buyer is missing. So gross, tonnage, £/kg,
  species mix and grade analysis are all sound; the hole is confined to buyer
  attribution, and to one fleet: £109,131 of £3,666,761, **3.0% of value**
  (5.1% of rows).

  `buyerCoverage()` in `salesAgg.js` measures it and Buyer League shows it as
  a panel. Blank-buyer rows were being dropped from the league silently, which
  made an incomplete table look complete — a quiet buyer and a missing one
  looked identical. Now the gap is stated, with the landings named.

### `reconcile_ok` does NOT mean the money is wrong

Worth knowing before chasing one. The flag compares the parsed rows against
the **TOTAL line printed on the note**. But `sales_landings.boxes/weight_kg/
value` are written from `rec.actual` — the **row sum** — so querying a landing
against its own `sales_rows` compares the parse against itself and returns
zero every time. That is not a reconciliation and it proves nothing.

The printed total was never stored, so a flagged landing was unreadable after
the fact. `sales_landings.reconcile_diff` (jsonb, `supabase/sales_reconcile_diff.sql`,
applied Aug 2026) now holds `expected` / `actual` / `diffs` / `basis` from the
parser, written by **both** ingest paths — `netlify/functions/ingest.js` and
`Sales.jsx`. Landings before that carry null and cannot be recovered without
the original note; `reconcileNote()` in `Sales.jsx` says so rather than showing
a bare ⚠.

Note P&J's box diff is informational — it prints a *physical* box count that
never ties to the fractional column, so `reconcilePJJ()` scores on weight and
value only and sets `basis: 'physical'`.

**16 landings currently carry `reconcile_ok = false`** — the 10 P&J ones above,
plus 06-16 Rosebloom, 06-16 Boy John, 06-30 / 07-13 / 07-21 Beryl and 08-03
Boy Andrew. Those six have **no** blank buyers, so they failed for some other
reason, and with no `reconcile_diff` on them there is currently no way to tell
what. Re-uploading any of those notes will fill it in.
- ~~Buyer league table~~ — **done Aug 2026.** `BuyerLeague.jsx` at
  `/buyer-league`, under Sales.

  **The method is the point.** Averaging a buyer's £/kg over a year mostly
  measures *when* they were bidding, because prices move week to week. So
  every row is scored against the volume-weighted average for the same
  species, same grade, **same day**, and the score is how far over the board
  they bought. Days with only one buyer are dropped — one bid is not a market.
  Auctions are excluded throughout.

  **`buyerLeague()` was removed Aug 2026** along with the Buyer League tab on
  `SalesInsights.jsx`. It ranked buyers on raw £/kg averaged over the period,
  which mostly measures *when* a buyer was bidding. Two tables both called
  "buyer league" that rank differently is worse than one.
  `buyerPremiumLeague()` is the only one now, and **`byGrade` defaults to
  true** — with it off the day's average is taken across every grade of a
  species, so a buyer who took only the top grade shows a premium he has not
  earned. That is a comparison of grades dressed as a comparison of buyers.

  **The 1,000-row trap.** Supabase caps a REST response at 1,000 rows and does
  not say so. `BuyerLeague.jsx` and `Reconcile.jsx` both read `sales_rows`
  with a plain select and silently got 1,000 of 8,067 — the league showed a
  single buyer, and the reconciliation showed nothing at all, neither with an
  error. `src/lib/fetchAll.js` is the shared paginated read; Sales,
  SalesCompare and SalesInsights each already had their own `range()` loop,
  which is why only the two newest pages were wrong. Use `fetchAll` for
  anything new that reads a whole table.

  **Merged Aug 2026: "J Smith" → "Messrs J Smith Ltd".** The fourth instance
  of the name-variant pattern, and the merge changed the answer materially:

      before   100,640 kg · 39 days · +£0.854/kg · worth  £86,000
      after    128,337 kg · 47 days · +£0.949/kg · worth £121,745

  The split was hiding a third of their volume *and* understating their rate,
  because the "J Smith" rows were the strongest of the lot. Verified as the
  only such case across every fleet.

  Bells Seafood technically tops the rate at +£0.989/kg, but on 6,762 kg over
  9 days — worth £6,686. That is exactly why the page carries a **worth**
  column beside the rate, and why days sits next to both.

  **The merge is recorded, not just applied.** `sales_buyer_flags` gained
  `canonical_name` and `aliases`. The one-off UPDATE fixes history; the alias
  is what stops the next sales note reintroducing the variant — **but nothing
  reads it at ingest yet.** Wiring that into the parser is the remaining step,
  and it needs both copies of `parse-core` changed and the version bumped.

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
