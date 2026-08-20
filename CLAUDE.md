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

**ONE PARSER, ONE FILE: `src/lib/parse-core.cjs`.** Now **1.3.4**. The
CloudMailin webhook imports it and so does the browser upload, so a fix cannot
reach one path and not the other.

### The two-repo rule is RETIRED (Aug 2026) — and it had already failed

It used to be a second copy of a file in `davgatt86/fish-sales-tracker`, served
at `fish-sales.netlify.app/parse-core.js` and pulled in **at runtime** by the
browser. The rule was "identical files, fix both, bump the version", and this
document claimed both were on 1.3.2, verified line for line.

**They were not.** Checked against the actual repo Aug 2026: it was still on
**1.2.1**. So for months every note uploaded through the BROWSER was parsed
without `BUYER_CANON` and without `canonVessel` — the two fixes that exist
precisely to stop buyers and vessels splitting their own records — while
emailed notes got them. Nobody could see it, because the version that mattered
was on a server nobody looked at.

That copy is a strict subset of this one; nothing was lost by taking it
in-house. **Do not reintroduce a second copy.**

**Nothing else consumes it either.** `fish-sales-tracker/index.html` carries a
comment saying the Sales Analyser loads it from
`https://fish-sales.netlify.app/parse-core.js`; checked against the real
sales-analyser repo Aug 2026, that is **stale** — it loads four cdnjs scripts
and never references `ParseCore` at all. So the fish-sales deploy has no
consumer left.

### The other repos, audited Aug 2026 — no ties either way

`fish-sales-tracker`, `sales-analyser`, `trip-gross-estimator` and
`square-up-sheet` were all read in full. **None of the four touches Supabase**,
so there is no shared database, and nothing in this app fetches from any of
them at runtime.

`src/squareup/` IS a **vendored fork** of `square-up-sheet` — nine files, copied
once and then developed here. This app is ahead on every one that differs
(storage 35→89 lines as it moved off localStorage onto Supabase, ui 82→137 and
constants rewritten onto the design tokens, pdfGenerator, Preview,
invoiceParser); the rest are byte-identical. `netlify/functions/parse.js` is
the same story against `trip-gross-estimator`. **Nothing in those repos is
missing from here** — checked line by line, not assumed. They are ancestors,
not dependencies.

The su_* tables came from **none of these four**. Most likely
`square-up-fleet-settlements` (its Netlify publish date matches the last write
to `su_boats`), which has no repo here — that is the one thing that could still
be writing to this database.

### pdf.js is bundled, not fetched

The same change killed the last CDN loads. `src/lib/pdfjs.js` is the single
loader; `parseCore`, `parseMarket.js`, `mcatchParse.js` and the Square Up
invoice parser all use it.

Before this the app shipped **two major versions of pdf.js** and picked between
them by which page you opened: Square Up imported the bundled `pdfjs-dist` v4,
while the sales-note, daily-price and quota parsers each injected a `<script>`
for **3.11.174 from cdnjs**. The webhook parses the same notes with v4, so two
versions of pdf.js were reading one note.

It also meant those uploads **needed signal**. A cross-origin script cannot be
cached by the service worker, on an app whose whole offline story is "anything
already fetched stays fetched" — so parsing a PDF already sitting on the device
failed on the network. Bundled and lazily imported, the chunk is fetched once
and cached like any other asset.

### The wrapped-row bug — 1.3.3, Aug 2026

**A row whose species cell wrapped onto the next line was dropped silently.**
The note is a fixed-width print and an `A+` grade is **one character wider**
than a plain `A` grade, which is enough to push the tail of the species token
onto a second line while the figures stay on the first:

    GT Seafoods Saithe 1.00 40 56.40 40 56.40
    Coley/GUT/A+4

`parseDonLine` anchors on the slash-token, finds none, and returns null — so
the whole row disappears. `buyerFragment` cannot pick the continuation up
either, because it rejects anything containing a digit, which is why the row
vanished rather than corrupting the buyer above it.

The continuation may carry the tail of a **long buyer name as well**
(`Ltd Lyth/GUT/A+2`), and that part must be appended to the BUYER — leaving it
in front of the species breaks the `SPECIES_PREFIX` match that rebuilds
"Pollock Lyth", and the buyer swallows "Pollock".

Measured on the real Audacious note of 13-08-2026: **13 boxes and £2,241.80**
missing, every one an A+ row, on a note that reconciled to the penny on 13 of
its 15 species. After the fix it reconciles exactly — 1,192 boxes, 44,805 kg,
£136,656.50, `ok: true`, 175 rows → 182.

### The starred-price bug — 1.3.4, Aug 2026

**A row whose price carried a leading `*` was dropped silently.** The office
flags a figure with a star, and on a fixed-width print the star costs a
character — so a price that should read `2343.75` comes out as `*2343.` with
the pence pushed off the end:

    AG D Duff & Partners Halibut/GUT/U9 1.00 188 *2343. 188 2,343.75

`parseDonLine` wanted `[\d,]+\.\d{2}` in the cost column, got neither the
digits nor the star, and returned null — losing the whole row.

**Found by Colin on the Beryl note of 11-08-2026**, where that ONE halibut row
is the entire **£2,343.75** the landing was short. He spotted it on the note;
no amount of reading the parser would have.

The cost and value columns now both tolerate a star (`num()` strips it — a
flag is not part of the number) and the cost column tolerates truncated pence.
**A starred or short price is recomputed from the value**, which is unstarred
and exact, rather than trusted at face value.

Note this is a *different* bug from the wrapped row below, on a different note.
Two separate silent-drop faults in the same parser, both worth real money, both
invisible until someone reconciled a note against its own printed total.

**The same signature is on three other landings** — a small negative diff on
boxes, weight and value at once, all Don Fishing: Boy Andrew 11-08 (−92 boxes,
−£4,088.98), Beryl 11-08 (−1, −£2,343.75), Boy Andrew 17-08 (−2, −£98.80).
**£8,773 across the four.** Those notes want re-ingesting once both copies of
the parser carry 1.3.3.

`test-parser.mjs` holds the real pdf.js-extracted lines and covers it,
including that a following data row is never eaten as a continuation.

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

### FLOORS — the fish can go lower, but the market cannot afford it

"Can not go higher, but can go lower" is true of the fish and false of the
floor space. **David, Aug 2026: "it keeps dropping chippers flat."** Flattening
124 boxes of chippers costs **62 footprints** and buys nobody a better look at
a bulk grade; flattening 8 boxes of baby cod costs 4 and is exactly what the
spare room is for.

So every grade now has a **floor** as well as a ceiling — `DEFAULT_FLOORS`,
same species × band shape, **absent means 1** (free to go flat). Only the bulk
grades are stiffened: haddock bands 2/3/4 and black 3/4.

**A size band is not always fine enough, and that is why per-grade rules
exist.** `Seed (2a)` and `Chipper (2b)` are BOTH band 2 haddock and both price
at £4.07 — no band rule can hold one and release the other. `gradeRules`, keyed
`SPECIES||Grade` on the grade exactly as the tally writes it, beats the grid for
both `max` and `min`. Empty by default; it is where a skipper's own corrections
land.

**The rules are changed from the layout page, not the settings page.** Market
Layout lists what was **laid lower** and what was **held up**, each with one
button — `Hold at N` / `Let it drop` — writing a per-grade rule. That is where
you notice a grade went somewhere you did not want it, so it is where the rule
wants changing; typing `Chipper (2b)` from memory three pages away is how it
does not get done. The settings page carries the same controls for bulk edits.

`plan.held` reports only where a floor **actually bit** (the grade sits at its
floor and could otherwise have come down). A rule that quietly refuses is as
confusing as one that quietly acts.

On Trip 63 the floors change the answer: Seed and Chipper stay at 2, Metro
comes down 3→2 and Black Sma 4→3, while Cod B Baby, Cod Baby, Whiting Med and
Black Large still go flat. Still 17 tiers, still 0 spare.

**An unfiled species is laid out anyway, on Rough, and NAMED** in the plan's
warnings with a link to the rules page. Falling to "whichever clock is last" is
not a rule; quietly sending a fish to the wrong auction is the failure worth
guarding against.

**Both rows fill in proportion.** A tier hands you 21 and 26 at the same time —
you cannot take one without the other — so the tier count is set by whichever
row runs out first, and packing the bottom tight while the top sits half empty
simply costs tiers. Species go to whichever row is furthest behind its share.

**Every species goes into a row WHOLE, flats included.** The flats exception is
"may be broken across the two rows to use up space the other three leave
behind" — it is not "cut every flat down the middle", which is what handing
each STACK to whichever row was behind actually did. On Trip 64 that split hake
39/32, megrim 9/10, lemons 6/7 and halibut 4/5, so four species appeared twice
and a buyer after hake had to walk both rows — the exact thing keeping a
species in one band exists to prevent. **David caught it on the printed sheet:
"why is the flats doubled".**

The spill is now a single pass after everything is placed: move ONE contiguous
run off the end of the fuller row, and land it at the START of the SAME tier's
other row. At most one species is ever split, at one clean break.

**A tier is walked top row then bottom row**, so a fish that spills has to carry
straight off the end of the one into the beginning of the other. Appending it to
the end of the receiving row instead put four species between the two halves —
*"if hake is started at top tier 15, it can only go to bottom tier 15, with no
breaks of another species between"* (David, Aug 2026):

    tier 17 top     HAKE x21
    tier 17 bottom  HALIBUT x7 | WITCH x2 | PLAICE x1 | TURBOT x1 | HAKE x9

So the number moved must satisfy TWO things, not one: drop a tier, **and** land
in the tier the donor row now ends on. The bare minimum often leaves the
receiving row still short of that tier, which is what broke it. Take the fewest
that does both; if nothing does, spill nothing and wear the extra tier — a
sheet that reads right is worth more than a tier of flats.

Trip 64 stays at 17 tiers with hake alone split 62/9, carrying tier 17 top into
tier 17 bottom. Trip 63 splits nothing at all, because there the split was
earning nothing.

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
it goes on the floor in chalk. It prints A4 portrait, **five tiers to a page**.

**Five, not ten** (David, Aug 2026: *"easier to read when printed"*). Ten
fitted, and that was the problem — a 19mm column cannot hold a species, a
grade, a code, a day tag, a count and a height at a size anyone reads on a wet
market floor, so half the blocks sat at **1.75mm** type and the one-footprint
ones needed two stacked lines. Five doubles the column to **38.5mm**, which
lets the type go up with it: smallest block type **1.75mm → 2.3mm**, largest
2.6 → 3.2mm, and a one-footprint block now fits all five fields on ONE line.
The column HEIGHT is unchanged — a tier is still 47 footprints — so this costs
pages, not legibility. Trip 63 goes 2 pages → 4.

- **Tiers are COLUMNS**, read top to bottom, top row at the top of the column
  and bottom row at the bottom with the walkway between — a plan view of the
  floor rather than a diagram of it. Tier number in a black tab at the head.
- **Runs, not boxes.** Consecutive footprints of the same grade off the same
  day tag are ONE chalked block, written once. 1,424 boxes become 297 blocks.
- **Every block says the same five things in the same order**, whatever its
  size: species · grade NAME · grade CODE on the top line, day tag · boxes ·
  height on the bottom. Only the type scale changes — a one-footprint block is
  5.2mm and gets two tight lines rather than one crowded one. Dropping a field
  on the small blocks meant the sheet said different things in different
  places, which is worse than small type.
  Name **and** code, because neither identifies a grade on its own: `Seed (2a)`
  and `Chipper (2b)` share a band, and "Large" is four different fish.
- **Height is a chip, not a footnote** — `FLAT` / `2HI` / `3HI` / `4HI`, right
  aligned so it sits in the same column down a 47-deep tier. FLAT gets the word
  and a solid black chip: it is the dear fish and the row you must not stack on.
- Three boundaries, three weights: heavy black rule = new species, medium =
  new grade, hairline in the tag's own colour = new day tag **inside** a grade.
- **Six hues × three shades.** Species carries the hue and keeps it across every
  tier so the eye can follow it down the market; grades inside it take different
  shades. Repeats elsewhere on the floor are fine — touching is not.
  **Three shades, not two**: the shade has to differ between grades that
  actually touch, which is not the same as alternating by index, and two shades
  put HAKE Large against HAKE Med in the same pink. Both hue and shade are
  greedy graph colourings over real adjacency; the test asserts zero clashes.

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
the imported data. **All of them are now done** — swept Aug 2026 across all 53
parameters and **no reading is more than 5× off its own median**:

- Charge Air Pressure — 20 readings, all 1.5–2.6. The 150/175 slips are gone.
- Lube Oil Pressure — 21 readings, all 4.2–5.0. The 42 is gone.
- **Gearbox 1 Oil Press — corrected 21-08-2026, and THE OTHER WAY ROUND from
  what this file used to say.** It read `28, 28, 2.8, 2.8, 38, 25, 38`, and the
  earlier note here claimed 28 was the slip and 2.8 the normal. **David: it is
  28.** The gauge runs in the 25–38 range and the two 2.8s were the mis-keys.
  Both were set to 28, with the reason on the row.

That correction is the whole argument for how the range check must work.

**A LIMIT DERIVED FROM HISTORY ALONE WOULD HAVE FLAGGED THE CORRECT READINGS.**
The median of that series was 28 while five of the seven entries were on one
scale and two on another — so a rolling average would have called the *right*
values outliers, and a keen engineer "fixing" them would have destroyed the
good data. 38 and 25 are also not decimal slips of 28, which is the tell that
this was two scales rather than a fat finger.

So the design is: a **stated operating range per parameter**, set once by the
engineer, as the primary test; the rolling average is a secondary *this is
drifting* signal and never the authority. Aegir has "parameter limits" and they
caught none of the above, so limits must block or flag on entry rather than
decorate the form.

Scale of the job: **53 parameters over 4 groups** — Main Engine 1 (28),
Gearbox 1 (9), Generator 1 (9), Generator 2 (7).

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

   **All five sections are built**, and so is the 42-point familiarisation
   list — `Familiarisation.jsx` at `/familiarisation`, 42 items in three
   categories, both signatures recorded, and the record only reads as complete
   when every item is ticked. 2 crew records started as at Aug 2026.

   What remains against them is the certificate reader (firm it up), and
   `place_of_birth` on the generated crew list document. Storing the original
   photo/PDF **is** built on both certificate pages; what is outstanding there
   is data entry — 6 of 16 vessel certificates and 4 of 111 crew certificates
   have a file attached, the rest are still only in Aegir.
4. ~~**Days-at-sea repair**~~ — **done Aug 2026.** The single-landing view now
   carries a days-at-sea input under the KPIs. The handler is called
   `saveDays`, not `updateDaysAtSea`, and it rounds to the nearest quarter day
   exactly as the list views do, so a trip typed in either place lands on the
   same figure. The `£/day at sea` KPI used to read "add days below" in a view
   that has no table below it.
   **14 of Audacious's 121 landings still have no days at sea** — re-counted
   Aug 2026, and the old note here said *79 of 118*, which was badly stale.
   `£/day` is broadly sound now. It also matters less than it did: `Trips.jsx`
   takes days from the LOGBOOK and only reports the typed figure beside it,
   rather than depending on it.
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

   Still to do: the itemised engine-parameter range checks — see the Logs
   section above for why a limit derived from history alone would have flagged
   the CORRECT gearbox readings, and why the range has to be stated rather than
   learned.

   The **garbage log** is built and in use — 6 entries as at Aug 2026, the most
   recent the same day — so the MARPOL Garbage Record Book question is settled:
   it is kept here, not only in Aegir.

Also agreed, not yet scheduled:

- ~~**GEAR LOG — what was done to the nets, and when**~~ — **STAGE 1 BUILT
  Aug 2026.** `/gear` (`GearLog.jsx`), `src/lib/gear/`,
  `supabase/gear_log.sql` (applied). The third book the boat keeps.

  **THE UNIT IS THE NET, NOT THE BOAT** (David, Aug 2026). Nets are named —
  Port net, Starboard twin, Pair hopper, Pair discer — and each carries its own
  ground gear, headline, bridles, legs and codend. **A pair tows one net between
  two boats, but BOTH boats carry nets**, so a pair team typically has FOUR
  aboard, two per boat, maintained separately. Nothing is shared: one boat
  shoots the net and bridles, the other comes alongside and attaches to his
  partner's net with his own rope. The earlier note that a pair "runs two sets
  of gear" understated it.

  So `vessel_id` is **required** here, not nullable-and-backfilled like the
  eighteen tables that took it in the vessels stage-1 migration.

  **A COMPONENT IS A THING WITH A LIFE, NOT AN EVENT IN A STREAM.** "Add new
  ground gear to a net" and "retire a set of ground gear" describe an object
  being fitted and removed, so a set is a ROW with two dates. Its life is
  `removed_on - fitted_on`, read straight off, rather than inferred by pairing
  up a stream of events that may be missing one end. A **renewal** closes one
  component and opens the next, in one action, so the dates stay flush and a
  life is never a gap. A **measurement** is an event on the fitted component.

  Four tables: `gear_nets`, `gear_parts` (fleet overrides only — the five
  shipped names live in `src/lib/gear/parts.js` and `resolveParts()` merges,
  same as the market rules and the stores catalogue), `gear_components`,
  `gear_measurements`. A partial unique index stops a net carrying two
  headlines at once.

  **The page is a MATRIX** — nets down, parts across. Read a row for one net's
  whole rig, or a column for one part across every net; David asked for both
  and a matrix is the one shape that is both. Click a net to open it: fit,
  renew, take off, measure, and the history of every set that has been on it.

  **Every "days since" carries its BASIS, and the page shows it.** *measured* /
  *fitted* / *since aboard* / nothing known. "69 days since measured" and "69
  days since she came aboard" are different facts, and a bare number would let
  a net nobody has ever looked at pass for one checked ten weeks ago. That
  fallback to the net's own `came_aboard` is David's: *"if it's not been
  logged, then it would show since net came aboard."*

  **Three units — fathoms, feet & inches, metres** — and every reading is
  stored TWICE. `value` + `unit` is what was written down, so 5 ft 6 in reads
  back as 5′ 6″ and not 1.6764 m; `value_mm` is the same length canonically, so
  a series survives the unit changing partway through it. A wear curve where one
  reading is in fathoms and the next in metres is worse than no curve.

  **Trips as well as days**, via `gear_trips_between()` — SECURITY DEFINER,
  and that matters: **`quota_trips` is NOT in the officer allow-list**, so read
  directly it returns zero rows and "0 trips" looks exactly like "no trips"
  rather than like a permission wall. The man keeping the gear log would have
  been the one person unable to see the trip count in it. Same argument as
  `crew_aboard_count()`: hand out the number, not the table.

  **Skipper and officer write it** — gear is deck work and a mate is an
  officer. Added to all three allow-lists in `officer_role.sql` **and** the 2b
  cleanup loop, since the deny loop cannot clear a denial from a table that has
  just JOINED the list. The cook needed no edit at all: he is denied by not
  being in his own list, which is the whole point of generating the deny-list.

  **A hole found by probe, not by reading.** `fleet_isolation` checks
  `fleet_id` and nothing checked that `vessel_id` pointed at a boat in that
  same fleet — so an officer could create a net in his own fleet hung on
  **another business's vessel**. Not a read leak, but a foreign key across a
  tenant boundary. Fixed declaratively with a composite FK
  (`gear_nets(vessel_id, fleet_id) → vessels(id, fleet_id)`, needing
  `unique (id, fleet_id)` on `vessels`) rather than a trigger, because a CHECK
  cannot run a subquery. **The other eighteen tables carrying `vessel_id` have
  the same hole** — out of scope here, but worth knowing before vessels stage 2.

  Probed: officer writes nets, components and measurements, is refused a second
  fitted headline and a cross-fleet vessel, reads `quota_trips` as **0** while
  `gear_trips_between()` returns **24**, and still reads sales **0** and
  payments **0**. Cook reads gear **0** and updates **0 rows**, while keeping
  his own stores list.

  **`toMm('')` returned 0, caught by test.** `Number('')` is 0 and
  `Number.isFinite(0)` is true, so a blank box canonicalised to 0 mm and would
  have joined the wear series as a genuine reading of nothing — a headline
  appearing to have vanished. Blank stays blank the whole way through; same trap
  as the running-hours figure in the maintenance page.

  **STAGE 2 BUILT Aug 2026** — the **Life** tab. `src/lib/gear/gearStats.js`,
  `GearStats.jsx`, `gear_trip_dates()` (applied).

  Three panels: **how long a part lasts** (average, shortest, longest, cost,
  in days AND trips), **what is on now** compared against that average, and
  **the nets themselves**.

  Two disciplines the file exists to enforce, both of which would quietly
  corrupt the answer otherwise:

  - **A set still on the net is NOT a life.** It has not finished. Averaging it
    in would drag every figure down towards however recently the last renewal
    happened — so *the better the log is kept, the worse the answer would get*.
    It sits in its own panel, compared against the average rather than folded
    into it, because "running at 111 days against a usual 60" is the thing you
    act on.
  - **The count is part of the answer.** `confidence(n)` is in one place so
    every panel hedges identically: *no renewals logged yet* · *one renewal —
    not an average yet* · *two renewals — thin* · *5 renewals*. One interval is
    an anecdote, and a figure that reads like a fact on the strength of it is
    the failure worth guarding against.

  **Nothing to average is null, never 0.** A zero average reads as "they last
  no time at all", which is the opposite of "nobody has renewed one yet".
  **Cost is averaged only over the ones that have it, and the panel says how
  many that was** — David: "a lot of the time this isn't known", and a mean
  over the known ones presented as a mean over all of them is a quiet lie.

  **A retired net is aged to its retirement, not to today**, or every net ever
  taken off keeps getting older and the oldest on the books is always the one
  longest gone.

  **`gear_trip_dates()` replaced the per-cell RPC.** Stage 1 asked the database
  once per matrix CELL — nets × parts round trips for one screen — and the life
  figures need a count per renewal interval as well, which would have multiplied
  it again. The dates are fetched once per vessel and counted client-side, which
  also makes `tripsBetween()` a pure function. **Both ends of the window are
  inclusive**: a set fitted the day the boat landed was fitted after that trip,
  and one taken off the day she landed came off after that one too — the gear
  did the trip either way. That is an off-by-one no amount of looking at the
  page would reveal, and it is covered by test.

  Same SECURITY DEFINER argument as before, and it returns **dates only** — no
  tonnage, ports, captain or trip numbers. Probed: officer reads
  `quota_trips` as **0**, gets **166 dates** for his own boat and **0** for
  another fleet's.

  **STAGE 3 BUILT Aug 2026** — the **Grounds** tab. `src/lib/gear/grounds.js`,
  `GearGrounds.jsx`, `gear_ground_days()` (applied).

  **AREA, NOT RECTANGLE** — David's call, and the data agrees with him: **17
  area+EEZ combinations against 129 statistical rectangles**. At the number of
  renewals a boat actually logs, rectangles would divide the evidence into
  slivers and every one would be noise.

  **The EEZ is part of the ground's identity, not decoration.** Audacious fished
  27.4.a for **573 days inside GBR waters and 325 inside NOR**, and David names
  them separately — *"iva (GBR), iva (NOR)"* — because to him they are different
  grounds.

  **The logbook writes `27.4.a`; the trade says `IVa`.** `iceLabel()` converts.
  A numeric sub-division runs on (`VIb1`, `VIb2`, `IIa2`) because that is how it
  is written; a lettered one takes a dot (`VIa.s`) so it cannot be misread as
  part of the division letter. Anything not a 27.x area passes through untouched
  rather than being mangled into a wrong-looking Roman numeral. **All 17 real
  grounds were run through it and checked by eye**, not assumed.

  **THE METHOD.** A finished set is ONE set consumed, split across the grounds
  it was worked over in proportion to the days on each. A ground's rate is then
  *sets attributed ÷ days fished*, reported as sets per 100 days.

  Splitting the set is the whole point. Counting a set's **whole** life against
  every ground it touched would let a ground that is always fished alongside a
  long-lasting one inherit its figure — which is a comparison of company kept,
  not of ground worked. Asserted by test in both directions: equal time on two
  grounds gives equal rates, and a ground that consumed two sets in the same
  fished days as another's one ranks at exactly twice the rate.

  **Day-ground PAIRS, not days.** A day worked over two grounds counts in both,
  which is right for attributing wear, and is why the shares still sum to 1 while
  the pair total exceeds the days at sea.

  **The page says what it rests on, first and unmissably.** `groundConfidence()`
  is deliberately strict: fewer than three finished sets, or fewer than two
  grounds carrying 20+ days and 2+ sets, and it says so at the top rather than
  ranking anything. Individual thin rows are dimmed and marked *thin*, and the
  column order puts **days and sets before the rate** — a ground with four days
  will show the most extreme figure on the page and mean nothing.

  **A life with no logbook days inside it is COUNTED as unattributed**, never
  dropped. Losing it silently would make the rates look better founded than they
  are.

  **Where each set was worked is shown regardless**, per part, with the ground
  mix as chips. That is useful from the first renewal, long before any rate above
  it means anything.

  Probed: officer reads `quota_trip_catches` as **0**, gets **1,240 day-ground
  rows across 17 grounds** for his own boat and **0** for another fleet's.

  `test-gear.mjs` — **171 checks**.

  **One oddity worth asking David about:** the logbook carries `27.6.a.s` for
  24 days, which is not a standard ICES division. It renders as `VIa.s` rather
  than being silently folded into `VIa`.

  **All three stages are built.**

  **Cost is optional throughout** — David: "a lot of the time this isn't
  known". Where it is entered it would be the **first real per-vessel cost in
  this database**, which is the thing `Trips.jsx` does not have and why it
  reports rates rather than profit.

- **PARTS INVENTORY, hanging off maintenance** (David, Aug 2026). What parts
  were used on a job, and what is left aboard.

  **The stock figure should be DERIVED, not typed.** A maintenance event
  consumes parts; if each event records what it used, "what is left onboard"
  falls out of (last stock take − everything consumed since) and cannot drift
  from the job record the way a separately-maintained count would. That is the
  whole design: one number, two views.

  `maintenance_events` already exists and is where the consumption line
  belongs. What is missing is a parts list and a stock take.

  Worth knowing before building: this is the first thing in the app where a
  figure is a **running balance** rather than a snapshot, so a wrong entry
  propagates forward. It wants the same treatment as the fuel log — show the
  workings, not just the answer — and an officer must be able to correct one
  without a skipper login, since he is the man holding the part.

- **STORES / PROVISIONS LIST, per trip** (David, Aug 2026). Built up as the
  trip goes on rather than written once, so it wants a **cook login** — a new
  role, and one that gets stores and nothing else. Money and sales are denied
  the same way they are for an officer; re-run `officer_role.sql`'s allow-list
  machinery for it rather than inventing a second mechanism.

  Views: the whole list, by category, or searched.

  **The inventory already exists on paper** — `iCloudDrive/Audacious_/Stores
  List.pdf`, the Whitehills Premier order form. Four scanned pages, **18
  categories and roughly 350 items**: Bakers · Baking · Chill · Fruit ·
  Vegetables · Crisps and Snacks · Butchers · Tea and Coffee · Cans Fruit and
  Puddings · Cereals · Juice Cans · Cans Veg and Meat · Sugar and Jams ·
  Biscuits · Pasta · Frozen · Household · Miscellaneous. That is the seed;
  type it in once rather than making the cook build it.

  **Units are per item and are not all "each"**: unit, case, pack, litre,
  half dozen, dozen (eggs). The form already carries some of it in the item
  name — "VEG COOK OIL 1LITRE" and "5LITRE" are two lines, "POTATOES 25 KILO"
  is one — which is the paper way of saying the unit belongs on the item.

  **Every category on the form ends with OTHER and blank lines.** That is the
  paper version of "the cook adds an item", and the app version is that a
  cook-added item PERSISTS into the next trip's list. Same requirement, so do
  not build a free-text box that forgets.

  **Translation is for the supplier, not the cook.** Landing in Hanstholm or
  Norway means handing the list to a foreign shop, so Norwegian and Danish
  names must be a STORED per-item field the cook can correct — not machine
  translation at print time. Half this list is Scottish butcher vocabulary
  (polony, Lorne, neeps, tattie waffles, softies, butteries) and a machine will
  not get those right; a wrong word on a provisions order gets the wrong food
  delivered to a boat that is about to sail. Always print the English beside
  it.

  **The butchers order is its own recurring shape**, and the three real ones
  (25-07, 17-08 and one other) show it: *breakfast* · *cold meat* · *meals for
  N*. Two things worth building in rather than discovering later:

  - **N is the crew count.** It went "Meals for 10" → "Meals for 11" between
    July and August, which is Gundarovs joining. The app already knows who is
    aboard from Crew Status, so that figure should be derived, not typed.
  - **The quantity notation already drifts.** The same order reads
    `bacon rashers 30x8`, `x8 20 Bacon Rashers` and `pork sausages 16 x 5`
    across three trips — pack size × number of packs, written three ways. That
    is the fifth instance of the pattern after `crew_ranks`, fuel suppliers,
    vessel labels and buyer names: **anything typed rather than picked will
    drift.** A quantity is a number, a unit and a pack size, chosen from the
    item.

  Per VESSEL rather than per fleet, like the gear log — a pair team feeds two
  crews.

  **AGREED PLAN (Aug 2026), in build order:**

  1. ~~**Catalogue and list, skipper-only.**~~ — **BUILT Aug 2026.**
     `/stores` (`Stores.jsx`), `src/lib/stores/catalogue.js`,
     `supabase/stores.sql` (applied). The catalogue lives in CODE with
     per-fleet overrides merged over it by `resolveCatalogue()`, exactly like
     the market rules — seed 334 rows per fleet instead and a translation added
     next month never reaches the boats that have already saved.
     **334 items across 18 categories**, transcribed from the Whitehills
     Premier order form the boat already uses, so the page is the paper form
     the cook knows rather than a new vocabulary.
     Three tables: `stores_items` (fleet additions and overrides only),
     `stores_lists` (one per trip), `stores_list_items` (the lines).
     **`added_at` on the line** is what makes it a list built up over a trip
     rather than a snapshot.
     `crew_aboard_count()` is SECURITY DEFINER and returns **11** for
     Audacious, which is what "Meals for 11" on the August butcher note says.
     Verified by probe: skipper read/write, viewer read-only, officer **0 rows
     and blocked**, every other fleet **0 rows**.
  2. ~~**Cook role and offline capture.**~~ — **BUILT Aug 2026.**
     `supabase/cook_role.sql` (applied), `is_cook()`, `isCook`/`keepsStores`
     in `roles.js`, `cook` in `CREATABLE_ROLES` and both Users pickers.

     **The cook's whole menu is ONE page.** `canSee()` treats him as an
     allow-list exactly like the officer, so adding a nav item hides it from
     him by default — the safe direction to fail in. `RoleHome` sends him to
     `/stores`, and `/` is never blocked by `ProtectedRoute` (that was the wall
     an engineer hit before).

     **74 tables denied, 6 allowed** — `stores_items`, `stores_lists`,
     `stores_list_items` to write; `fleets`, `settings`, `app_users` to read.
     74 + 6 = 80, which is every RLS table in `public`. Storage is shut whole.

     **Verified by probe, not inspection** — a throwaway cook login created
     inside a transaction that was then aborted:

         stores_lists 1 · stores_list_items 5 · his own app_users row · fleet 1
         sales 0 · sales_rows 0 · settlements 0 · quota 0 · payments 0
         contracts 0 · crew 0 · crew_certs 0 · engine_logs 0 · fuel_log 0
         vessel_certs 0 · audit_log 0 · alerts 0 · market_prices 0 · storage 0

         stores_list_items UPDATE  5 rows      engine_logs UPDATE   0 rows
         stores_lists INSERT own fleet  allowed
         stores_lists INSERT other fleet  blocked
         settings / fleets / app_users UPDATE  0 rows each
         app_users INSERT  blocked   (so he cannot mint himself a skipper)

     **`crew = 0` while `crew_aboard_count() = 11`.** That pair is the whole
     design: he gets "meals for 11" for the butcher's order without being
     handed the crew table. SECURITY DEFINER is what makes it work, and it is
     the reason that function exists.

     A skipper re-probed afterwards is unchanged — 121 landings, 20 crew, 194
     payments, 20 engine logs, 11 storage objects — because `not is_cook()`
     returns TRUE for every other role rather than null.

     **Offline capture**: `Stores.jsx` now reads and writes through
     `useOfflineTable` on all three tables, like the logs. All three are read
     WHOLE and filtered in the page rather than queried by `list_id`, so
     switching between trips works with no signal. `added_at` is stamped
     client-side, because a list built up over a trip should carry the time the
     cook wrote the line, not the time it reached the server.
     `crew_aboard_count` needs the network, so a list started at sea leaves
     `meals_for` blank and says so rather than guessing.
     The `(list_id, item_key)` unique index means the same item added twice —
     once offline, once ashore — is refused on sync and parked as `failed` with
     its name shown, which is right: a refusal is a decision, not a lost
     connection.

  ### Quantities are typed, and units are picked

  **"30x packs of softies is a lot of clicking"** (David, Aug 2026). The
  steppers stay, because one or two more is genuinely faster than selecting a
  field, but the number itself is an input. The draft is held locally and
  commits on blur or Enter — committing per keystroke would save `3` on the way
  to `30`, and since **0 removes the line**, typing a quantity backwards over a
  1 would delete the row out from under the cook. Focus selects all, so 30 over
  a 4 is 30 and not 304.

  **The shipped units were MY GUESS and are now the boat's to set.** The paper
  form only carries the unit sometimes — "VEG COOK OIL 1LITRE" says it,
  "Softies" does not — so every line has a unit dropdown, and picking one
  writes a `stores_items` override that holds for next trip. Sixth instance of
  the same pattern after `crew_ranks`, fuel suppliers, vessel labels, buyer
  names and the quantity notation: **anything typed rather than picked will
  drift** — and anything guessed rather than asked will stay wrong.

  **Only `unit` goes into the override row.** Writing the name and category
  as well would freeze this fleet's copy of both, so a later correction to the
  shipped catalogue would never reach the boat — the exact thing keeping the
  catalogue in code exists to avoid. `resolveCatalogue()` falls back to the
  shipped values for anything the row leaves null, and marks
  `unitConfirmed` so the page can show what is still a guess (dashed border)
  against what the boat has actually answered.

  **The order sheet spells the unit out, in its own column.** `CS` is obvious
  on the boat and means nothing across a counter; the person picking the order
  has never seen this app, and reading "12 cs" as 12 loose items is a week's
  food short. `unitLong()` pluralises — case/cases, pack/packs, litre/litres —
  and leaves **dozen** and **half dozen** invariant, because nobody has ever
  written "6 dozens". A plain unit prints nothing at all: "each" on four rows
  in five is noise on a sheet somebody is picking from.
  3. ~~**Translation and the supplier print.**~~ — **BUILT Aug 2026.**
     `src/lib/stores/i18n.js`, `stores_lists.supplier_lang` (applied),
     a language picker and a translation editor on `/stores`.

     **TWO CLASSES OF WORD, and they must not be treated alike.**

     The CATALOGUE ships blank and is translated by the boat. Half of it is
     Scottish butcher and baker vocabulary — polony, Lorne, neeps, tattie
     waffles, softies, butteries — and no machine gets those right. A wrong
     word on a provisions order gets the wrong food delivered to a boat that is
     about to sail. `test-stores.mjs` asserts every shipped item is still
     untranslated, so a future me seeding the catalogue fails the suite first.

     The SHEET'S FURNITURE is about a dozen fixed, generic terms — quantity,
     unit, item, note, page, and the unit words themselves. Those ARE
     translated in code, once, because a case is a case in any trade.

     **What makes that safe is that the English is printed beside every one of
     them.** Title, column heads, unit words, item names — all of it. If a word
     of mine is off, the shop still has something it can read and being wrong
     costs nothing. Break that rule and the feature becomes a way to order the
     wrong food confidently.

     **The category headings are deliberately NOT translated.** They are the
     boat's own shelf names off a Scottish order form and they do not always
     describe their contents — `Baking` on that form holds BBQ sauce, beetroot
     and a big bag of rice. A confident foreign word that is wrong about what
     sits under it is worse than leaving it English, and a shop picks by item
     name regardless.

     **The language lives on the LIST**, not in a picker that resets — a trip
     landing in Hanstholm lands there every time it is opened, and a cook
     filling in Danish names should not re-choose it each visit.

     **The sheet says what did NOT translate**, by name, at the foot:
     *"Printed in English — no translation on file: Butteries, Softies, …"*.
     A half-translated order that does not say so is the failure worth guarding
     against: the cook believes the list is ready and the first anyone knows is
     a short delivery.

     The unit column prints the supplier's word and the **key at the foot
     carries the English** — `dusin = dozen · pakker = packs · kasser = cases` —
     because that column is too narrow to hold both. Same rule, different shape.

     The CSV gains an `Item (da)` column rather than replacing the English one,
     so a spreadsheet of it is still readable on the boat.

     **Two things only rendering the page could have found**, which is why
     `scripts/stores-lang.mjs` exists and reads the PDF back:
     - Inline heads (`ANTAL / QTY`) **wrapped** in the two narrow columns and
       came off the page as `ENHED /` over `/ QTY` — worse than either language
       alone. The English is now its own head ROW. Plain head rows repeat across
       a page break perfectly well; it is only a **colSpan** head that does not.
     - Norwegian `ANTALL` wrapped to a stray `L` in a 38pt quantity column.
       Widened to 46.

  4. ~~**The butchers shape** — breakfast / cold meat / meals for N.~~ —
     **BUILT Aug 2026.** `SECTIONS` and `BUTCHER_SECTIONS` in
     `catalogue.js`, `sectionsOf()` / `unitCell()` in `exportStores.js`,
     `section` and `pack_size` on both `stores_list_items` and
     `stores_items` (applied).

     **The butchers order is not the shelf order.** David's three real notes
     (25-07, 17-08 and one other) all run **breakfast → cold meat → meals for
     N**, because that is how the butcher works through it. A flat alphabetical
     list of 27 cuts is a different document to the one he is used to being
     handed. The screen shows the same runs the sheet prints, since a cook
     checking his order against a shape that only exists on the PDF is checking
     the wrong document.

     **All 27 cuts ship filed** — 7 breakfast, 7 cold, 13 meals. Unlike a
     translation, being wrong here costs little: a line under the wrong heading
     is still a line the butcher reads, and an unfiled order is 27 ungrouped
     lines, which is worse. Correctable per item, and the correction sticks.
     Nothing outside BUTCHERS carries a section, asserted by test.

     **An unfiled line sorts LAST, never first.** It is something nobody has
     filed yet, and burying it above the headings that were chosen deliberately
     would be the wrong way round.

     **"MEALS FOR 11" is the crew count**, from `crew_aboard_count()`, never
     typed. It went 10 to 11 between July and August when Gundarovs joined and
     nobody would have remembered to change it.

     **A quantity is a number, a unit AND a pack size.** The same order has read
     `bacon rashers 30x8`, `x8 20 Bacon Rashers` and `pork sausages 16 x 5`
     across three trips — seventh instance of the pattern after `crew_ranks`,
     fuel suppliers, vessel labels, buyer names, the quantity notation itself
     and the units: **anything typed rather than picked will drift.**
     The sheet prints it in the unit column as `30 | packs × 8`, which is
     exactly what the paper note means and needs no translation — `pakker × 8`
     in Danish. **Pack size ships BLANK**: the 8 is this boat's arrangement with
     this butcher, not a property of bacon, and guessing would put a number on
     an order nobody chose. **0 and blank both read as "not set"**, or the sheet
     says `packs × 0` and the butcher sends nothing.

     **A bug only rendering caught, and the same class as the stage-1 footer.**
     `startedOn` was captured once per CATEGORY, so every section's table
     compared itself to the page the category opened on: page 2 carried
     **"BUTCHERS (continued)" stamped three times on top of itself**, while COLD
     MEAT and MEALS — which had started on that page perfectly naturally — both
     claimed to be carried over. It is now per SECTION, and a carried run names
     itself (`BUTCHERS — Breakfast (continued)`) rather than leaving the
     butcher with a tail of sausages under a bare shelf name.
     `scripts/stores-butchers.mjs` asserts it: at most one continuation
     heading per page, and it must name the run.


  ### The export is the feature, not a nicety

  **The supplier has no login**, so a stores list that cannot leave the app is
  a list nobody can fill. `src/lib/stores/exportStores.js` — PDF to send or
  print, CSV (with a BOM, so Excel opens it as UTF-8) for anyone who would
  rather have a spreadsheet. Both group by category in the **paper form's own
  order**, never alphabetically, so a shop picking from it walks its shelves
  once.

  **`buildStoresDoc` is split from `exportStoresPdf` on purpose.** `doc.save()`
  reaches for a browser and does **nothing at all** under node — no error, no
  file. That had me re-reading a stale PDF off disk across several runs and
  believing a page-break fix that had never executed once. The build half
  returns the document, so `scripts/stores-preview.mjs` renders the REAL sheet
  and reads it back with pdf.js rather than checking a copy that can drift.
  Same reason `SheetBody` is exported from `MarketSheet.jsx`.

  **One autoTable per category, and the category heading is drawn by hand.**
  `showHead: 'everyPage'` does not repeat a **colSpan** head row, which was
  found only by rendering: page 2 opened on a bare `12 | Toilet Rolls` with
  nothing above it to say what shelf that was. On a sheet whose entire job is
  being picked from by somebody in a shop, an orphaned line is worth the few
  lines of code. A carried category now repeats as `BAKING (continued)`,
  asserted **by position** — the heading's baseline must sit above every other
  item on the page, not merely be present in the content stream.

  **The footer is stamped once per PAGE after the loop, never in
  `didDrawPage`** — that hook fires once per *table*, and with one table per
  category it printed eight copies of the footer on top of each other.

  `test-stores.mjs` (105 checks) covers the catalogue, the merge, the shelf
  order, the page break and the translation rules; `scripts/stores-preview.mjs`,
  `scripts/stores-lang.mjs` and `scripts/stores-butchers.mjs` are the rendered
  checks — the second reads the
  PDF back and asserts every translated word has its English beside it.

  **All four stages are built.** What is left against stores is whatever
  the boat asks for after using it.

  **ONE LIST, ONE ORDER** — David's call. Items carry no supplier and the list
  prints whole; splitting the butcher's part off is done by hand as now.

  **THE COOK ROLE IS THE DANGEROUS PART, and it is deliberately not in stage
  1.** `user_role` has no `cook`, so it is an enum change plus an `is_cook()`
  twin of `is_officer()` plus `CREATABLE_ROLES` in `manage-users.js`. The trap
  is the deny loop: every permissive policy in this database is
  `to authenticated using (true)` with only the restrictive fleet check beside
  it, so **a brand-new role sees everything in its fleet by default**. The cook
  must be denied by the same generated allow-list, and that loop only touches
  tables outside its own list — the exact order-of-operations that shut
  officers out of crew certs once already. Prove it by probe, not inspection.

  **`meals_for` comes from a SECURITY DEFINER function returning the aboard
  count**, so the cook gets the number without being handed the crew table.

  **Translations ship BLANK and print English when missing.** Do not machine-
  translate the catalogue: better an English word the supplier queries than a
  confident wrong Danish one on an order that has to be right before the boat
  sails.

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
- ~~**Familiarisation** — 42 items in Aegir.~~ — **BUILT Aug 2026.**
  `Familiarisation.jsx`, `familiarisation_items` (42 rows) +
  `crew_familiarisation` + `crew_familiarisation_items`. Three categories,
  everything visible at once because the point of the page is the ticking, and
  BOTH signatures recorded — a familiarisation nobody signed is not evidence of
  anything.
- **Dedicated pair-team fish sales analysis.** Sandy and Gavin tow one net
  between two boats: sum gross and boxes, never sum days at sea (both boats
  fished the same days, so the pair rate is pair gross ÷ the trip's days),
  never combine crew shares or quota. Blocked on the vessels schema.
- **Certificate reader** — firm it up; store the original photo/PDF against
  each certificate as Aegir does.

Explicitly NOT wanted: hours of rest, PLB tracking, crew schedule (the rota
planner covers it), inspection pack, AI audit, and Aegir's own landings page.

## Trip rates — `Trips.jsx`, `src/lib/tripAgg.js`

`/trips`, under Sales. What each trip made **per day at sea**.

**Called rates and NOT profit, deliberately.** There is no cost against a trip
anywhere in this database: not one entry in `vessel_fuel_log` carries a price
(the `price_per_litre` and `total_cost` columns exist and are empty), and a
settlement covers a *run* of trips rather than one. A profit figure here would
be invented. Gross per day at sea is the honest number and is the one asked
for. Fuel is shown as **litres**, estimated at 5,846 L/day, and labelled as an
estimate.

### THE UNIT IS THE TRIP, NOT THE LANDING

This is the whole point of the file. A trip lands more than once — a few boxes
at Ullapool on the way past, then the trip proper at Peterhead — and **every
one of those landings carries the whole trip's days at sea**:

    120 landings · 51 within 3 days of the one before
                 · 37 of those carrying an identical days_at_sea
    they collapse to 72 real trips, 42 of which landed more than once

So dividing a landing's gross by its own `days_at_sea` counts the same days two
and three times. Measured on Audacious's real record:

    per LANDING (wrong)   £12,049/day over 767.25 days
    per TRIP   (right)    £18,976/day over 487.17 days

**280 phantom days, and a 57% understatement.** It also makes a one-box call at
Ullapool read as a catastrophic £12/day trip when it is half an hour's work
inside a good one. An earlier draft of this analysis reported the £11,951
figure as fact; it was wrong for exactly this reason.

**The trip boundary is REAL, not inferred.** `quota_trips` carries `trip_nr`,
`departure_at` and `arrival_at` straight off the logbook export — 167 trips for
Audacious with both dates, back to 2022, and **all 120 sales landings attach to
one**. Worth insisting on: the settlement solver has to infer its boundaries
because the office does not supply them, and it is the hardest code in the
repo. Here the answer is already recorded, so inferring would be inventing a
problem.

A landing matches the trip whose **arrival** is nearest, within one day before
and three days after — a note is dated when the fish hits the market, never
before the boat sailed. Nearest arrival wins, so back-to-back trips do not
steal each other's landings.

**Days come from the logbook; the typed figure is reported, never resolved.**
13 of the 72 trips differ by more than a day and the page shows both — which
one is wrong is the skipper's call, not the code's.

**Nothing is ever dropped.** A landing with no logbook trip is listed as
unattached rather than silently left out of a rate. `scripts/trip-check.mjs`
asserts the three things that matter on real rows: every landing placed exactly
once, gross reconciling against the raw rows, and no trip counted twice — a
trip aggregator that quietly loses a landing produces a plausible wrong number,
which is the worst kind.

**Pair teams are correct by construction.** Gross and boxes sum across the two
boats; days are the *trip's* single figure and are never summed, because both
boats fished the same days.

The headline is total gross over total days, **not a mean of the trip rates** —
a two-day run must not weigh the same as a nine-day one.

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
adding any table** — and `supabase/cook_role.sql` in the same breath, since
Aug 2026 there are TWO generated allow-lists and a new table is denied to
neither until both are re-run. Same machinery, different lists.

Note the officer file carries the allow-list THREE times — the deny loop, the
2b cleanup, and the writes policy — and all three must gain a new table or the
result is a table he is allowed but cannot write, which looks like nothing at
all going wrong.

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
- **BUT NOT THE SAME EMAIL TO EVERYBODY** (fixed Aug 2026). It rendered one
  message per fleet and posted it to all of them, so `crew_bonus` alerts —
  *"Bonus 4500.00, paid so far 2250.00, still to pay 2250.00"* — went to the
  engineer every morning. An officer is **denied every money table at the
  database**, and that denial is the entire reason the role exists rather than
  handing out a skipper login; the digest walked straight around it.
  **RLS cannot catch this**: the digest runs on the service-role key by
  necessity, so BOTH boundaries have to be written down and both live in
  `planDigest()` — the one pure function that decides an address.
  **Fleet is the other one.** Every vessel is a separate business; Sandy has no
  business knowing what Colin's notes are worth, and a mail that named another
  boat's figures would be a data-protection problem, not just a bug. Covered by
  test, including that the two compose (an officer of one fleet gets his own
  fleet's alerts and no money).
  `TYPES_FOR_ROLE` mirrors
  `officer_role.sql` — an officer gets the logs, the maintenance and the crew
  paperwork, and nothing to do with money. The email is now built per
  recipient, and a reader with nothing to act on is sent nothing at all rather
  than an empty digest. An unlisted role gets **nothing**, failing the same
  direction as the nav guards. `test-digest.mjs` covers it.

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

### RLS speed: MEASURED, and there is no problem — don't rewrite the policies

Aug 2026. 174 of 314 policies in `public` call `current_fleet_id()` /
`current_user_fleet_id()` / `current_user_role()` / `auth.uid()` **bare**,
rather than wrapped in a scalar subselect. That looks like the well-known
Supabase trap where a per-row call is re-evaluated for every row, and it was
about to be "fixed" across all 174.

**Benchmarked first, as a real skipper session with RLS applied, and the
rewrite is unnecessary.** All 56 tables carrying a bare call, scanned in full:

    56 tables swept · ONE over 100ms · two over 50ms · 574ms for all of them
    market_prices 44,152 rows  6.3ms      sales_rows 8,260 rows  5.0ms
    Buyer League join 8.5ms                grouped 13.8ms

The reason is simple and checkable: **all six helper functions are `STABLE`**,
so the planner already hoists them out of the per-row loop. The subselect is
belt-and-braces, not a fix.

The one outlier — `audit_log` at 102ms — is a **cold first touch**. Warm it is
12ms across three runs.

So the 4,249ms → 8ms incident that made this look urgent was specific to that
policy and that plan shape, not a general property of bare calls. Rewriting
174 security boundaries for no measured gain is risk without benefit. **If it
is ever revisited, benchmark first** — the sweep above is the query to re-run.

### What was actually slow: the dashboard generated alerts on every load

`pg_stat_statements` named it, and it was nothing to do with policies:

    generate_alerts()   573–931ms mean · 495 calls · 283 SECONDS total

`Dashboard.jsx` called `supabase.rpc('generate_alerts')` and **awaited it**
before the front page could show a figure. That was written when market alerts
had no schedule and only fired when somebody opened a page; they have run on
cron every three hours since Aug 2026, so it was doing the same work twice.
Removed — the badge reads what the cron already raised.

The rewritten generator is also cheaper at **417ms**, because it inserts far
fewer rows.

**The lesson is the method, not the number.** The RLS pass was recommended off
reading policy text and one remembered incident; the dashboard call was found
by asking the database what was actually slow. Read `pg_stat_statements`
before optimising anything here.

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

### The re-upload banner — `ReconcileBanner.jsx`, `supabase/reconcile_ack.sql`

A flagged note can only be fixed by the skipper who has it, so the notice goes
where he already is: **compact on the Dashboard** (seen at login) and **full on
Fish Sales** (where the upload button is). An email would only be a message
asking him to open the app.

**Driven by the data, so it clears itself.** Re-uploading re-parses and replaces
the rows in place; when the figures agree the row stops being flagged and the
banner goes. Nothing to remember to take down, and a note that breaks next
month raises it again with no code change.

**And it can be put to bed.** `reconcile_ack_at` hides a note that genuinely
cannot be got again — it does NOT clear `reconcile_ok`, which stays as the
record that the figures are not trustworthy. The ten P&J landings are
acknowledged in the migration with the reason on the row, because a banner
nagging a fleet about ten things nobody can act on is the same failure as the
29-alerts-a-day price stream.

Shows on first run: Beryl 4 · Boy Andrew 3 · Boy John + Rosebloom 2 ·
Guiding Light 0 (10 acknowledged) · Audacious 0 (fixed).

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
  is what stops the next sales note reintroducing the variant.

  **Both ingest paths read it** — the CloudMailin webhook and the browser
  upload. `src/lib/buyerAliases.js` holds the matching and **both import it**;
  it was written out twice inline, which is the same drift this file warns
  about everywhere else. esbuild bundles it into the Netlify function, and
  `test-buyers.mjs` covers it against the four real merges.

  **It is NOT in `parse-core`, deliberately.** The aliases are per fleet and
  live in the database; parse-core is a pure library that must stay byte-
  identical across two repos. Applying them in the ingest layer, where the
  fleet is known, keeps both properties — so this needed no version bump.

  Two things the tests pin down. **A near miss is never guessed at**: "J
  Smithson" stays "J Smithson", because welding two genuinely different firms
  together is not recoverable from the note afterwards. And **one fleet's merge
  never reaches another** — in the webhook that filter is explicit, because it
  holds the service-role key and RLS is not scoping the read the way it does in
  the browser.

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
