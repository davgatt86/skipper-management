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

### Settling sheets arrive by email (Aug 2026)

David: *"settling sheets. they get emailed to me now. setup auto sending to page
like the fish sales sheets."* Don Fishing send them — usually Morna, *"but it
might not always be from morna"*.

**IT IS THE SAME ADDRESS AS THE SALES NOTES.** No new CloudMailin route, no new
Gmail rule beyond forwarding. `emailsFrom()` pulls every address out of the
envelope AND the headers and tries exact matches across all of them before any
domain rule, so David's own address resolves the fleet whether Gmail rewrites
the `From` or preserves Morna's. Who actually sent it is recorded on the row and
is never a gate.

**A SETTLING SHEET IS TOLD APART BY HAVING NO TEXT AT ALL.** Every one checked
carries **zero fonts** — they are photographs of a printed sheet, which is
exactly why the app reads them with a model instead of a parser. Measured: three
real settlements extract **0 characters**, against 3,005 for the sample note and
16,561 for a real Don note. So the rule is a text-length floor, not a word
match — there are no words to match, and matching the sender would break the
first time it is not Morna.

**THE SHEET IS FILED, NEVER SAVED, AND THAT IS THE WHOLE DESIGN.** A sales note
is parsed and reconciled against its own printed total, so the webhook can file
it and be sure. A settling sheet is read by a model, and the review screen
therefore shows each total TWICE — as printed and as the lines add up — with a
difference having to be acknowledged before saving. Auto-saving from an email
would walk straight round that check. So the arrival lands in `su_inbox` and
stops; the skipper opens it and it runs through **the same `read()` path** as a
hand-uploaded file, review screen and all. What is removed is hunting for the
attachment, not the checking.

`supabase/settlement_inbox.sql` (applied). `parseDocuments` gained
`existingPaths` so a sheet already in the bucket is not uploaded a second time —
a duplicate object per arrival, against a 1 GB allowance that also holds every
settlement document.

**One row per ARRIVAL, not per settlement.** The same sheet emailed twice lands
twice and both show; deciding they are the same document is the skipper's,
because `su_settlements` is unique on (boat_id, reference) and the reference
only exists once the sheet has been read.

### The weekly INVOICE bundle — `/invoices` (Sep 2026)

David: *"i get them scanned and emailed to me every monday by denise nicolson
don company ... catagorise them by type, supplier, monthly, quarterly,
annually"*, then *"splitting is what we want, do whatever it needs to have it
split by supplier"* and *"just reporting periods. annual is most important."*

**Measured off twelve real emails and one opened bundle, not assumed.** Every
Monday from `denise.nicolson@donfishing.com`, subject *"Audacious invoices for
approval"*, **ONE pdf holding the whole week**, 0.7–2.3 MB, named by the scanner
clock (`20260831082919614.pdf`). The 20-07 bundle probed: **0 fonts, 4
DCTDecode images, 5 pages, ZERO characters of text.** A photograph, exactly like
a settling sheet.

**WHICH IS THE THING THAT WOULD HAVE BITTEN.** `classifyKind` treats *no text at
all* as meaning settling sheet, deliberately — a settling sheet has no words to
match and the sender is never a gate. An invoice bundle is also zero characters,
so forwarding these to the same address would have filed every one as a settling
sheet.

**The separator is the SUBJECT**, and it is clean across every real email of
both kinds: Morna writes *"Audacious Settling"*, Denise writes *"invoices for
approval"*, never once the other's word. **The test is one-directional on
purpose** — only a subject saying INVOICE is diverted, everything else falls
through as before. So a strange subject does what today already does and a
settling sheet cannot be lost by the change, which is the direction to fail in.

**`su_invoices` ALREADY EXISTED**, found by the first migration failing on a
missing `fleet_id` — `create table if not exists` had silently skipped a table
already there with a different shape. It carries **four real Audacious invoices
from July 2026** with their files, and comes from outside this repo, almost
certainly `square-up-fleet-settlements`. So `supabase/boat_invoices.sql` is
**additive only**: nullable columns, nothing renamed or dropped, because that
app may still be writing to it. There is no second invoices table, which is the
outcome worth having — two tables for one idea is the parser-copy failure again.

Added: `su_invoice_batches` (one row per email) and `su_invoice_suppliers`.
`batch_id` is **ON DELETE SET NULL**: deleting a bundle must not take the
invoices read out of it, because the cost stood whether or not the scan does.

**THE SUPPLIER LOOKUP EXISTS BEFORE ANYTHING READS A BUNDLE.** Splitting by
supplier is worthless if one firm arrives under four names, and these names come
off a MODEL READING A PHOTOGRAPH, so they drift harder than anything typed.
Ninth instance of the pattern. The fuel log already holds seven spellings of one
firm across 559,938 litres — and one of those four existing invoices is
`John A Smith & Sons`, an eighth. Filing it once catches every one of them,
asserted by test.

`normaliseSupplier` collapses case, the ampersand, the apostrophe and a
**trailing** company suffix (Ltd/LLP/A/S — a leading "Ltd" is part of the name).
It deliberately stops short of welding singular onto plural, and **never guesses
a near miss** — "J Smithson" stays "J Smithson", the same rule `buyerAliases`
follows, because welding two firms together is unrecoverable once the invoice
that would tell them apart is filed under the wrong name.

**THE MANAGER'S BALANCE is captured off the prose**, and exists nowhere else in
this app. Denise states it every week — twelve readings from mid-June, one of
them **£113k THE WRONG WAY** after a £336,668 scientific quota adjustment. The
sentence is stored beside the number because the reading is a regex over words a
person typed; the direction is read separately and an unstated one says
*unstated* rather than assuming "to the good".

**The page is three tabs in the order things happen** — Arrivals, Check the
read, What it cost — because the middle one is a step, not a place. Nothing
saves without being looked at, and net + VAT disagreeing with the total is
**reported**, never resolved, the same rule as the settlement review. A firm
nobody has filed is grouped and counted, not asked about once per invoice.
Reading a bundle again **replaces** what came off it, scoped by `batch_id` so
the four rows that predate this survive.

Periods are a way of LOOKING at costs, never a tag on a firm — a supplier that
is annual this year and a one-off next would make the tag a lie. The year start
is a **setting** (the office closes this boat's quarters on 30 June) and a
non-January year labels itself `2026/27` rather than a bare 2026.

`test-invoices.mjs` 67 checks · `scripts/invoices-preview.mjs` runs the real
report over the boat's real four invoices — 2026 totals **£7,128.05**, Jackson
Trawls 73% of the year.

### TEN YEARS ARE THREE BOATS, all called AUDACIOUS BF83 (Sep 2026)

The record loaded out to **2,624 invoices, £7,910,338, 153 suppliers, 2016–2026**
— far more than the weekly bundles, because the Gmail search reached back to an
older office scanner (`SKM_C3350…`). The dates were checked and are genuine: the
2017-11-07 bundle holds invoices from Aug–Oct 2017.

David: *"oldest boat was sold aug 2018 / pair/single went into service oct 2018
but invoices for that boat could be from spring 2018 onwards / pair/single was
sold july 2022 / twin trawler in service oct 2022 but invoices from summer 2022
could be for the twin vessel."*

Same name, same registration, three hulls fishing three different ways — so
comparing 2019 gear spend against 2025 was comparing two boats.

**THE DATE PLACES AN INVOICE EXCEPT ACROSS A CHANGEOVER.** A boat is fitted out
before she fishes and her bills arrive months ahead of her, so two windows are
genuinely undecidable: **spring–Aug 2018** and **summer–Oct 2022**.
`src/lib/invoices/vessels.js`, `su_invoices.vessel_era` for the override.

**THE PROOF IS THE FIFTH BIGGEST SUPPLIER.** Etablissements BOPP Treuils JEB —
**£616,200 of winches** — is invoiced 28-05-2018, four months before the
pair/single entered service and while the old boat still fished. Date alone put
six hundred thousand pounds on the wrong hull.

An invoice in a window is **flagged, never guessed quietly**: offered to the boat
that was IN SERVICE, because routine running costs are the common case and there
are far more of them, with the other hull named beside it and one tap to move it.
Ordered by money — £616k of winches is worth deciding, a £40 box of gloves is not.

**Settling six of them moved £751,000.** The old boat went from £928,493 to
£178,306; the pair/single from £1,997,364 to £2,740,745. His calls: BOPP and the
£132,750 Don Fishing quota rent to the pair/single, PBP's gas-freeing to the old
boat, Kinnaird's Reykjavik flights to the twin, and the Beko white goods to the
pair/single — *"replacing before selling"*, which no rule would have guessed.

**A DECISION AND A DEFAULT MUST NOT READ ALIKE.** The ones that agreed with the
default were written explicitly anyway; that is what takes them off the
undecided list for good.

85 invoices worth **£51,740** remain on the default. They read as ordinary
running costs of whichever boat was fishing, and each is pennies against £8m —
chasing them would cost more attention than the answer is worth.

### CATEGORISED — 151 of 153 firms, £8,057,344 of £7,910,338 (Sep 2026)

The suggester placed **136 of 153** off the name and what each firm had sold;
David settled the rest. The shape of ten years:

    gear 26% · quota 18% · shipyard 16% · hydraulics 13% · engine 10%
    electronics 9% · electrical 3% · everything else 1% or less

**THREE OF THE TOP TWENTY-FIVE WERE HELD BACK ON PURPOSE**, and one of them was
plainly wrong: **Lockers Trawlers & Jacinta**, £52,800, suggested as *Fishing
gear* off the word "Trawlers" in a fishing company's name — on an invoice
reading *"Lease 20tn N/S Cod and 20tn N/S Saithe"*. Pure quota. The name-beats-
descriptions rule is right for Jackson Trawls and wrong here, and no ordering
fixes both. That single row is the argument for suggest-never-apply written out
in full.

Inverboyndie (£1,019,054) and Don Fishing (£776,586) were held for the opposite
reason — both genuinely sell several things — and David confirmed gear and quota
respectively, with the odd invoice to be moved individually.

Two firms remain unfiled, worth **£980** between them.

**NEWBUILD FIT-OUT IS AN EVENT, NOT A TRADE**, and it is the twentieth category
because of one order. BOPP is £616,200 on a single day in May 2018 — winches,
windlass, cabling, Scantrol, panels — for a boat that had not yet fished. Split
across the trades it swamped three of them: hydraulics read **£1,026,143** when
this boat's real hydraulic spend over ten years is **£409,943**, and nothing on
the page said why. David: *"make it's own category. bopp for new vessel fit
out."*

**Nothing is ever SUGGESTED into it.** A fit-out is known by when it happened
and what it was for, never by a word on the invoice — a *treuil* is a winch
whether it goes on a new boat or an old one. The suggester still reads BOPP as a
winch firm, which is what it is; only the skipper can say that this particular
order was a new boat.

**AND THE PER-INVOICE OVERRIDE WAS MISSING THE WHOLE TIME.** `su_invoices` had
no `category` column: it was in the first draft of `boat_invoices.sql` and lost
when that file was rewritten to be additive after the table turned out to
already exist. `categoryOf()` falls back to the supplier's category, so nothing
ever errored — every invoice simply took its firm's, and the override the page
offers and these notes describe silently did nothing. Found only by trying to
use it. **A fallback that works is a good way to hide a missing column.**

**PAGE NUMBERS — DONE Sep 2026, AND THE EDGE FUNCTION IS IN THE REPO NOW.**

`supabase/functions/su-parse-document/index.ts`. **It had never been in version
control**: the prompts deciding how every settling sheet and every invoice is
read lived only in the Supabase console, so they could not be diffed, reviewed
or rolled back — the same shape as the second parse-core copy that ran 1.2.1
against this repo's 1.3.2 for months. Change it HERE, then deploy.

A bundle averages **8 pages and 7.2 invoices**, so "open the scan" meant eight
pages to hunt through. The reader now returns `page_from`/`page_to` and the
review row opens the document at them (`openDocument`, a `#page=` fragment —
where a viewer ignores it the document still opens at the top, which is exactly
what the button did before).

**THE PAGE IS THE ONE FIELD NOTHING DOWNSTREAM CAN CHECK.** The net, the VAT,
the total and the supplier are all printed on the invoice and can be read back;
which PAGE it was on is answerable only by whoever read the bundle, and asking
again costs another read. So a page it is unsure of comes back **null** — a
wrong page opens at the wrong invoice and looks certain doing it. Checked twice:
in the function against the `page_count` the client read off the PDF with
pdf.js, and again in `src/lib/invoices/pages.js` on save. **Nothing is clamped
or swapped** — which of two numbers is wrong is not knowable, so an impossible
range is dropped whole.

**`Number('') === 0` again, fourth time**, after the engine running hours, the
gear measurement in mm and the invoice VAT. `intOrNull('')` returned **0**, so a
blank page box would have filed as **page 0** — a page that does not exist,
saved as though someone had read it off the scan.

**AND RE-READING A BUNDLE WOULD HAVE DESTROYED £751,000 OF DECISIONS.** Saving
deletes and re-inserts every invoice off a bundle, which is right — but
`vessel_era` and `category` are the skipper's answers to questions the invoice
cannot answer, and **102 invoices carry a vessel decision**. The ordinary reason
to re-read a bundle is now to pick up its page numbers, so the first use of this
feature would have quietly undone weeks of work. `carryDecisions()` lifts them
off and puts them back, matched on the invoice NUMBER, or on firm + total + date
where there is none.

**The firm in that fallback key goes through `normaliseSupplier`, and a test
caught why**: the name is the only part of the key that comes off a model
reading a photograph, so it drifts between two reads of the SAME document —
`Ironside & Son` came back `IRONSIDE AND SON` and a raw comparison lost the
decision. It would have failed silently and only on invoices with no number,
which are the hand-written ones. **An unmatchable decision is NAMED**, never
nudged onto the nearest row.

**The 2,624 invoices already filed carry no pages** and there is no way to get
them but to read the bundle again — 364 bundles, at real cost. Not worth doing
wholesale; a bundle can be re-read when an invoice actually needs finding, and
the decisions now survive it. Every invoice already stores `file_path`, so the
scan opens today, just at page one.

**Not yet proven on a real bundle.** The prompt change is deployed (v9) and the
two untouched prompts are asserted verbatim by test, but no five-page Monday
scan has been read through it — the page is behind a login. One bundle re-read
settles it.

### THE PAGE IS A DASHBOARD NOW — and three tabs were a conveyor (Sep 2026)

David: *"the arrivals/check/what it cost is almost like it was put there for
the initial upload. now we will be adding a pdf per week, it needs to look
better there too. invoice dashboard with a + invoice batch tab."*

**He was right about why it looked like that.** Those three numbered steps WERE
the initial load, when 364 bundles went in over a weekend and the whole page was
a conveyor. That is finished. What happens now is one PDF on a Monday and ten
years of costs to read the rest of the week — so the reading is the page, and
adding a bundle is a thing you do to it.

    The year   ·   All years   ·   Find an invoice   ·   + Invoice batch

`src/pages/invoices/` — `YearDashboard`, `AllYears`, `FindInvoices`, `shared`.
`Invoices.jsx` keeps the state and the handlers and is 1,191 → 1,026 lines.
**Nothing about checking the read changed**: the drop, the unread bundles and
the review are one flow in one tab, and a bundle is still never filed unlooked-at.

**THE SUPPLIER TABLE WAS RENDERING A ROW OF DOTS**, which is what started all of
this. `categoryMatrix` gave a CATEGORY its year cells and gave a SUPPLIER only a
total, so ten year headings sat above ten empty cells. **A missing figure and a
figure of nothing look identical in a table** — which is why it survived the
whole 2,624-invoice load. Merged across category rows, too: a firm appears under
two categories the moment one of its invoices is filed differently, and reading
it out of the first row would report part of a firm as the whole of it.

**AND ALL 364 BUNDLES CLAIMED TO ARRIVE ON 1–2 SEPTEMBER 2026.** `received_at`
defaults to `now()` and the backlog was uploaded over two days. Recoverable only
because `gmail-attachments.gs` prefixed each file with its email date: **363 of
364 restored, 2017-02-27 to 2026-08-31** (`supabase/invoice_arrival_dates.sql`).
The one with no prefix keeps the upload date and is honestly wrong rather than
dishonestly plausible.

#### WHEN THE WORK WAS DONE, which is not when it was billed

David: *"although it was received in 1 batch from him, the actual works spans
multiple years. is it possible to put the work done into relevant year not when
invoice was received."*

**THE CASE IS WORTH £397,271.** Trevor McDonald (Marine Engine Services) — the
eighth biggest supplier — sent seven invoices, every one dated 5–8 October 2025:
a turbocharger failure, a MAK M20 major overhaul, an annual maintenance, an air
starter. Billed in a lump, so **30% of the whole of 2025** (£1,312,459) lands on
two days from one firm, and whichever years that work was really done in are
understated by the same amount.

**THREE DATES, THREE DIFFERENT FACTS** — received, invoiced, worked.
`su_invoices.work_from` / `work_to`, both nullable, **null means use the invoice
date**, so every one of the 2,624 already filed reads exactly as before.

**A DATE IS A FACT AND A SPREAD IS AN ASSUMPTION**, so they are kept apart. One
work date lands the cost WHOLE in its year — which is the common case, because
each of those seven is one job with one date. Only a stated SPAN is divided, only
pro rata by days, and the grid reports how much of a year is apportionment rather
than reading. Spreading an overhaul evenly across three years is an invented
distribution; inventing one where a date exists would be the worst of both.

`lumpBillings()` offers the ones worth answering — several invoices, one firm,
one day, real money, no work date yet — and one action answers the whole run,
because that is how it was billed. There is no point asking for a work date on a
£40 box of gloves. **Once answered it stops asking.**

`src/lib/invoices/when.js`, and the review row carries the two boxes so it can be
filled in where it is cheapest — the scan is open and the reader has just been
through it.

**AND THE READER ASKS FOR THEM (v10).** Typing them onto 2,624 invoices was
never going to happen, and a service invoice normally prints a job date, a
service period or dated worksheet lines.

**THE FAILURE MODE IS NOT A WRONG DATE, IT IS A COPIED ONE.** A model handed an
invoice carrying only an invoice date will put that date in `work_from`, and the
result is indistinguishable from a reading — every invoice would then have a
work date, the *dated by work* grid would be an exact copy of the billed one,
and nothing on the page would say why. So most of the added prompt is a negative
rule, and `fixWorkDates` drops a work date equal to the invoice date regardless:
where it is genuinely true it changes no year and costs nothing.

Same refusals as the pages — a span ending before it starts is dropped whole
rather than reversed, and a one-day span is stored as one date, because a date
is read and a span is divided.

**PROVEN ON THE REAL BUNDLE, Sep 2026, AND IT MOVED £300,500.**
`2025-10-13 20251013091108402.pdf`, 22 pages, 13 invoices. Read a second time
and filed:

- **pages 13 of 13**, covering 1–22 exactly — no gaps, no overlaps, in order;
- **work dates 10 of 13**, and **not one equal to its invoice date**;
- **£290,782 of engine work is 2023**, not 2025 — invoices 3098 and 3098b, four
  pages each, both worked Feb–Sep 2023 and billed on one October day two years
  later. £9,718 more is 2024. Trevor McDonald 2025 falls **£397,271 → £96,772**.

**THE WHOLE BOAT CHANGES SHAPE.** Billed, 2025 is the dearest year on record;
dated by work it is the cheapest of the three:

        billed   2023 £957,889 · 2024 £1,203,839 · 2025 £1,312,459
        worked   2023 £1,248,671 · 2024 £1,213,557 · 2025 £1,011,959

**IT IS READING, NOT INFERRING**, and two invoices in the same bundle prove it:
Fraserburgh Harbour states *"22/9/25-30/9/25"* and came back 22–30 September;
Don Fishing states *"01/10/25-31/12/25"* and came back as that quarter — a period
running PAST the invoice date, which nothing derived from the invoice date could
produce. The three blanks are the right three: two are materials (hose and
fittings, washers and studs), which have no work period.

**AND THE READER IS STABLE ACROSS TWO READS.** The same 22-page photograph gave
identical invoice numbers, suppliers and totals to the penny on all 13 — which
is exactly the key `carryDecisions` matches on, so a re-read is safe in practice
and not only by argument.

**AND 3098 / 3098b ARE ONE INVOICE — £147,985.99 COUNTED TWICE.**

David: *"i don't think 3098/3098b is different invoices. check lines to see if
they're exactly the same minus something to give difference."* He was right, and
nothing stored could have shown it: the app keeps a ninety-character description
and no line detail at all, so two invoices with the same summary are
indistinguishable however hard you look at the record.

`doc_type: 'invoice_lines'` reads an invoice's LINES (`LINES_PROMPT`, with an
`only` list so a 22-page bundle can be asked about two invoices rather than
thirteen). **56 lines each, and 53 identical word for word and penny for penny.**
The whole £5,190.00 gap is ONE line:

    Feb 2023, MES job No. 23-047 · Labour & Tvl · qty 8 · unit £72
      3098    £5,766      3098b   £576

**8 × 72 = 576.** 3098b is right and 3098 is a typo — a stray 6 on 576 — and
every other line's qty × price checks out on both. Both documents self-add to
their own printed total to the penny, so neither figure is a misread; they are
two issues of one invoice, the office numbering the correction `b`.

**3098 WAS DELETED 04-09-2026** on David's instruction. The boat's ten-year
record goes **2,625 → 2,624 invoices and £8,058,324 → £7,910,338** — the figures
quoted throughout this file were corrected in the same breath, because a stale
headline gets quoted back as fact.

**The reason is written on the BUNDLE, not on the invoice**, since the invoice is
what went. `su_*` carries no audit trail by design — it is written by an edge
function on the service-role key, where `auth.uid()` is null, so the trail would
record that nobody did it — which means a delete here leaves no trace of itself
and this one was £147,985.99. `su_invoice_batches.note` on that bundle now
carries the whole finding, and nothing references `su_invoices`, so the row went
cleanly.

**THE LESSON IS WHAT THE RECORD COULD NOT ANSWER.** A description good enough to
file a cost is useless for telling two costs apart, and the only reason this was
catchable is that the scan is still in the bucket and can be read again. Every
invoice storing its `file_path` is what made a £148,000 question answerable eight
months later.

**Filed by UPDATE, not by delete-and-reinsert.** The page does the latter and is
right to in general, but here both reads agreed on every number, so the only
real change was the pages and the work dates; updating in place adds those and
cannot disturb an id, a file path, a supplier link, a category or a boat
decision. The dates are undone with one `update ... set work_from = null,
work_to = null` on that batch.

#### The rest of the rebuild

- **A part year is never compared with a whole one.** 2026 is £693,796 against
  2025's £1,312,459 and the record stops on 26 August — side by side that reads
  as spending halving. Both windows are cut at the last invoice on record, and
  the page says which day. Never annualised either: this boat’s costs are lumpy
  enough that a projection would be wrong by more than the answer is worth.
- **A trade that STOPPED is the most interesting row**, and would not appear at
  all if only this year’s categories were listed. A category that is new has
  **no** percentage — nothing to something is not a percentage.
- **The three boats are compared per YEAR OF SERVICE.** Their totals ranked them
  by how long each sits in the record. The oldest boat’s figure is flagged: she
  was sold in Aug 2018 and the invoices start in 2016, so her window is where the
  RECORD begins, not where she did.
- **The grid is shaded, and scaled against the 90th percentile — not the max.**
  Found by rendering it: against the maximum, the £616,200 BOPP cell left one
  dark square and two hundred pale ones, a picture of the outlier rather than of
  the decade. Flattening the top costs nothing since the figure is in the cell.
- **Every cell opens the invoices behind it**, into the one search list with its
  filters visible and wideable. There was no way to see a single invoice
  anywhere on this page before.
- **Search across firm, number, description and amount**, terms ANDed. A term
  matching nothing returns nothing — "no invoice says that" is an answer.
  `split(/\s+/)` lost its backslash to a heredoc and split on the LETTER "s";
  every other search still passed because "scantrol" became "cantrol" and matched
  anyway. The regression test is `q: "sos"`, the query that tells them apart.

**AND THE ARRIVALS LIST NEEDED A WAY IN.** It was written when the tab held
the Monday arrivals and a handful of them; after the date backfill it holds **364
bundles going back to February 2017** in one flat run, so re-reading a particular
one meant scrolling past a decade. The recent twelve and anything unread show
without asking — an unread bundle is a job rather than a record and shows however
far back it is — and the rest are behind a search box that says how many it is
not showing. **The file name is rendered now too**: the search offers to match on
it, which is no use if you cannot see what to type, and for the 364 loaded by
hand the subject is a stub so the scanner file name is the only thing telling one
from another. `src/pages/invoices/Arrivals.jsx`, its own file so it can be
rendered without a login.

`scripts/invoices-page-preview.mjs` bundles the four real tabs and
server-renders them against a fixture shaped like the real record — 364 arrivals,
three hulls,
a lump billing, a job spanning a year end, an unfiled firm, an undated invoice,
a part-finished year — then reads the markup back. **A build passing proves
nothing here**: an undefined identifier is valid JavaScript, and this repo has
already shipped a commit where two pages called a function they never imported.

`test-invoice-dashboard.mjs` 59 · `test-invoice-categories.mjs` 50 ·
`test-invoices.mjs` 118 · `test-invoice-vessels.mjs` 45.

### THE GMAIL SEARCH WAS TOO NARROW, AND THAT IS WHERE THE HOLES CAME FROM

Found Sep 2026 by asking why 2020 and 2025 had no duplicates. 2025 turned out
complete and 2020 turned out to be Covid — the office stopped RAISING invoices
in the first lockdown and caught up on 19 May, which the Superintendent
Engineer's Fee proves: a standing £969 quarterly charge, Q2 2020 covering
01/04-30/06 but dated **19 May**, the day after the bundles resumed. A delivery
delay cannot move an invoice's own date; the office sets that when it raises it.

**BUT THE SAME METRONOME EXPOSED SOMETHING BIGGER.** That fee is on the record
for **20 of its 30 quarters**. 2023 is missing three of four while carrying 46
bundles; 2022 is missing half. The gaps have nothing to do with lockdown.

**THE CAUSE IS THE SEARCH THAT LOADED THEM.** `gmail-attachments.gs` v1 asked
for `from:denise.nicolson@donfishing.com subject:"invoices for approval"`, which
is the Monday bundle and nothing else. Three faults, all real:

- **The subject had to match that phrase exactly.** The office also sends single
  invoices as they arise and calls them what they are — *PBP Invoice for
  approval*, *Diving Invoice*, *Audacious VCU Invoice*, *Bremner Fishing - Quota
  invoice*, and *Audacious invoice for approval* in the SINGULAR. A heavy week
  gets split as *Audacious invoices - 3 of 3*, and only the parts whose subject
  happened to fit came through.
- **Only Denise.** Morna Grieve sends invoices too.
- **It deduped on the name it invented**, which begins with the email's date —
  so one pdf arriving twice was two keys. **That is exactly how
  `20221213090636545.pdf` got in twice**, 8 invoices and £25,931.95, caught nine
  months later by a duplicate sweep rather than at the door.

v2 searches the whole company, filters on a subject pattern that **fails towards
including** (a price sheet saved by mistake is deleted in a second; an invoice
never saved is a cost nobody ever sees), and keys the dedupe on the
ATTACHMENT'S OWN NAME AND BYTE SIZE. `origName_()` strips a date prefix left by
v1, so nothing already saved is fetched again. Both filters are asserted against
16 real subjects taken out of Gmail.

**RUN, AND A THIRD OF THE RECENT INVOICE MAIL WAS MISSING.** The first run
reached back fourteen months before the six-minute limit stopped it and found
**32 pdfs never saved, against 66 already there** — in the most recent stretch,
the part of the record most likely to be right. The `66 already there` is also
the dedupe fix working: it recognised what v1 had saved and did not fetch it
twice.

Two faults that run exposed, both fixed:

- **Three quarters of the time went on mail it threw away** — 725 of 966
  messages read were price sheets discarded on the subject. The subject test is
  now in the Gmail query as well as in code. The code test stays: it is the one
  under test, and Gmail's own word matching is not something to bet the record
  on.
- **It started at the newest mail every time.** Six minutes is not enough for a
  decade, so each run re-trod old ground before reaching anything new — the
  older a gap, the less likely any run would ever reach it, and **2017 might
  never have been read at all**. It keeps a cursor in `PropertiesService` now,
  backed off one page because new mail shifts the pages down, and clears it on
  reaching the end so the next run sweeps from the newest again.

**123 SO FAR, AND THE SWEEP IS NOT FINISHED.** Run 2, with the query narrowed,
read 856 office emails against 241 and discarded **1** on the subject rather than
725. It found **91 more**, back to 2021-06-01. The record stands at 364 loaded +
123 never loaded, with 2017 to mid-2021 still unread — a third missing, holding
steady across both runs.

**THEN THE THIRD RUN WAS KILLED AT SIX MINUTES WITH NOTHING WRITTEN DOWN**, and
the reason is the guard being checked in the wrong place. It sat between PAGES,
so a page of fifty threads of multi-megabyte scans ran straight through the
minute of headroom — and because the cursor is only saved by that guard, the run
recorded nothing and **the next run would have begun on the same page and died
in the same spot, for ever.** Only the files already written let it creep
forward at all.

The clock is checked per THREAD now, at 4.5 minutes, and the cursor is set to the
page being read rather than the one after it, since it is left half done.
Stopping mid-page is free — the dedupe means re-reading what is already saved
costs nothing.

**AND THE FIRST SIMULATION OF THAT FIX WAS WRONG IN THE SAME WAY AS THE BUG.**
It only applied the six-minute kill at page boundaries, so it reported the broken
version stopping cleanly. The runtime kills mid-page, wherever it has got to;
modelled properly, the old shape is killed on page 1 with no cursor and the new
one stops cleanly and resumes. **Checking a clock too rarely was the bug and the
test for it both.**

**THE SWEEP IS FINISHED, AND IT REACHES BACK BEFORE THE RECORD DOES.** Four runs,
ending *"Read right back to the beginning"*. At least **152 pdfs the app has
never seen** — and the earliest is **2015-04-24**, where the record starts in
2016 and its first bundle is 2017-02-27. A year of invoices exists that has never
been in the system at all. The true figure is higher: the run that was killed
saved files before it died and reported nothing, so its haul is in the folder and
in no log.

**Many of them are not weekly bundles**, which is the point — they are the single
invoices the office sends as they arise: `Faktura 22711.pdf`,
`SI201634907.pdf`, `Demande acpte 10463-2 The F.V. audacious.pdf`,
`Invoice 26919 from FRASERBURGH HARBOUR COMMISSIONERS`. A few are supporting
papers rather than invoices (`RIB ARKEA.pdf`, `FLTCS Bank Details.pdf`) —
the filter fails towards including on purpose.

**THREE MORE BUNDLES ARE IN THE APP TWICE**, found by comparing the Drive folder
against `su_invoice_batches`. Byte-identical files saved under two dates by v1's
broken dedupe — the same fault as the 13 Dec 2022 bundle, not the office
re-sending:

    SKM_C3350190117164400.pdf   17 + 25 Jan 2019   10 invoices   £3,414.66
    20211017095253176.pdf       18 + 21 Oct 2021    8 invoices  £10,466.54
    20211025054904217.pdf       25 Oct + 1 Nov 21   8 invoices  £13,954.30

Each pair agrees on page count, invoice count and value **to the penny**, and
carries no vessel or category decision, so one side of each can go cleanly.
**£27,835.50 counted twice.** Left in place — David: *"don't touch others till i
see them."* Note the 2019 and Oct 2021 pairs were previously filed under *office
re-sent* in the duplicate report; they are double LOADS, and the whole bundle is
the duplicate rather than individual invoices within it.

**AND THE KILLED RUN LEFT A FILE WITH NO DATE ON IT.**
`SKM_C3350170728085100.pdf` is the only file in the folder whose `createdTime`
and `modifiedTime` are identical, at exactly the second Google killed run 3.
`folder.createFile(att.copyBlob()).setName(name)` is **two operations**, and it
died between them — so the file exists under the scanner's own name and the
arrival date, the one thing that cannot be read back off the pdf, is gone.

Fixed by naming the BLOB before the file exists:
`createFile(att.copyBlob().setName(name))`. A kill now leaves no file at all,
which the next run simply fetches again — the recoverable failure rather than the
silent one. It is the same shape as the arrival dates defaulting to `now()`:
**a fact about when something arrived has one carrier, and if that carrier is
written second it can be lost.**

`collectWhatIsNew()` moves everything written after the backlog load into
*"New - to upload"*, so only the unseen files are downloaded — told apart by WHEN
THEY WERE WRITTEN, a fact about the folder, rather than by a list that could
drift. It names any file carrying no date instead of moving it quietly.
`have` now reads subfolders too, so sorting them out does not make the next run
think they were never fetched.

### AN INVOICE THAT IS ALREADY ON FILE — £240,015.96 counted twice

Swept out of the record Sep 2026 after 3098/3098b: **60 groups, 61 rows,
£240,015.96**. Not a reader fault and not a double upload — no two bundles even
share a file name. It is how the approval run works:

    Inverboyndie INV-0114, £34,971.60 dated 19 May 2023, is in the bundles of
    6 June, 13 June AND 19 June — three consecutive Mondays.

Denise re-sends an invoice in the following week's PDF until it has been
approved, which is correct of her, so the same cost arrives two or three times.
**38 of the 54 cross-bundle cases are 2-10 days apart.** Six more groups are one
bundle where the reader returned the same invoice twice. By year: 2022 £96,059 ·
2023 £79,796 · 2021 £25,284 · 2026 £21,973 · 2019 £8,699 · 2024 £5,747 · 2018
£2,457. **2020 and 2025 are clean.**

**THE PROCESS IS NOT GOING TO CHANGE, so the app catches it.**
`src/lib/invoices/duplicates.js`, flagged on the review screen before anything
is filed — the only item on the outstanding list that got worse while nobody
looked at it.

- **Matched on FIRM + NUMBER**, the firm through `normaliseSupplier` because it
  is the half that comes off a photograph: "Macduff Shipyards Limited" and
  "Macduff Shipyards Ltd" are both in the real record for one firm.
- **`certain` where the date and amount agree too; `similar` where they do not**
  — and those are NOT made to look alike. 3098/3098b was a reissue under the
  same number with one line corrected, and £147,985.99 turned on the difference.
- **A bundle re-read is not its own duplicate**, or every row of it would light
  up. `ignoreBatch`.
- **Checked against the same read too**, since six of the sixty were one bundle
  carrying an invoice twice — nothing is on file yet, so a database-only check
  misses them.
- **An invoice with NO number is never matched.** Guessing from amount and date
  would flag every routine repeat order, and a guard that fires on the ordinary
  case stops being read.
- **Reported, never refused.** The save is not blocked and nothing is dropped
  automatically; "Leave it out" is one tap and deletes nothing — reading the
  bundle again brings the row back.

**THE SUMMARY CONTRADICTED THE CARDS, and only rendering it showed that.** The
run header said *"Nothing flagged"* directly above a card reporting three of four
already on file. Two parts of one screen disagreeing is worse than either being
wrong alone: it is why nobody believes the summary again. The count is now made
across the whole run and duplicates are listed FIRST, because their answer is
"leave it out" and that makes every other flag on the row moot.

`Review.jsx` moved to `src/pages/invoices/` to be renderable at all — opening a
document arrives as a prop, since `signedUrl` and `openDocument` drag the
supabase client in behind them. It is the screen nothing is filed without, and
it could not be checked by anything but eye until now.

**THREE CAUSES, AND THEY ARE NOT ONE DECISION** — separated only by building
the report (`scripts/invoice-duplicates-report.cjs`):

    uploaded twice    8 invoices   £25,932   the 13 Dec 2022 bundle, MINE
    read twice        6 invoices   £21,548   one bundle, the reader doubled it
    office re-sent   47 invoices  £192,536   the approval run

**THE BIGGEST SINGLE CAUSE WAS MINE.** `20221213090636545.pdf` went into the
bulk load twice — once with the date prefix `gmail-attachments.gs` adds and
once without — identical file, 8 pages, 1,289,916 bytes, the same 8 invoices,
**nothing unique to either side**. It is also why exactly one bundle could not
have its arrival date recovered: the copy had no prefix to read it from. That
copy and its invoices were **deleted 04-09-2026**, taking the record from
2,624 to **2,616 invoices** and £7,910,338 to **£7,884,406**.

**THE INVOICES WENT FIRST, DELIBERATELY.** `batch_id` is ON DELETE SET NULL, so
removing the bundle on its own would have ORPHANED its eight rather than
removed them — they would have stayed in every total with nothing left to say
where they came from. The rule that protects an invoice when a scan is deleted
is the same rule that hides one when the scan is deleted on purpose.

**The office re-sends cluster into bundle PAIRS** rather than scattering: 05
Sep | 12 Sep 2022 carries nine of them, 17 Jan | 25 Jan 2019 nine, 18 Oct | 21
Oct 2021 seven. Consecutive Mondays repeat most of their contents.

**2020 and 2025 have none at all**, which is more likely to mean the bundles
for those years are missing than that the office stopped re-sending for two
years. Worth checking before reading anything into either.

**The remaining 53 rows and £214,084 are NOT removed** — David: *"don't touch
others till i see them."*

### THE AGENT GRANT IS A READ, AND A WORKSHEET WAS WRITTEN THROUGH IT

Found Sep 2026 while checking the fleet was ready for invoice forwarding.

`getWorksheetBoat()` read `su_boats` with **no fleet filter**, on the reasonable-
looking assumption that a login only ever sees its own. **That is false here, and
deliberately so**: `su_visible_boat()` is *my fleet's boat OR a boat I hold an
agent grant over*, and Audacious holds one over Beryl so the settlements
integration could be proven. So RLS returned **two** boats and `.limit(1)` took
whichever the planner offered — **Beryl's**.

**The worksheet was therefore filed against another business's boat**, and
`su_worksheets_visible` is `su_visible_boat(boat_id)`, so it was readable from
the other side. Probed as a real Beryl skipper login **before** the fix:

    BERYL sees worksheets 1, crew rows 14
    names: Alfie Reid, Andrew Smith, Barry Reid, David Gatt, David Henderson, …

Colin's login could read David's crew list, their shares, bonuses and bond.
Probed **after**, as both logins:

    AUDACIOUS: worksheets 1, crew 14, boats 2   <- 2 is the grant, working
    BERYL:     worksheets 0, crew 0,  boats 1

**THE LESSON IS THE DIRECTION.** The grant exists so David can SEE Beryl's
settlements come back. It must never decide where his own work is WRITTEN. Every
`su_boats` read that picks *the* boat now filters on `fleet_id` explicitly, the
way the ingest webhook already does with the service-role key. `Settlements.jsx`
is untouched: it lists every visible boat behind a picker, which is the grant
being used for exactly what it is for.

**Anywhere `.limit(1)` picks a row that will be WRITTEN to, the scope has to be
explicit** — RLS answers "may I see this", never "is this mine". The one existing
worksheet was moved to the right boat in the same breath.

**AND NOT ONE HAS EVER ARRIVED — `su_inbox` is EMPTY (checked Sep 2026).**

**CLOUDMAILIN REFUSES A MESSAGE OVER 512 KB.** *"552 Message size exceeds the
allowed size for this account (524288)"*. Morna's settling emails run **466 KB
to 1.26 MB** and the weekly invoice bundles **0.7 to 2.3 MB**, so both bounce —
and email base64 adds about a third on top of the attachment, which puts the cap
nearer 370 KB of actual PDF.

**A sales note is small, which is why the sales ingest has worked all along and
nobody found this.** The settling-sheet path was built in Aug 2026, verified by
probe at the database, and never once carried a document. The probe proved the
row would be filed correctly; it could not prove a message would arrive.

**The lesson: a webhook probed from the database end is only half tested.** Send
one real message through the actual vendor before believing a delivery path
works — the same class of hole as CloudMailin's outbound TEST MODE, which
accepts a digest and delivers nothing while the function log says "sent".

Two ways out, and the cheap one is built: **drop the file on the page**. Same
bucket, same reader, same review screen — only the delivery differs, and
`su-documents` has no size limit. Raising the CloudMailin plan would restore the
email route and costs money; the upload costs nothing and works today.

Probed: skipper sees his own fleet's arrival and not Beryl's, **officer 0, cook
0**, officer update affects **0 rows**. A settling sheet is money, and the
officer and cook are denied every money table — that denial is the reason those
roles exist.


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

### The worksheet had no read path — fixed Aug 2026

**Nothing ever opened a saved worksheet again.** `saveWorksheet` was written
first; `loadLatestWorksheet` returned only the HEAD — no lines, no crew — and
was exported and then called by nothing at all. So a sheet went into the
database and stayed there while the working copy lived in localStorage, gone on
a new device or a cleared browser though it was sitting in the table all along.
David: *"su_worksheets. i can't see / recall saved worksheets."*

`listWorksheets` / `loadWorksheet` / `deleteWorksheet` close it, with a kept-
sheets panel on the page. **Opening one asks first** — it replaces what is on
the form, and the form is the working copy.

**THE SHAPING IS SPLIT FROM THE IO** — `src/lib/su/worksheetShape.js`,
`stateToRows` / `rowsToState` — so save and load are two halves of one thing
that can be tested against each other without a database. That is the whole
reason the next two paragraphs exist.

**THE BOND WAS SAVED AS ZERO FOR EVERY MAN, ON EVERY SHEET EVER KEPT.** A bond
item is assigned by crew **id** — `BondSection`, `Preview` and `pdfGenerator`
all read `sumBondFor(items, c.id)` — and the save totalled on his **name**, so
it always matched nothing. Both worksheets in the database show it: fourteen
men apiece, `bond` zero on all twenty-eight. The page, the preview and the PDF
agreed with each other; only the column nobody could read disagreed. **It
survived precisely because the read path did not exist.**

**THE FIGURES ARE NOT RECOVERABLE FROM THE DATABASE.** Bond was never written
anywhere else — not as a worksheet line — and `su_*` is deliberately outside
the audit trail because settlements arrive on the service-role key. But the
WORKING COPY on the device still has the bond items (`squareup_trip_v2` in
localStorage), so the repair has to write the form over the kept sheet rather
than the other way round.

Hence **Keep over**, beside Open on each kept sheet. The two are opposites and
the difference is which copy you trust: Open replaces the form with the sheet —
which would destroy the only surviving copy of the bond — and Keep over
replaces the sheet with the form. The confirmation states the DATE, crew count
and bond total on both sides, because writing one trip over another's sheet is
how this goes wrong. It is the ordinary "same trip, I have changed something"
action too.

A sheet is marked **no bond recorded** when it carries crew and no bond at all.
Nought and never-recorded must not read alike.

**AND THE FORM NOW REMEMBERS WHICH SHEET IT IS.** `worksheetId` was not in the
working copy, so every save from a fresh page load minted a NEW worksheet —
which is why the fleet record holds the 12-08 sheet **twice**, saved 14-08 and
20-08 with identical lines and crew. The remembered id is validated against the
boat's real sheets on load: one deleted on another device is forgotten, so the
next save makes a new sheet rather than failing on an update that matches
nothing, hours after the thing that caused it.


**And the haulage note was discarded by a ternary that could not branch** —
`haulageNote?.trim() ? null : null`, both arms null.

**Four columns were waiting for inputs that were never made.**
`su_worksheets` has carried `trip_no`, `market`, `days_at_sea` and
`boxes_landed` since it was built, and `saveWorksheet` had always destructured
them out of its state — but the form had no such fields, so every sheet went in
with four nulls. They are on the Trip section now.

**What cannot come back, and the page says so before you load over live work:**
the vessel name. There is no column for it.

### The bond is kept ITEM BY ITEM now — `worksheet_bond_lines.sql` (Aug 2026)

It used to be each man's TOTAL, folded onto his `su_worksheet_crew` row, and
that lost two things. The breakdown, which was known and accepted — and an item
assigned to NOBODY, which was not: it hangs off no crew row, so it was written
nowhere at all and simply left the record on the first save. Same for a stores
bond.

David: *"some of the bond isn't allocated, if that is the problem, i want that
to roll over onto next worksheet + any new bond that's uploaded."*

**IT CANNOT ROLL OVER IF IT DOES NOT SURVIVE BEING KEPT**, so persisting it came
first. A bond item is a `su_worksheet_lines` row in section `bond`, with the
assignment in `detail`:

    crew:<sort>   the crewman at that position on this worksheet
    stores        the boat pays
    carried       unassigned, and it came off an earlier trip
    null          unassigned

**Assignment is by the man's POSITION, never his form id.** Those ids are minted
fresh on every load and mean nothing across one. A man with no name is not
written as a crew row at all, so bond charged to him has no seat to point at and
comes back **unassigned** — which puts it in front of somebody rather than
quietly charging whoever now sits at that index.

`su_worksheet_crew.bond` still carries each man's total as well, so a sheet kept
before this reads back exactly as it did: one line per man for his total. Bond
lines present means the sheet knows its own items; absent means it never did.

**ALLOCATED BOND CLEARS ON A NEW TRIP; UNALLOCATED BOND CROSSES.** It is bought
for a trip, so carrying a charged item would charge a man twice for the same
baccy — but nobody has been charged for an unallocated one, so clearing it does
not settle it, it loses it, and the boat is short by exactly the amount nobody
got round to assigning. It crosses marked `carried`, into its own group at the
top of the Bond section, because on a fresh sheet last trip's bottles must never
read as this trip's.

The kept-sheets panel names the figure too — *"£9.00 unassigned"* — since it is
the one thing on a kept sheet still owed a decision. It is **null, not zero**,
on a sheet kept before bond lines existed: how much went unassigned there is
unknown, not nought.

**AND THE KEEP BUTTON WAS BROKEN THE WHOLE TIME.** `onClick={keepWorksheet}`
hands React's click event in as the function's first parameter — which became
`existingId` the moment **Keep over** gave it one — so every save went looking
for a worksheet whose id was the event: *invalid input syntax for type uuid:
"[object Object]"*. The unallocated bond had nothing to do with it. `onClick={()
=> keepWorksheet()}`, and it is worth remembering that adding a parameter to a
handler can break a call site that passes none.

### TWO DOCUMENTS OFF ONE WORKSHEET, and they differ in exactly one way

David, Aug 2026: *"it would be good if bond lines saved per crewman, so if
there's any disputes i can reopen a saved sheet and see exactly what each
crewman had ... the exportable sheet doesn't need this info though, just myself
as skipper. office only needs to see total £ per crewman + any carried over
balance."*

**The skipper's view carries the ITEMS. The office's sheet carries the TOTALS
and must not carry the items.** `bondBreakdown()` in `helpers.js` is the single
function both rest on — the chalk sheet and the buyers' catalogue rendered
perfectly and disagreed with each other because the sale order was worked out
twice, and this is money. `scripts/kept-sheet-preview.mjs` renders **both** off
one state, reads the PDF back with pdf.js, and asserts that not one item
description reaches the office.

**LOOKING IS NOT OPENING, and until now there was only opening.** Open replaces
the form with the sheet — the wrong tool entirely for settling an argument about
a bottle of whisky three trips ago, because it destroys the trip being worked on
to answer a question about an old one. **View** (`KeptSheetView.jsx`) reads the
sheet and shows it, man by man with his items, the invoice each came off, and
the quantity. It touches nothing, and it says so.

It is a file of its own rather than a function in `SquareUp.jsx` for the same
reason `SheetBody` is exported from `MarketSheet.jsx`: the page is behind a
login, so the only way to check the real component is to server-render it, and
it cannot be bundled while it drags `supabaseClient` in behind it.

**CARRIED IS NOT UNASSIGNED**, though both are charged to nobody. A carried
balance came off an earlier trip and is an ordinary figure for the office to
read; an unassigned item is this trip's bond nobody has got round to charging,
and is a question. The PDF prints the first in ordinary ink as *"Carried over
(not yet charged)"* and the second in red as *"Unassigned (review)"*. Printing
them as one figure would turn every carried balance into a red flag, and a
warning that fires on the ordinary case stops being read.

**Bond charged to a man since taken off the sheet is counted as unassigned, not
dropped** — dropping it would leave the sheet quietly short of its own total.

`test-worksheet.mjs` — 62 checks, including that a second trip through changes
no figure, which is what makes the id keying safe: the ids `rowsToState` mints
have to be the ones `stateToRows` then totals on. `test-bond.mjs` 32 ·
`scripts/kept-sheet-preview.mjs` 40 rendered.


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

### The wrap ACROSS A PAGE BREAK — 1.3.5, Aug 2026

**A row that is the last on its page had its species tail wrapped onto the next
page, seventeen lines away.** 1.3.3 rejoins a species cell that wraps onto the
next LINE; when the row is the last on a page the tail lands after the page
total, the carried-forward line, the page number and the whole header block of
the page that follows:

    G&J Jack Seafoods Ltd Pollock 1.00 12 54.24 12 54.24   <- foot of page 11
    PAGE TOTAL 166.00 5,944 9,479.95
    CARRIED FORWARD 1269.25 45,787 150,756.02
    PAGE 11 OF 13
    ... eleven lines of page-12 header ...
    Lyth/GUT/A+2                                           <- head of page 12

Looking only at `i + 1` finds "PAGE TOTAL", gives up, and the row is dropped
exactly as before 1.3.3. **Found on the Audacious note of 28-08-2026** — one
box, 12 kg, £54.24, on a note otherwise out by nothing at all. After the fix it
reconciles to 0/0/0, 226 rows → 227.

**THE STOP CONDITION IS STRUCTURAL, NOT A LIST OF HEADER WORDS.** The first cut
whitelisted page furniture and failed on `NAME OF FISH SALES COMPANY` and on
the date `28-Aug-2026` — FISH and AUG were not in the list. That kind of
vocabulary rots: the next vessel name or month breaks it silently, which is the
exact failure this area keeps producing. A continuation always follows its own
row, so the search runs forward until either the tail turns up or **the next
line that parses as a real row** does. Page totals and headers parse as nothing
and are skipped without ever being enumerated. Bounded at 20 lines.

The continuation is **blanked where it lies** rather than stepping the cursor
over it: across a page break the lines between are real header lines that must
still be read for what they are, and `i++` would swallow them.

**Third silent-drop fault in this parser** after the wrapped row and the starred
price — same shape every time, a small negative diff on boxes, weight and value
at once, and invisible until someone reconciles a note against its own printed
total. `test-parser.mjs` carries the real page-break lines, including that the
search does not reach past a real row and steal its tail.


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

### THE MARKET IS NOT ONE SHAPE — Peterhead is three (Aug 2026)

`src/lib/market/markets.js`, `geometry.js`. Read off **`PD Market Layout.xlsx`**,
the sheet the market itself works from, and verified cell by cell rather than
transcribed: all 176 tiers agree with the drawing, and the floor comes to
**4,972 footprints**.

    NEW MARKET    tiers   1-77   3,537 fp   the ONLY area with a top and bottom
    CAFE CORNER   tiers  78-112    460 fp   no top, tiers of 14/12/8/14
    OLD MARKET   tiers 113-177    975 fp   no top, uniform 15

**The 21/26/47 model is true of 61 tiers out of 176** — the middle of the new
market and nowhere else. Tiers 1-6 are 18+26, 68-73 are 19+26, 74-77 are a
short bay of 20+14. **There is no tier 100**; the sheet skips it and so does
the model, because the number on the floor is what is called over the phone.

**THE NUMBER PRINTED ON THE SHEET IS BOXES, NOT FOOTPRINTS.** Every tier prints
at exactly twice its drawn squares — a standard tier draws 47 and prints 94 —
because the market counts a footprint as two boxes high. That is also why the
phone rule is `boxes ÷ 94`: it is one tier's worth. Confirmed with David.
**One run disagreed with itself, and the DRAWING was the one that was wrong.**
Tiers 84-112 are drawn 15 deep but printed 28, where 15 would print 30. I took
the drawing as the authority; David then gave the cafe corner as *"78/79 = 14
flat, 80/81 = 12 flat, 82/83 = 8 flat, 84-112 = 14 flat"*, so the printed 28
was right all along.

That matters beyond the 28 footprints. With 14 there, the printed number is
twice the real depth in **every run without exception** — a single exception
would have made the boxes-versus-footprints reading a coincidence rather than a
rule. `CAFE_DEPTH_UNCONFIRMED` records that it is his figure and that he is
checking it on the floor; the run is 28 tiers, so being one out is 28
footprints, most of two cafe tiers.

**IT IS OPT-IN.** No start tier means the uniform 21/26 the page always
assumed. Defaulting everyone onto the real floor would change every answer the
page has ever given. **All 15 real tallies come out byte-identical** on the
uniform path — tier count, mode, footprints, spare top AND bottom, lowered
grades, warnings and a full per-tier fingerprint of what sits where. That
regression is what makes the rest safe to change.

**IF THE SHOT LEAVES THE NEW MARKET IT IS LAID IN WALK ORDER**, and David's
four rules turn out to be that one rule. Past the new market there is no top
row, so "keep a clock top or bottom" has nothing to choose between — there is
one lane. Walk order is also exactly what he asked for: the clocks already run
cod, haddock, rough, flats, so laying them in sequence puts cod and haddock in
the new market using both its rows, then rough, then flats — and the flats are
what reaches the cafe. *"Entirely in the cafe, order has to be cod, hadd/whit,
rough then flats"* is the same rule with no top at all.

Without it the search kept assigning fish to a top row that stops existing:
**Trip 63 from tier 70 came out 43 tiers with 53 top places standing empty.**
It is 39 and none wasted.

**AND THE BOTTOM LANE CARRIES ON THROUGH THE JOIN.** David: *"unbroken run
across the join, but on the bottom. cafe is a continuation of the bottom of new
market."* A tier is walked top then bottom, so the bottom of the last
new-market tier is already the very next thing before tier 78 — the join needs
no machinery, only that the crossing run is on the bottom.

**NO FISH IS DROPPED QUIETLY.** Past the end of the market `walkRows` was
laying what fitted and discarding the rest: Trip 63 from tier 170 had 758
footprints of fish, 120 on the floor and **638 nowhere at all**, the only sign
a "spare" of −638 — which reads as arithmetic rather than as most of a trip
gone missing. It is counted on what actually LANDED rather than on any one code
path's own report, so it catches every way of losing a stack.

**A guard worth remembering:** on the uniform geometry `topEndsAfter()` and
`count` are both `Infinity`, so asking for the capacity of the top-bearing
region walks for ever. It hung the first run.

**The sheet shows the market's own tier numbers**, with a CAFE or OLD chip, and
draws **no top band and no walkway** where there is no top row — an empty
21-slot band over a cafe tier is a picture of a market that is not there.
Verified by rendering: Trip 63 from 74 gives 47 tier heads numbered 74-121,
4 top bands and 4 walkways for the 4 new-market tiers, 47 bottom bands, and the
uniform sheet renders byte-identical to before.

`test-markets.mjs` 66 checks · `test-geometry.mjs` 45 ·
`node scripts/sheet-preview.mjs "tally.xlsx" out.html 84` renders a real one.

**Doors are context only.** The sheet numbers them (green 3-22 over the new
market, yellow 1-9 over the cafe) but the allocator ignores them — David's
call, rather than my inventing a rule about which end fish comes in.


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

**A WHOLE CLOCK GOES TO ONE ROW, and the assignment is SEARCHED.**

Handing each SPECIES to whichever row was furthest behind its share balanced
the rows beautifully and shredded the clocks across both. On the real Trip 56
tally it put BLACK, CAT and SQUID on the top row and LING, MONKS and LYTHE on
the bottom — all four of them ROUGH — and split the flats the same way, HAKE
and HALIBUT below against LEMONS and MEGS above. So a buyer following the
rough walked the top for his monks and came back along the bottom for his ling.

**And it was 15 tiers either way.** The split was buying nothing at all.

David, on the chalk sheet of 19-08-2026: *"why is the ling not at the top with
the rest of the rough and the hake with the rest of the flats. in that example,
ling could've been after lythe, and if there was a spare tier at top, put some
flats into it."*

Deciding only at CLOCK boundaries makes that impossible to produce. The second
half of what he asks for — the flats moving up into the room the others leave —
is the spill, which was already there and already knows how to carry a fish
over inside one tier.

**The assignment is searched, not guessed.** There are four clocks, so all 2^n
ways of dealing them between the two rows are tried and the fewest tiers wins.
Two greedy versions were written first and both cost a tier: filling the top to
its 21/47ths share and switching, because a big clock packs better on the
bottom row (26 to a tier) than the top (21) and greedy cannot see that coming.

**Each assignment is scored AFTER its spill, not before.** Judged raw, a
four-clock tally put the flats on whichever row came out emptier — and the
spill may only take from the FULLER row, so it could do nothing about it and
the sheet ran a tier long. Scoring the finished thing lets the search pick a
layout the spill can then rescue.

**THE SPILL MUST NOT CUT A RUN — SPECIES *OR* CLOCK.** It shuffles whatever is
already in the receiving row along behind it, which costs those fish nothing
*provided the cut falls between two runs*. It does not always, and checking the
species alone was not enough. Both failures came off real tallies:

- **Trip 63** — the tier boundary landed inside the lythe, and a whole run came
  out `LYTHE x16 | LEMONS x8 | LYTHE x14`.
- **Trip 55** — it landed cleanly BETWEEN two species and still inside the rough
  clock, giving `rough x442 | flats x19 | rough x3`. A buyer following the rough
  walks past the flats and back — the same complaint one level up.

Nothing to weigh up: a tier is not worth breaking a second run to save.

### When one fish is the whole market

**Trip 60 asked for 30 tiers when 17 would do.** It landed 1,626 boxes of which
**1,602 were haddock** — 757 footprints. Held to one row that is 757 ÷ 26 = 30
tiers, the top row empty in 29 of them, against a floor of 17. **Trip 57 is the
same shape: 28 against 16.** Pre-existing, identical at every commit back to
e30c36c — it comes straight out of "a species goes into a row WHOLE".

No arrangement avoids it. At 17 tiers the market has 357 places on the top row
and 442 on the bottom; the haddock alone needs 757. **It goes down both sides
of the walkway because there is nowhere else for it.**

So when a fish fills the market the sheet is laid in **WALK order** — 21 into a
tier's top, 26 into its bottom, on to the next. That is exactly the order a
tier is walked, so every species still reads as **one unbroken run**, which is
a stronger guarantee than keeping it in one row, not a weaker one. Trip 60 comes
out COD · HADDOCK · MONKS · LYTHE · HAKE · LEMONS · PLAICE · HALIBUT · TURBOT ·
BRILL in a single sequence.

Banding the grades instead — the first half along the top row, the rest along
the bottom — was the alternative and it breaks David's own rule: a fish that
starts at tier 15 top continues at tier 15 bottom, it does not reappear ten
tiers away.

**DECIDED ON THE OUTCOME, NOT THE SHAPE.** The first version fired whenever a
clock was bigger than a row could hold, which caught trips where the spill
already handles it perfectly well and cost nothing. It runs only when it
actually saves tiers **and** the clock genuinely cannot be held in one row at
that count.

**AND DECIDED ONCE, IN THE CEILING PASS.** That pass sets the tier count and
nothing below may raise it. Letting the drops pass re-decide flipped **Trip 61**
— a perfectly good 18-tier sheet — into one where cod, haddock, black, ling,
lythe, hake and lemons were **all** split across the two rows, for no tier at
all: the "why is the flats doubled" complaint applied to every fish on the
market. `layoutOnce` takes `forceMode` from the ceiling pass, and `plan.mode`
is `rows` or `walk`.

Measured across all twelve real tallies under Audacious's own stored rules:
**every one now sits exactly on its floor**, only trips 57 and 60 take the new
path, and no other tally changed tier count or shape. The plan warns when it
happens rather than quietly changing shape.

**A residual worth knowing.** On Trip 63 the spill puts halibut and turbot in
tier 16's TOP row, which is walked before that tier's bottom — so the last tier
reads halibut, turbot, then lemons, plaice, megrim, witch, against the
catalogue's sale order. Each fish is whole and in one place; the order within
that one tier is the price of the tier it saves.


**A SPECIES MAY ONLY BE CUT BY A TOP-TO-BOTTOM SPILL.** Splitting one flat is
the documented exception and it works in one direction: Trip 64 carries hake
62/9 off the end of tier 17's top into the start of tier 17's bottom, the very
next thing walked, so it reads as one run.

The other direction can never do that — a chunk moved from the BOTTOM into the
same tier's top is walked BEFORE the part it came from. On Trip 63 the spill
took 5 of the 8 halibut off the bottom row and left 3, so the last tier read:

    tier 16 top     HALIBUT x5 | TURBOT x1
    tier 16 bottom  LEMONS x6 | PLAICE x4 | MEGS x12 | WITCH x1 | HALIBUT x3

David, on the printed sheet: *"in that last tier the halibut isn't next to each
other."* Taking whole species when the donor is the bottom row moves all 8 and
the turbot, fits in the same 16 tiers, and leaves every fish in one place.

**Guarding the donor unconditionally was the first attempt and it was WRONG** —
it also forbade Trip 64's hake split, which is the wanted case. The rule is
about direction, not about cutting.

**SPARE ROOM IS PER ROW, AND THE PAGE NOW SAYS WHICH.** The rows fill
independently, so a total is not a budget. Trip 63 came out with 15 places
spare — **12 on the top row, 3 on the bottom** — while the megrim that could
have come down are on the bottom. David: *"the megs could go flat to use up
some of the space left."* They could not; laying them flat would have added a
seventeenth tier. The old line, *"15 footprints still spare — not enough to
drop another grade a full level"*, reads as an arithmetic shortfall when it is
nothing of the kind. `plan.spareTop` / `plan.spareBottom`.

**AND A FLOOR THAT COULD NOT BITE NOW SAYS SO.** Releasing a floor does not lay
a fish flat; it only lets the drop solver spend room that may not exist. David
clicked *Let it drop* on Chipper (2b) and read it as the button not working —
the rule had saved perfectly well. The page now waits for the new plan and
reports where the grade actually ended up:

> HADDOCK Chipper (2b) may now be laid flat, but there is no room this trip. It
> is on the bottom row, which has 3 spare, and laying its 124 boxes flat would
> need 62 more. It stays at 2 high.

Reporting the intention rather than the outcome is what made a working button
look broken.


**WHEN THE RULE COSTS A TIER, THE PAGE SAYS SO.** Refusing that spill, or one
whose halves would land in different tiers, is right — but a tier is real market
floor and this codebase does not spend one silently. `planLayout` runs the same
search with both guards relaxed purely to report the difference, and warns
*"18 tiers keeps every fish in one run. 17 would fit (1 fewer), but only by
splitting one so it reads as two lots on the floor."*

Two things about that figure, both found by it staying silent when it should not
have:

- **It is read off the CEILING pass, not the finished plan.** The ceiling pass
  fixes the tier count; `solveDrops` then spends the room inside those tiers.
  Ask the finished plan and the comparison is already gone — Trip 64 is 18
  against a possible 17 and said nothing, because by then the drops had taken
  795 footprints to 803 and 18 was the floor either way.
- **The loose pass takes the BEST spill, not the first.** The strict path moves
  the fewest that drops a tier, deliberately, to keep the split small. A figure
  that only exists to answer "what did the rule cost?" has to be the best the
  tally could have done, or the answer flatters itself.

**MEASURED ON 13 REAL AUDACIOUS TALLIES, trips 52–64:**

| | before | after |
|---|---|---|
| a clock split across both rows | **12 of 13** | **0** |
| a run physically broken (`X ǀ Y ǀ X`) | **7 of 13** | **0** |

The tier cost is real and is not hidden: **5 trips need one more tier, 1 needs
one fewer, 7 are unchanged.** Trips 53, 58, 61 and 63 go up by one, trip 64
goes 17 → 18, and trip 62 goes 17 → 16. Every one of the five says so on the
page. Trip 56 is unchanged at 15 with every clock and every species in a single
run — where before it had the rough split BLACK/CAT/SQUID above against
LING/MONKS/LYTHE below, **at the same 15 tiers**.



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

### The order the market sells in — `src/lib/market/auctionOrder.js`

**Within a clock, species now come up in the order the auction sells them.**
It used to be "biggest species first, so the awkward remainders are the small
ones" — a packing convenience with nothing to do with the market.

David, Aug 2026: *"not only can we create a market layout, we could lay the
rough/flats out in the order it is sold on the auction."*

**IT IS MEASURED, NOT GUESSED** — off Peterhead's own *Transactions per
supplier* export for the Audacious sales of **13-08-2026 and 20-08-2026**,
every transaction from first to last. **Both sales give the same sequence**,
which is what makes it an auction order rather than one day's quirk:

    POK → HKE → COD → ANF → LIN → POL → LEM → USK → CAT → PLE → LEZ → WIT
        → HAL → TUR

(USK appears only on the 20th; no tusk was landed on the 13th.)

**IT IS THREE LIVE CLOCKS BLENDED, NOT ONE RUNNING ORDER** — David's own
reading, and the data agrees: lemons, a flat, sell between lythe and tusk,
which are rough. De-blended through each species' clock:

    cod     COD
    rough   black · monks · ling · lythe · tusk · cat
    flats   hake · lemons · plaice · megrim · witch · halibut · turbot

**The blended sequence is what is STORED; the per-clock order is derived.** Two
things fall out of that rather than keeping three lists: a species moved
between clocks on the rules page carries its sale position with it, and there
is no second copy to drift. `clockOrders()` de-blends it for display and for
the test that asserts those three runs are exactly what David listed.

**Read globally it would be wrong twice** — it would undo keeping a clock in
one run, and the clock ORDER itself is fixed: cod, then haddock and whiting,
then rough, then flats, with only the flats free to change rows.

**Haddock and whiting are deliberately absent.** They are not on a live
e-auction clock yet, so there is no transaction order to read; they keep the
tally's own order. Any species the export has never seen does the same, and
sorts **after** everything measured — letting it land in the middle would make
the measured part look wrong.

**Grades inside a species are untouched** and still follow the tally's `seq`.
The export agrees with David: every block runs its grades 1 → 5.

**THE CHALK SHEET AND THE CATALOGUE MUST AGREE, and one function is why.**
`bySaleOrder()` is imported by both. That is not decoration: the first cut
passed the catalogue objects where the comparator wanted species names, so it
silently fell back to the tally order while the sheet used the sale order.
**Both documents rendered perfectly and disagreed with each other** — a buyer
reads down for his next lot and finds it three species from where the fish
actually is. `test-auction-order.mjs` asserts the two agree clock by clock.

**A new sale sheet is uploaded on `/market-rules`, and it MERGES.** One sale
only carries what was landed that day, so replacing the order with a single
sale would drop every species that happened not to be on the market — the
13-08 sheet has no tusk on it at all. Stored per fleet, and only when it
differs from the shipped order.

Measured across all 13 real tallies: **the reorder changed no tier count
anywhere**, broke no run, and the sheet and catalogue agree on every one.

### A SCRIPT ARGUMENT DESTROYED TWO REAL TALLIES — `scripts/safeOut.mjs`

`scripts/catalogue-preview.mjs` takes its first positional argument as the
**output** path and renders its own built-in data; most other scripts in that
folder take an **input** tally there. Handing it a real tally therefore wrote a
PDF straight over the workbook. **`trip 64 day tags.xlsx` and `trip 64.xlsx`
were both destroyed this way in one session**, and the only reason they were
recoverable is that they live in OneDrive.

`safeOut(path, ext)` now refuses to write a preview over a file whose
extension is not the one that script produces. Narrow on purpose — a preview
overwritten by a later preview is the normal case and must stay silent, or the
guard gets switched off. Applied to all six scripts that take an output path.


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

### The buyers' catalogue — `src/lib/market/catalogue.js`

The same day tally as the chalk sheet, turned round to face the other way. The
chalk sheet tells the BOAT where to lay the fish; this tells the BUYER what is
there and in what order it comes up.

**Why it exists** (David, Aug 2026): buyers are complaining the auction is not
clear. The market staff catalogue it, and once selling is under way a buyer
cannot tell whether the next lot of a grade is day 5 fish or day 1.

**THE FRESHEST DAY SELLS AS A+, EVERYTHING ELSE AS A.** That is the whole reason
the day matters to a buyer and the reason this sheet is not just a species list.

**Which day is freshest is a SETTING, not my reading of it.** A boat fills day 1
first, so day 5 of a five-day trip should be the last caught — but getting it
backwards would print A+ on the OLDEST fish on every sheet the market hands out.
The page asks; it defaults to the highest day number.

**The tag colours are the MARKET'S, off the tally workbook's own "Tag Colours"
tab** — Black, Purple, Red, Orange, Green, Light Blue, Yellow, Grey, Pink,
White for days 1–10. **Not `DAY_INK` in `sheet.js`**, which is brand colour
for the boat's own chalk marking. A buyer is looking at the tag stapled to the
box, so the catalogue prints each tag cell in its real colour, with dark ink on
the pale ones.

**One clock per page.** The four clocks sell separately and a buyer follows one
or two — a sheet where his clock starts halfway down page 2 is handing him
somebody else's document as well. **The A+ rule is restated at the top of every
page**, because a man picking up page 3 has not read page 1.

**LEFT is the column that answers the real question.** Crossing a lot off, a
buyer wants to know what remains of that grade after it — so each row carries
what is still to come, and the days run freshest first because that is the order
the lots appear.

**Only what is aboard.** A catalogue listing every grade the market recognises
is a worse document than none: the buyer has to read past the fish that is not
there. An unfiled species still prints, on its own page at the back and named on
the layout page — quietly leaving a fish off a sheet the buyers are working from
is the failure worth guarding against.

**Column widths were measured, not guessed.** Nine columns did not fit A4
portrait, and squeezing them made it WORSE — `cellWidth` is a minimum, so the
overflow grew by exactly what was taken away and the TAG cell wrapped onto its
own line, breaking the alignment of every row. Size folded into the grade cell,
the two text columns left to autoTable, and the rendered page checked with
pdf.js: rightmost ink 559.6pt against a 559.3pt margin.

`scripts/catalogue-preview.mjs` renders the real document and asserts every
page states the A+ rule and names its clock. `test-catalogue.mjs` — 41 checks.

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

**The 30-07-2026 entry was deleted (David, 21-08-2026).** It was corrupt three
ways over and there was nothing in it worth keeping:

- the **Main Engine block was an exact copy of 09-06's**, down to all eight
  exhaust temperatures, so its running hours read 65,924 between 66,796 on
  17-07 and 67,105 on 31-07;
- the **Generator 2 block was a copy of 01-07's** — but with 8,594 hours where
  01-07 reads 8,707, so even the copy disagreed with its source;
- `running_hours` on the row read **66,383**, matching neither its own readings
  nor anything else.

Found by the counter check, which is the point: **every individual figure in it
was perfectly ordinary.** A range test would never have looked twice. It is only
wrong in relation to the entry before it.

After the delete: 20 logs, and **no counter goes backwards anywhere**.

**That deletion left no trace, because engine_logs had no audit trigger** —
and neither did the garbage record book, the fuel log, the maintenance record or
any of the gear log. **Closed 21-08-2026, `supabase/audit_the_books.sql`**:
thirteen more tables now audited, 34 in all.

The three books closest to being legal records were the ones without it, while
twenty-one others had had triggers since Aug 2026 — added to the rota tables
precisely because 60 crew assignments vanished with nothing to show what
happened.

**It is a CHOSEN list, not every table**, and the exclusions are the useful part:
- `sales_landings` / `sales_rows` — re-uploading one note deletes its rows and
  re-inserts them thousands at a time, so auditing it buries everything a person
  did by hand under machine noise. `reconcile_diff` is the record that matters
  there.
- `su_*` — settlements arrive from an edge function on the service-role key,
  where `auth.uid()` is null. The trail would record that nobody did it, which
  is worse than no trail.
- `stores_*` — a grocery list.

The rule: books and settings written **by hand**, a few entries at a time, where
a silent change would matter. Apply that test before adding a table, or the log
fills with machine writes and stops being read.

Probed as an officer: insert, update and delete on `engine_logs` all captured,
every row naming the man who did it, and **the CASCADE delete of a gear
component caught when its net went** — which is the exact case that lost the 60
rota rows. `audit_log` stays skipper-only to read; the trigger is SECURITY
DEFINER, so an officer's writes are recorded even though he cannot read the
record.

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
     `David Henderson ⇄ Norman Wood` was seeded as **inferred** — the only two
     chief engineers, on opposite watches — and **David confirmed it Aug 2026**.
     The inference was right, but it was carried as an inference until he said
     so, which is the order these go in.
     **The six deckhands have since been paired** — Gregor Smith ⇄ Ronald
     Beagrie, Andrew Smith ⇄ Paul Craib, James Napier ⇄ Duncan Cruikshank.
     The earlier note here that they were "deliberately unpaired" because four
     aboard against two ashore does not pair one-to-one is **stale**: nine pairs
     are on record for Audacious. Read the table, not this paragraph.
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
   **Audacious now has days on every landing** — re-counted Aug 2026: 0 of 121
   missing, and every one attaches to a logbook trip. The note here has said
   *79 of 118* and then *14 of 121*; both were stale by the time they were
   read, which is the argument for measuring rather than quoting this file.
   The other fleets are largely blank — Guiding Light + Faithlie 73 of 73,
   Boy John + Rosebloom 62 of 62, Beryl 31 of 32, Boy Andrew 25 of 25 — so
   `£/day` is sound for Audacious and means little elsewhere. It matters less
   than it did either way: `Trips.jsx` takes days from the LOGBOOK and only
   reports the typed figure beside it, rather than depending on it.
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

- ~~**SQUARE UP SHOULD LINK TO THE REST OF THE PAGE**~~ — **BUILT Aug 2026.**
  It re-entered figures the app already held. Now:

  **ROLE PICKS THE BONUS** — `src/lib/su/bonuses.js`. Skipper 3%, engineer
  0.5%, mate 0.25%, and David's sharing rule is ONE rule: *a role's rate is
  split across the trip's LANDINGS, and each landing's share among the men who
  held that role on it.* Two engineers a landing each is 0.25% apiece; two
  mates on landing one and one on landing two is 0.0625/0.0625/0.125 — his own
  worked figures, asserted verbatim. Recomputed across the WHOLE crew, because
  a second engineer joining halves the first one's share.

  **A landing with nobody in a role is REPORTED, never redistributed.** Handing
  that share to the other man would invent a payment nobody agreed; dropping it
  would lose it. Percentages carry four decimals — 0.0625 is real, and rounding
  to 0.06 loses money every trip.

  **THE ROLE IS STORED, not just the percentage.** `su_worksheets.landings` and
  `su_worksheet_crew.role/role_landings`. A figure kept without the thing that
  produced it is how the bond went wrong: reopening a sheet would have
  recomputed every man as if he did every landing.

  **THE MONTHLY BONUS COMES FROM MONTH CLOSEOUT.** Per man, not one figure —
  Christopher Catam is £543.67 against the others' £1,153.40 for August because
  he was aboard part of the month. Only CONTRACTED crew get it: Andrejs was
  moved to self-employed, so `crew_type` is the test and **no nationality test
  exists anywhere**, which would have been wrong the first time a Filipino
  engineer joined on his terms.

  **LUMPER BOXES COME OFF THE SALES NOTE, PETERHEAD ONLY.** Offered as a button
  rather than filled in — a lumper is not always paid on every box landed.
  **The first filter was too loose:** `/peterhead|don fishing/` also matched
  Ullapool, Scrabster and Kinlochbervie, where the agent also sells and the
  lumpers are not on the Peterhead rate. Denmark was the case David named;
  those three were the ones the loose match would have got wrong. A bare
  "Don Fishing" with no port is not offered either — better no figure than a
  wrong one.

  **THE CREW STAY ON A NEW TRIP.** *"99% of all trips are same crew with slight
  changes to bonus %'s"*. Names, shares, roles and bonuses carry; fuel, boxes,
  dates, bond and haulage clear. **The bond deliberately does not carry** — it
  is bought for a trip, and keeping it would charge a man twice for the same
  baccy.

  **AND A KEPT SHEET CAN BE TIED TO ITS SETTLING.** `settlement_id` existed
  since the table was built and nothing ever set it. Chosen, never matched on
  the date: a settlement covers a RUN of trips and the office does not say
  which, which is exactly why `solveSettlementRuns` is the hardest code here.
  The skipper knows, so he says.


- ~~**A GRADING CARD SHEET for what the trip actually landed**~~ — **BUILT
  Aug 2026**, see the market layout section. Banked.


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
  is written and because those are real subdivisions that must stay apart.
  Anything not a 27.x area passes through untouched rather than being mangled
  into a wrong-looking Roman numeral. **All 17 real grounds were run through it
  and checked by eye**, not assumed.

  **A LOCAL SUB-AREA TAG IS FOLDED BACK INTO ITS DIVISION** (`normaliseArea()`,
  Aug 2026). The logbook carried `27.6.a.s` for 24 days; David: it is **VIa** —
  the `.s` is the local south tag on the West of Scotland ground, not a division
  of its own.

  The rule follows the ICES hierarchy rather than special-casing that one code:
  *area . division . subdivision*, where a real subdivision is **numeric**. So
  anything alphabetic at that depth is a local tag and belongs with its
  division.

  **Folded in the KEY, not just the label.** Relabelling alone would have left
  `27.6.a` and `27.6.a.s` as two separate grounds both reading "VIa (GBR)" —
  two identical rows in the wear table, which is worse than the odd label was.
  Audacious now reads **16 grounds instead of 17**, with VIa (GBR) at **173 days
  rather than 149**.

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

  **HALVES AND AN OVERALL — built Aug 2026.** `supabase/gear_halves.sql`
  (applied), `halvesCheck()` in `src/lib/gear/parts.js`.

  David: *"when measuring a headline/footrope/ground gear we do in 2x halves &
  total overall."* **He was already doing it.** The ground-gear record of
  19-08-2026 carries `Stb 60'3"/Port 60'5"` typed into the NOTES of a separate
  `inspected` row, because the form had nowhere else to put it — and 60'3" plus
  60'5" is exactly the 120'8" of that day's `measured` row. The feature is his
  method turned from prose into data.

  **FOOTROPE WAS NOT IN THE PARTS LIST AT ALL.** The five shipped names were
  ground gear, headline, bridles, legs, codend. He named a sixth in the same
  breath as the request; it ships now, and `resolveParts()` means every fleet
  picks it up without a seed.

  **THE OVERALL IS MEASURED, NEVER DERIVED**, and there is deliberately no
  generated column doing it. It is a third act of measuring along the whole
  rope, so it can disagree with the two halves — and when it does, one of the
  three is wrong. That is a check the paper method could never make, and
  computing the total away would destroy it. A disagreement is REPORTED, the
  same rule the settlement reconciliation follows.

  **A SUMMED TOTAL AND A MEASURED TOTAL MUST NOT READ ALIKE.** With no overall
  taken the halves are summed and `basis` says `summed`; the matrix cell marks
  it *(halves)*. Same discipline as *since measured / since fitted / since
  aboard*.

  **THE MATRIX CELL COUNTS THE HALVES AS A LENGTH.** It tested `value` alone,
  so a rope measured that morning in both halves with no overall read as never
  measured at all.

  **THE IMBALANCE IS REPORTED AND NEVER JUDGED** — port 60'5" against starboard
  60'3" is a real two inches on David's own net, and whether that matters is his
  call, not a threshold I invented. The engine limits settled that argument: a
  limit derived from history alone would have flagged the CORRECT readings.

  **Bridles and legs are NOT halved.** There is one of each per side already, so
  they are two components, not one rope with two halves — halving them would
  quarter the gear. A codend has no halves. Overridable per fleet all the same
  (`gear_parts.halves`, null = keep the shipped answer).

  **One half on its own is kept**, not refused: a man who measured the port side
  before the weather came in has a real reading. Nothing is inferred from it —
  no sum, no imbalance, no total until both are there.

  The tolerance is **one inch**, the resolution `ft_in` rounds to, and it needs
  an epsilon: 120'1" minus 120' comes out of decimal feet as 25.400000000001455
  mm, so a bare `<= 25.4` calls an exact inch a disagreement.

  Probed as an officer: writes both halves and the overall, one half alone is
  allowed, a negative half is refused by CHECK, and he still reads sales **0**
  and payments **0**.

  **The 19-08 halves ARE in the columns** — folded onto the measured row, port
  60'5" (18,415 mm) and starboard 60'3" (18,364.2 mm) against a measured overall
  of 120'8" (36,779.2 mm). They agree to nothing at all: the disagreement is
  4×10⁻¹² mm, which is floating-point dust and well inside the one-inch
  tolerance. The `inspected` row that originally carried them in prose is left
  where it is — it was a real inspection, and the note is the source the columns
  were read from.

  **This paragraph said the opposite for a while after it was done**, and it was
  quoted back at David as outstanding work. Measure the database before
  repeating anything in this file — the days-at-sea note made the same mistake
  twice.

  ### The old pair is retired — and four known oddities are LEFT ALONE

  `Port net` and `Starboard net` were retired on **10-05-2026**, the day the new
  `Port Twin` / `Starboard Twin` came aboard (David, Aug 2026). Nine of their ten
  fitted sets were closed on that date, which is what gave the Life tab
  something to average: **codend 8 lives · bridles 7 · ground gear 6 · headline
  6 · legs 5**, where before every set still read as fitted and so counted as no
  life at all.

  The old starboard net was called **`Starboard twin`** and is now
  **`Starboard net`**, to match its partner. It was one capital letter away from
  `Starboard Twin`, which is still aboard — two nets you would have to tell
  apart by capitalisation, under pressure, to retire the right one.

  **`Single Net` is deliberately NOT retired.** It is retired in fact; David:
  *"i will retire the single net when it's offically retired. barry will do it
  when ready."* So its 13 sets still read as fitted and are excluded from every
  average above. That is a known understatement, not a bug, and it is Barry's to
  close.

  **FOUR ANOMALIES, RAISED AND DELIBERATELY LEFT** — David, Aug 2026: *"leave it
  as is. we will tidy it when add new info."* Do not silently correct them:

  - **Starboard net's `legs` are fitted 26-05-2026**, sixteen days after the net
    came off, so they could not be closed on the 10th — `removed_on >=
    fitted_on`, and a negative life would drag the legs average. Moving them to
    `Starboard Twin` is refused by `gear_components_one_fitted`: she was rigged
    with legs on 10-05 already. Three readings fit (a mis-keyed date, real work
    ashore, or an unlogged renewal of the new net's legs) and the data cannot
    choose between them.
  - **`Starboard Twin` carries three codends, two identical** — both fitted
    31-07-2025 and removed 21-08-2026. Reads like a double entry.
  - **Her codend and bridles predate her.** Fitted 31-07-2025, 31-10-2025 and
    01-07-2026 on a net aboard 10-05-2026. Note 31-07-2025 is the Single Net's
    own `came_aboard`, so those may be filed against the wrong net.
  - **All ten retired sets carry one measurement dated 18-07-2026, every one
    12.5 fathom** — two months after the nets came ashore, and identical. That
    reads as bulk placeholder entry rather than gear work, which is worth
    knowing before trusting the 4-day bridles life or the 386-day codend.


  `test-gear.mjs` — **227 checks**.

  **All three stages are built.**

  **Cost is optional throughout** — David: "a lot of the time this isn't
  known". Where it is entered it would be the **first real per-vessel cost in
  this database**, which is the thing `Trips.jsx` does not have and why it
  reports rates rather than profit.

- ~~**PARTS INVENTORY, hanging off maintenance**~~ — **BUILT Aug 2026.**
  `/parts` (`Parts.jsx`), `src/lib/maintenance/parts.js`,
  `supabase/parts_inventory.sql` (applied).

  **THE STOCK FIGURE IS DERIVED, NEVER STORED.** There is no `on_hand` column
  anywhere and no field on the page to edit one — the probe asserts as much. A
  maintenance event consumes parts; what is left falls out of
  *(last count + received − used since)*, so it cannot drift from the job record
  the way a separately kept tally would. One number, two views.

  **THE FIRST RUNNING BALANCE IN THE DATABASE**, and that changes what the page
  owes the reader. Every other figure here is a snapshot — a landing, a reading,
  a settlement — and a wrong one is wrong on its own. A wrong movement moves
  every later balance too. So `balanceOf()` returns the workings rather than a
  number, and every ledger row shows the balance it left behind.

  **THREE STATES THAT MUST NEVER RENDER ALIKE**, which is most of what the tests
  are about:
  - **counted** — the figure rests on a real stock take, and the row says when;
  - **never counted** — net movements from an assumed nought, very likely wrong,
    and shown in brass with the words *never counted*;
  - **nothing recorded at all** — an em dash, not a zero.

  A part is called **low only when it is both below its minimum AND counted**.
  Calling a part short on a balance nobody has verified is how a reorder list
  stops being believed.

  **A count is absolute; everything else is relative.** A stock take resets the
  balance on its date and makes everything before it irrelevant — which is how a
  running balance gets put right without editing history. Same-day order is
  `moved_on` then `created_at`, so a count entered after a use that day
  supersedes it, rather than leaving it to chance.

  **Only `adjusted` may be negative**, because it is the only kind where the
  direction is not already in the word. Enforced by CHECK and asserted by probe.

  **A use need not name a job.** A part used off the books is still a part gone,
  and refusing the entry would leave the balance wrong — worse than an
  unattributed line.

  **No shipped catalogue**, unlike the stores list and the gear parts. Those
  ship defaults because there was a real source to transcribe; a boat's spares
  are impellers and injectors for HER engine in HER part numbers, and a guessed
  list would look like a starting point and be wrong.

  **The officer writes it without a skipper login** — he is the man holding the
  part, and if correcting a miscount needs somebody else to sign in, the
  miscount stays. Audited from day one, because a silent edit here moves every
  later figure.

  Probed: officer creates a part and its movements, gets **14** from
  *counted 12, +6, −4*, is refused a negative "used" and a cross-fleet vessel,
  and still reads payments **0** and sales **0**. Cook reads **0** and **0**.
  `parts` carries **no stored stock column**.

  `test-parts.mjs` — 55 checks.

  **The last mile is closed (Aug 2026).** Marking a maintenance job done now
  records what it used **in the same action**, on `Maintenance.jsx`. A second
  trip to a second page is how a ledger goes stale, and a stale ledger is worse
  than none because the balance still looks like an answer.

  **The picker shows what is aboard beside each part**, because the man filling
  it in is deciding whether he has enough, and telling him afterwards is too
  late. Drawing more than the books show is called out — *"more than the books
  show"* — but **never blocked**: recording what actually happened matters more
  than keeping the balance tidy, and if it goes negative the count was wrong,
  which is worth knowing rather than hiding.

  Parts for the job's own **component sort first**: an impeller change wants the
  impellers, not an alphabetical list of everything the boat carries.

  **This works at sea, and the reason is worth knowing.** `useOfflineTable`
  generates the row id CLIENT-SIDE and `flush()` sends it as
  `t.insert({ ...payload, id: item.id })` — so the movements can name an event
  that does not exist on the server yet, and replay being strictly in order
  means the event always lands before the lines referencing it. Verified rather
  than assumed: probed with an event carrying a client-made id followed by a
  movement naming it, and the foreign key resolved.

  **`event_id` is ON DELETE SET NULL**, so deleting a job leaves the used line
  in place and unattributed. The part is gone whether or not the job record
  survives, and losing the movement would silently put the balance back up.
  Probed: counted 6, used 2 on the job, balance 4; job deleted, the line
  survives and the balance stays 4.
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

  ### "Ordered before" — the quick add (Aug 2026)

  `src/lib/stores/history.js`, `src/components/OrderedBefore.jsx`.
  The catalogue is 334 items and a trip uses about sixty, largely the same
  sixty. The lines already kept ARE the record of what gets bought, so the next
  list starts from them rather than from a scroll through the whole form.

  **RANKED BY REGULARITY BEFORE RECENCY.** Ranked on recency alone, the scampi
  bought once last trip outranks the softies bought every trip — which is the
  exact distinction between "regularly" and "recently" that the panel exists to
  draw. Sort is: how many past lists carried it, then how recent, then name.

  **THE HEADING CHANGES WITH HOW MUCH IS BEHIND IT**, same discipline as
  `confidence(n)` in gearStats and `groundConfidence()`. One previous list is
  not a habit:

      1 list    Ordered last trip    "from the one list kept so far —
                                      not a pattern yet"
      2 lists   Ordered recently     "from the last 2 lists"
      3+        Regularly ordered    "from the last 3 lists"

  Per item too — never *"1 of the last 1"*, which is the shape a naive counter
  produces and reads as a statistic when it is a single observation. **This is
  the live case**: Audacious has exactly one kept list with lines on it.

  **The quantity is the MEDIAN**, so one heavy trip does not set the usual
  amount, and one tap puts on what is normally bought rather than a bare 1 that
  then has to be typed over. **The name, unit and pack size come from the most
  RECENT list** that carried it — a unit corrected last trip is what the boat
  means now.

  **Truncation is stated.** The real list carries 64 items against a limit of
  60, and "here is what you usually order" quietly missing four of them is the
  kind of gap nobody notices until the shop delivers.

  `test-stores-history.mjs` — 40 checks. `scripts/ordered-before-preview.mjs`
  server-renders the REAL component against the boat's REAL kept lines and
  reads the markup back, because the page is behind a login and a fleet and
  could otherwise only be checked by eye on somebody else's device. It renders
  all three states — one list, several, none — since a preview showing only the
  happy case is how the other two ship broken.

  ### A list started on another login was invisible in practice

  David, Aug 2026: *"jackson started a trip on his login. why can't i see it on
  my login?"* **He could** — probed as his own account, both rows come back, and
  there is no vessel filter, no `created_by` restriction and no stale cache.

  The list was **empty and untitled**, so in the Trip picker it read as a bare
  `25 Aug 2026` among other bare dates, and the picker sticks to whatever is
  already selected. Nothing on the page said whose it was or that nothing had
  been added to it. `created_by` had been stored since the table was built and
  shown nowhere.

  The picker now names the man and the item count, and the open list says who
  started it and when. **An empty list and a missing one must not look alike.**

  **Attribution degrades rather than leaking.** A cook can read only his OWN
  `app_users` row — probed: 1 row, his — so on his login another man's name does
  not resolve. An unresolvable id reads *"another login"*, never a uuid.


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

- ~~**Garbage log.**~~ — **answered and in use.** `garbage_log` has 6 entries,
  the most recent the same day it was checked (Aug 2026), so the MARPOL Garbage
  Record Book question is settled: it is kept here.
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
  writes in it and lets it go stale again.

  **AND IT CLEARS ITSELF — `supabase/resolve_activity_alerts.sql`, Aug 2026.**
  The generator only ever INSERTED, so an alert stayed open until somebody read
  or dismissed it by hand, and the digest re-listed every unread one each
  morning. David got told on 22-08 that the engine log was two days stale —
  TWICE, with two different dates — and that bunkering was seven days overdue,
  on a morning the engine log had an entry and the fuel log was three days old.
  All three were wrong.

  Two faults in one: a book going stale from a new last-entry date raises a new
  alert (right) but never closed the previous episode (wrong), and writing in
  the book cleared nothing at all. The rule now: **for each fleet and each book,
  at most ONE open alert, and only while the book is actually stale** — the same
  principle as the re-upload banner, driven by the data so there is nothing to
  remember to take down. Maintenance too: a job done since is not due.

  **The digest calls the generator before building the mail.** Cron runs at
  06:00 and the digest at 07:00, so a man writing his log at half past six was
  told at seven that he had not.

  A limit worth knowing: the unique key is (fleet_id, dedup_key) regardless of
  dismissal, so a key that has ever been used cannot raise again. Normal running
  is fine — each new episode has a later last-entry date — but you cannot
  resurrect an old alert by rolling the data back, and the first probe of this
  fix reported 0 where it wanted 1 for exactly that reason.

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
- ~~**Dedicated pair-team fish sales analysis.**~~ — **BUILT Aug 2026**, and it
  needed no vessels schema after all: a pair is ONE fleet whose boats are told
  apart by `sales_landings.vessel`. See the four panels under Pair teams —
  `byVessel()`, `samedayPriceGap()`, `speciesMixDivergence()`,
  `vesselMarketSplit()`. The note that it was "blocked on the vessels schema"
  was stale from before that was worked out.
- **Certificate reader** — partly firmed up Aug 2026, and what remains needs
  REAL FAILING EXAMPLES rather than more code.

  **Fixed: the reader could not suggest six of the eleven categories.** The
  vessel prompt offered *Statutory, Insurance, Safety, Equipment, Other* and the
  clamp allowed exactly those five — so **LSA, FFA, Radio, Pollution, Medical
  and Machinery were unreachable**, which are the six the vessel-certificate
  work created precisely because "Safety" was a useless bundle of seven. Every
  liferaft, extinguisher and radio certificate read from a photo landed in
  Safety or Other and had to be refiled by hand. The prompt now names all ten
  live buckets with a line each, and says to prefer the specific over the
  general — a liferaft service is LSA, never Equipment.

  `Safety` is deliberately still NOT offered: kept on the page so old filings
  show, but nothing new should go there.

  **The two lists must stay in step** — `CATS` in `parseCert.js` and
  `VESSEL_CERT_CATEGORIES` in `VesselCerts.jsx`. They had drifted, and the
  symptom was invisible: a wrongly-filed certificate looks like a skipper's
  choice, not a parser that had no other option.

  **What firming up the rest needs, and it is not more prompt-writing:**
  - **Certificates it got WRONG**, with what it produced beside what is right.
    The two P&J buyer fixes in this repo failed because they were written blind;
    the same applies here.
  - **`expiry_date` and `cert_type` matter more than the rest** — the first
    drives the alerts and the second drives the matrix grouping. Issuer being
    slightly off costs nothing.
  - **Nothing is measured.** There is no record of what the reader produced
    against what was actually saved, so the error rate is unknown and any change
    is unfalsifiable. Logging the parse beside the saved row is the single most
    useful next change, and it needs no new examples to build.
  - **The bundles are a DESIGN question, not a parsing one.**
    `L.S.A Certs.pdf` (98 pages) and `UKFVC.pdf` (66) each hold many
    certificates in one file, which the one-file-one-certificate model does not
    fit at all.

  Storing the original photo/PDF is already built on both pages with
  downscaling; what is outstanding THERE is data entry — 6 of 16 vessel
  certificates and 4 of 111 crew certificates have a file.

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

### A deploy that lands while a page is open — `src/lib/liveBuild.js`

David, Aug 2026, uploading a note: *"Failed to fetch dynamically imported
module: https://skippermanagement.co.uk/assets/parse-core-CDChEAJ_.js"*.

**Nothing was broken.** The parser and pdf.js are loaded ON DEMAND — they are
large and most sessions never upload a note — so Vite splits them into
content-hashed chunks whose NAMES are baked into the JS already running in the
browser. Bumping the parser to 1.3.5 changed the hash, the deploy replaced the
file, and his open page went on asking for one that no longer existed.

Not a service-worker fault and not an offline fault: navigations are
network-first, so a plain reload fixes it. But the man is standing at the upload
button and should not have to know that.

**THE RELOAD IS THE DANGEROUS PART, NOT THE DETECTION**, and it is guarded three
ways, because a reload loop on a boat with no signal is far worse than the error
it replaces:

- **Online only.** Offline the chunk is missing because it was never cached, and
  reloading cannot conjure it — it says so instead, and does not burn its one
  attempt.
- **Once per session**, so a half-finished deploy cannot loop. `buildLoadedCleanly()`
  clears the flag on a build that actually ran, so a LATER update in the same
  session can still heal itself.
- **Only for this failure.** A parser that throws on a bad note must still say
  the note is bad. Anything not a stale-chunk error is rethrown untouched, and a
  plain `NetworkError` is deliberately NOT matched — that is being at sea.

Three browsers word it three ways and none of it is structured, so the match is
on the shapes actually seen (Chrome *"Failed to fetch dynamically imported
module"*, Safari *"Importing a module script failed."*, Firefox *"error loading
dynamically imported module"*). **The raw wording is never shown to the user** —
it names a file he can do nothing about.

`vite:preloadError` is handled once in `main.jsx` rather than at every call
site: every page in `App.jsx` is a lazy import, so a deploy breaks the next page
opened, not only the parser.

`test-livebuild.mjs` — 25 checks, including that it refuses offline, refuses
twice, and passes a real parse failure through unchanged.


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

## The demo fleet — `supabase/demo_fleet.sql` (Aug 2026)

**`NORTH WIND BCK500 (DEMO)`**, fleet id `…0000de`. Built so a potential
customer can be shown the app without being shown AUDACIOUS's books — and not
only hers: Sandy's and Colin's landings sit in the same database.

**It is a FLEET, not a MODE.** Every parser, page and policy is the code the
real boats run; the only difference is which rows RLS hands back. A "demo
version" would drift and nobody would see it — the same failure as the two
parser copies, where the browser path ran 1.2.1 against the webhook's 1.3.2 for
months because the version that mattered lived on a server nobody looked at.

**The boat** lands at Peterhead and is registered at Buckie, which is the
ordinary arrangement anyway — AUDACIOUS is BF83 and sells here too. Every
generated document carries a SAMPLE banner; the banner does the safety work,
not the name. Crew, buyers and suppliers are all invented — a demo carrying a
real firm's or a real crewman's details is somebody else's information however
sample the rest of it is.

**What it holds**: 25 landings / 838 rows / £2.28m / 599 t at £3.81 a kilo,
25 logbook trips, 12 quota lines, 10 crew with 50 tickets, 8 vessel
certificates, 18 engine logs, 14 fuel entries (with a **price per litre**,
which Audacious's own log lacks), 6 garbage entries, 6 maintenance tasks.

**The landing totals are written from the row sums**, exactly as the real
ingest does it, so the demo reconciles for the same reason a real note does
rather than because the totals were typed in to agree.

**Some things are deliberately WRONG** — one passport expired, one falling due,
a liferaft service run out. A demo where nothing is ever amiss shows none of
the work the app actually does.

**THE WIPE IS GENERATED FROM THE SCHEMA.** `wipe_demo_fleet()` walks every
table in `public` carrying a `fleet_id` — 64 of them — so a table added next
month is cleared without anyone remembering. A hand-written list would slowly
fill the demo with the last visitor's typing, which is the shape of bug the
role deny-loops exist to avoid.

**THE FIRST REAL RESET DELETED THE DEMO LOGIN.** `app_users` carries a
`fleet_id`, so the generated wipe took it and locked the visitor out of the boat
he was being shown. `fleets`, `vessels` and `app_users` are the tenant itself
and are skipped; everything else is what a visitor scribbles on. Found by
probing as the actual account AFTER a reset rather than before one — nothing
about reading the function says it, the row count does.

**The audit book is emptied after the seed**, not before. Seeding writes 312
rows through the triggers, so the demo opened her audit page on three hundred
machine entries done by nobody — a worse demonstration than an empty one, since
the page exists to show who changed what. It now fills with the visitor's own
edits.

**The live login is `demo@skippermanagement.co.uk`** (Aug 2026), skipper,
`is_owner = false`. Probed as that account after a reset: fleets
`[NORTH WIND BCK500 (DEMO)]`, 25 landings, 838 rows, 25 trips, 12 quota lines,
10 crew, 50 crew certs, 8 vessel certs, 18 engine logs, 14 fuel, 6 maintenance,
1 particulars, audit 0, app_users 1, payments 0, and renaming another fleet
affects **0 rows**.

**`reset_demo_fleet()` takes NO ARGUMENT.** The fleet id is a constant inside
the wipe, so there is nothing to get wrong at the call site — the only way to
be sure a reset can never take a real boat's books with it.

### `is_owner` is the PLATFORM owner flag, and must never be set on a customer

Found while building this. It grants read **and update** on every row of
`fleets` — every customer's boat name, and the ability to rename their fleet.
That is **deliberate**: `VesselDetails.jsx` lets the owner administer branding
across tenants. One account carries it.

It was briefly "fixed" here on the reading that it meant *owner of this fleet*,
which broke that picker. **It does not mean that.** The real hazard is not the
policy but the flag: a demo login or a customer given `is_owner` would list
every real vessel. The demo login is created with `is_owner = false`.

The auth user is made in the Supabase dashboard, not in a migration, so the
password never passes through a file or a transcript; only the `app_users` row
binding it to the demo fleet is version-controlled.

Probed as that login, not inspected: `fleets` = the demo fleet alone, another
fleet's rename affects **0 rows**, and it reads its own 25 landings, 10 crew and
1 `app_users` row.


### The demo is now a whole boat, and it resets itself

**Nightly at 03:30** (`demo-reset-nightly`), clear of the 06:00 alert run and
the 07:00 digest and at an hour nobody is being shown a boat — deliberately not
during the day, since a reset mid-conversation takes the visitor's work out from
under him. **And a button on the Users page**, platform-owner only, for when the
last visitor made a mess and the next is due in ten minutes.

**The guard is INSIDE `reset_demo_fleet()`**, not in a handler holding the
service key: no argument to get wrong, the privilege not copied to a second
place, and cron — which has no `auth.uid()` — still passes. Probed both ways:
the demo visitor is refused by name, the platform owner is allowed.

**THE WIPE GOES ROUND AGAIN.** It walks tables alphabetically, which is
arbitrary, and `crew` comes before `landing_crew` — whose FKs are ON DELETE
RESTRICT so a crewman cannot be deleted out from under his settled share of real
landings. **The first wipe worked and the second was refused halfway**, leaving
the boat half cleared. Hand-ordering 64 tables would fix it and would rot, so
each pass deletes what it can, swallows only foreign-key refusals, and stops
when a pass clears nothing new. Two consecutive resets now return identical
output.

**What it holds**, every module live: 25 landings / 838 rows / £2.28m · 25
logbook trips · **8 settlements over 24 landings** · 12 quota lines · 10 crew
with 50 tickets · 4 contracts and one completed tour · 24 month closeouts · 12
rota trips over two watches · 2 nets with 30 component lives · 10 spares · a
stores list · 8 vessel certs · 18 engine logs · 14 fuel entries · 11 engine
limits · the 42-item familiarisation list.

**The settlements were verified by the app's own solver**, not by inspection:
`solveSettlementRuns` confirms **8 of 8 exactly on both value and weight** and
places 24 of 25 landings. The 25th is unsettled on purpose — the office settles
a run at a time and the latest trip has not been paid — which is the leading and
trailing behaviour that took the most work to get right. One sheet carries
**£18,400 of towage** so Reconcile can be shown comparing against the Fish Sales
line and never `total_income`.

**Three things I got wrong by guessing rather than looking**, each caught by the
database refusing them: the crew rates (£1,450 a month and 55p a box invented,
against the real £350 and 15p — and `ghb_first_half_pct` is a *fraction*, so 50
overflowed `numeric(5,4)`); a current contract carrying a planned end date, when
the constraint rightly requires none until the man actually goes home; and
MARPOL garbage categories in plain English where the record book has coded ones.

**THE LOGBOOK CATCH DETAIL is seeded too** — 1,502 rows over 137 fished days,
built FROM the landings (each trip's own weight spread over its days and
species, lifted 8% for gutting loss) so the logbook and the sales notes tell the
same story. Four grounds on a rotation, because `groundConfidence()` wants three
finished sets AND two grounds carrying 20+ days and 2+ sets before it ranks
anything:

    27.4.b (GBR)  41 days · 17 sets      27.4.a (NOR)  35 days · 20 sets
    27.6.a (GBR)  37 days · 20 sets      27.4.a (GBR)  24 days · 15 sets

**A few days are logged on `27.6.a.s` on purpose.** That local south tag is not
a division of its own and `normaliseArea()` folds it into `27.6.a` in the KEY
rather than only the label — the 37 days above ARE the fold; without it there
would be a fifth row reading VIa (GBR) twice.

**PRICE VS FLEET IS OFF THE DEMO, in both directions.** The RPCs read every
fleet's rows with no exclusion, so the demo's 838 invented rows sat in the
average REAL customers are measured against. Nothing was corrupted — the demo
writes species upper case (`COD`) and real notes canonicalise to proper case
(`Cod`), so they never grouped — but **that is luck, not design**, and it breaks
the first time either naming changes. Both functions now require
`not fleets.is_demo`, which also empties the demo caller's own figures, so there
is nothing for the page to show. Probed: demo 0 rows, real skipper 33 species
and 23 cod grades, unchanged. The menu entry carries `notOnDemo: true` as well —
that hides a MENU ITEM and nothing else, but a page answering "No sales in 2026"
to a boat with 25 landings looks broken rather than withheld.

**Still empty, and each needs a document rather than a seed**: `stowage_plans`
and `crew_lists`. `market_prices` needs nothing — it has no `fleet_id`, so the
demo already reads the real Peterhead and Denmark board, 44,623 rows back to
2022, which is what makes Daily Prices and the Estimator work out of the box.

### The sample documents — `scripts/make-sample-docs.mjs`

A demo you can only look at is a slideshow. What is worth showing is a man
dropping a sales note on the page and watching the rows, the buyer league and
the quota position come out of it — so the files go through the REAL parsers.

**EVERY FILE IS PARSED BACK BEFORE IT IS WRITTEN**, and if one does not parse
the script fails and writes nothing. A sample note that quietly stopped parsing
after a parser change would otherwise be found by a prospect, in front of David.

Written to `public/samples/`, so the app serves them itself:

- **`sample-sales-note.pdf`** — 57 rows, 768 boxes, 27,874 kg, £111,800.76,
  reconciling to the penny against its own printed TOTAL. Courier, one draw call
  per row, because pdf.js groups text by y-position and a row drawn in columns
  comes back to the parser in pieces.
- **`sample-day-tally.xlsx`** — 1,954 boxes over 5 days, 25 tiers, 1,173 of
  1,175 footprints used.

**Both are deterministic**, so the same bytes come out every run — a document
that changed on every build would make "did this change break it?"
unanswerable.

**Two things only running it could have found:**

- **PD999 could not be read off her own note.** `VESSEL_STOP` holds `"PD"` on
  purpose — a note prints PD as the PORT code and matching it would name a
  phantom vessel — so **no Peterhead-registered boat is auto-detected**. None of
  the thirteen real fleets is PD-registered, so it has never bitten, but it
  would for a Peterhead customer. **Not a thing to change without real notes to
  test against**; two P&J buyer fixes already failed for being written blind.
- **The first tally wanted 30 tiers for 1,711 boxes**, against a rule of thumb
  of 19. Spreading volume evenly across grades is mostly premium flat fish, and
  flat fish costs a footprint a box. Weighted like a real trip — hundreds of
  boxes of haddock metro, a handful of turbot — it comes out at 25 for 1,954.

The parsed market reads **"Don Fishing · Peterhead"**, which is the parser's
name for the FORMAT rather than a claim about who issued it; the document
itself is headed SAMPLE FISH SELLING CO and carries the SAMPLE banner in its
text.

### What the note just changed — `UploadSummary.jsx`, `src/lib/salesChange.js`

Uploading a note used to answer with one line of log — *"✓ note.pdf: AUDACIOUS
BF83 13-08-2026 — 1,192 bx, £136,656.50"* — which says the file was read and
nothing about what it did.

**It is for every fleet, not the demo.** A skipper wants the same three facts a
visitor does, and building it demo-only would have been a second code path
nobody exercises.

The panel shows: rows, species and buyers read · boxes, kilos, gross, £/kg ·
whether it reconciled · new landing or **re-read and replaced in place** · what
carried it, with each species' share and price · buyers new to this boat · and
the year before and after.

**THE ARITHMETIC IS A PURE FUNCTION** in `salesChange.js` — no queries, no
rendering — because the arithmetic is the part worth testing, and
`test-sales-change.mjs` runs it against the REAL sample note as well as
fixtures. Three things it pins down:

- **Three reconciliation states, not two.** A note printing no total has not
  failed; it cannot be checked, and calling that "reconciled" is a claim nobody
  made. `reconcile_ok` is nullable for the same reason.
- **"No new buyers" and "nobody looked" must not render alike.** `newBuyers()`
  returns `null` rather than an empty list when the caller holds no known set.
  And Sales.jsx reads the buyers **in full via `fetchAll` or not at all** — a
  truncated 1,000-row read would announce a buyer as new to the boat who has
  been buying off her all year.
- **A replaced note adds no landing.** The count does not move and the value
  moves by the DIFFERENCE. The first cut counted it as an extra and read
  *"1 landing → 2"* for a note that added neither.

`scripts/upload-panel-preview.mjs` server-renders the real component against
the real sample note in all three states, because a preview showing only the
happy case is how the other two ship broken.

### Where the sample documents live — `SampleDocs.jsx`

A card on the two pages that take an upload: **Fish Sales** (the note) and
**Market Layout** (the day tally), above the upload prompt rather than below the
result — a visitor needs the file in his hand before he has a sheet on screen.

**Driven by `fleets.is_demo`, never by the fleet id.** "If this is fleet
...00de" scattered through the pages is a branch on a magic value, and the point
of the demo being a FLEET rather than a MODE is that there are no such branches.
One column on the tenant, and the card renders off the data like everything
else.

The files are static, served out of `public/samples/` by the app itself, so
there is no second host and nothing to keep in step by hand.

## The fuel price is DERIVED, and the loop is closed (Aug 2026)

Not one of the 44 bunkerings carried a price per litre and David will not be
entering them. But the two books the boat already keeps have it between them:
the settlement carries what the fuel COST, the fuel log carries the LITRES.

**AND THE TWO AGREE, which is what makes it safe rather than a guess.**
`su_settlements.fuel_used` matched the litres bunkered between one settling date
and the next **to the litre on 10 of 13 sheets**, and within 1.7% on the other
three — two records kept by different people for different reasons landing on
the same number. That also settles what `fuel_used` is for good: **litres, not
money.**

`derive_fuel_prices(fleet)` writes the settlement's Fuel line ÷ its `fuel_used`
onto every bunkering inside that settling window. Re-runnable as sheets arrive.

    29 of 29 priced · £0.4949 – £0.9472 · 1,221,621 L · £862,504
    weighted average £0.7060 a litre

**It is a period AVERAGE, and every row says so in its notes.** Two lifts at
different prices in one window both get the average and nothing here can tell
them apart — a figure that looks measured but is not is worse than no figure.

### Square Up worksheets are WRITE-ONLY (found Aug 2026)

David: *"I can't see / recall saved worksheets."* He is right, and there are
three separate faults:

- **Nothing ever reads one back.** `loadLatestWorksheet()` is exported from
  `src/lib/su/worksheet.js` and **called by nothing** — `SquareUp.jsx` imports
  only `getWorksheetBoat` and `saveWorksheet`. The working copy lives in
  localStorage; the database copy is written and never opened. Change device or
  clear storage and the worksheet is gone even though it is in the database.
- **There is no list.** The library has no "list worksheets" call at all, so
  there is no way to reach anything but the latest even once the read is wired.
- **Four head columns can never be filled.** `saveWorksheet` destructures
  `tripNo`, `market`, `daysAtSea` and `boxesLanded` out of its state, and
  `SquareUp.jsx` passes none of them — those fields do not exist on the form.
  Both saved rows carry nulls for all four.

Fixed in passing: `notes: haulageNote?.trim() ? null : null` — a ternary whose
arms were both `null`, so the haulage note was discarded whether there was one
or not.

### Engine limits — confirmed Aug 2026, and they do bite

All 50 accepted by David as derived from the boat's own history. Worth knowing
they are not decoration: **0 of 857 current readings breach one** (the data is
clean), and all three known historical slips WOULD have been caught —
charge air 150, lube oil 42, and gearbox oil press 2.8, which is the one where a
rolling average would have flagged the *correct* readings instead.

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

  **Stage 2 part one DONE Aug 2026** (`supabase/vessels_stage2.sql`).

  **457 rows backfilled** — every fleet with exactly one boat, where the answer
  is not a guess but the only possible answer. **Five rows deliberately left
  null**: 4 `rota_trips` because HANSTHOLM has no `vessels` row at all (no
  sales, no quota trips, no vessel_details — there is no name to give a boat,
  and inventing one is worse than an honest null), and 1
  `quota_manual_stocks` because TEST FLEET is a pair and which boat it belongs
  to is not knowable from the row.

  **THE CROSS-TENANT HOLE IS CLOSED ON ALL 20 TABLES.** `fleet_isolation`
  checks `fleet_id` and nothing checked that `vessel_id` pointed at a boat in
  that same fleet — so a row could carry a foreign key across a tenant boundary.
  Found by probe while building the gear log; the other eighteen all had it.
  No row anywhere violated it, so this was pure hardening. Composite FK
  (`(vessel_id, fleet_id) → vessels(id, fleet_id)`) rather than a trigger,
  because a CHECK cannot run a subquery.

  Probed as an officer: an engine log or fuel log on another fleet's boat is
  refused, an **UPDATE** moving a row across is refused too, his own boat is
  allowed, and a NULL vessel is still allowed — which HANSTHOLM needs.

  **PART TWO IS NOT A SCHEMA JOB**, and that is the thing to understand before
  starting it.

  `vessel_details` still has `fleet_id` as its primary key, so a pair team can
  describe only ONE of its two boats. Moving it looks like a migration — but
  every one of the six readers does
  `.from('vessel_details')…maybeSingle()`, which **throws** when a second row
  appears, and `VesselPlate.jsx` is one of them and sits on every page.

  So the schema change on its own does not give a pair fleet two boats. It gives
  it six broken pages. What has to come first is a **CURRENT VESSEL** — a choice
  that persists, which those pages ask for the answer to. Then
  `vessel_details` can carry a row per boat and each page knows which one it is
  showing.

  Order: **current-vessel selection → `vessel_details` off `fleet_id` → the
  pickers on crew, quota and rota.** Pages reading `vessel_id` rather than
  matching on the vessel text falls out of the first of those.

  ### The current vessel — BUILT Aug 2026

  `src/lib/vessels.js`, `VesselContext.jsx`, a picker in `AppShell`.

  **NULL MEANS ALL, NOT NONE.** A pair team's combined view is a real view — one
  net between two boats, and the combined gross is the figure that matters — so
  "no boat chosen" is the default and a deliberate state, not a prompt. A
  single-vessel fleet never sees a picker and `current` is simply that boat, so
  a page can filter unconditionally.

  **THE STORED CHOICE IS VALIDATED AGAINST THIS FLEET'S BOATS, EVERY TIME.** A
  stale id — from another account, or a boat since retired — would filter every
  query to a vessel that is not there; RLS returns nothing for it, so the page
  comes up **empty rather than wrong**, which looks like a boat with no data
  instead of a bad setting. An unrecognised id falls back to all. The storage key
  carries the fleet id for the same reason.

  **"All" applies no filter at all**, rather than `is null or eq` — 5 rows have
  no `vessel_id` and never will (HANSTHOLM's rota trips), and a page showing all
  must not lose them.

  Cached like the vessel particulars on the engine log, because a picker that
  disappears at sea is worse than none. The choice lives in localStorage, not the
  database: it is a view setting, and two people on the same fleet may reasonably
  be looking at different halves of a pair.

  **Four fleets see it**: Boy John + Rosebloom, Guiding Light + Faithlie,
  Our Lass + Victory Rose, Test Fleet. Audacious and the other seven are
  unchanged.

  **A LIVE BUG CAME OUT OF THIS.** `vessels` was NOT in the officer allow-list,
  so an officer read **0 boats** — which means the gear log's "add a net" boat
  dropdown was already empty for the very man meant to keep it, and the new
  picker would never have appeared. The earlier gear probe missed it because it
  tested the WRITE with a vessel_id supplied from SQL, never the read the page
  actually makes. `vessels` is now in his list, **read only** — naming or
  retiring a boat stays the skipper's. Probed: reads 2 on a pair fleet, UPDATE
  affects 0 rows, cannot create one, still reads payments 0 and sales 0.

  The cook is deliberately still denied `vessels`: his stores list is not
  per-vessel yet, and a table joins an allow-list when there is a need.

  ### `vessel_details` off `fleet_id` — BUILT Aug 2026

  `supabase/vessel_details_per_vessel.sql`. The key is now
  **(fleet_id, vessel_id)** and `vessel_id` is required. A pair team can
  finally describe both boats; before this the second one's registration,
  tonnage and dimensions had nowhere to live.

  **Done SECOND on purpose.** All six readers called `.maybeSingle()`, which
  throws the moment a fleet has two rows — this migration on its own would have
  given a pair fleet six broken pages rather than two boats.

  A composite natural key rather than a surrogate id: nothing references this
  table, and a uuid nobody uses is another column to keep in step. It doubles as
  the uniqueness the upsert needs — the page writes
  `onConflict: 'fleet_id,vessel_id'`, and **without that a pair team's second
  save would overwrite the first boat.**

  **`pickDetails()` returns NULL when a pair is showing ALL, deliberately.**
  There is no such thing as a pair's particulars: two boats have two
  registrations and two tonnages, and picking one to stand for both would put
  the wrong PLN on a **FAL 5 crew list** — a wrong official document, not a
  cosmetic slip. `VesselDetails.jsx` asks which boat instead of showing a
  blank form, and reloads when the choice changes so the second boat never
  inherits the first's figures.

  All seven call sites changed: `VesselPlate` (`useVesselDetails`),
  `Dashboard`, `CrewList`, `VesselCerts`, `EngineerHome`, `EngineLogs`,
  `VesselDetails`.

  Probed as a skipper of a pair fleet: **two sets of particulars held**, a
  second row for the same boat refused, the upsert updating in place without
  duplicating, particulars for another fleet's boat refused by the composite FK,
  and a row naming no boat refused.

  `test-vessels.mjs` — 51 checks.

  ### Crew, quota and rota — BUILT Aug 2026. STAGE 2 IS COMPLETE.

  The old note that these three "have no vessel column of any kind" is **stale**:
  stage 1 gave `crew` and `rota_trips` a `vessel_id`, and `quota_lines`
  hangs off `quota_snapshots`, which has one. So the boat is applied on the
  SNAPSHOT and the lines follow their parent, rather than being filtered on a
  column they do not have.

  **QUOTA IS THE ONE THING THAT MUST NEVER BE COMBINED**, and that asymmetry is
  the point of this piece. Sales may be: a pair tows one net and the combined
  gross is the figure that matters. Quota may not — every vessel is a separate
  business with its own allocation, and **summing two boats hides one running
  short behind one that is not**, which is the exact failure the page exists to
  catch. So a pair fleet showing ALL is asked to pick a boat rather than shown a
  total. Deliberate, and a domain rule rather than a limitation.

  **The stamp matters more than the filter.** No pair fleet has a single crew
  record today — all 29 crew belong to Audacious, Beryl and Boy Andrew, which
  are single-vessel — so the crew filter has nothing to do yet. What earns its
  keep is `vessel_id` being set when a man is added or a rota trip created:
  without it a pair team's records would all land unassigned and the picker
  would never have anything to filter. Null on "all" is honest — a man added
  while looking at the whole fleet has not been put on a boat.

  **A crewman quietly missing off a list is the failure guarded against.**
  Filtering to one boat hides anyone not yet assigned, so the page counts them
  and says where they went rather than letting the total silently drop. A crew
  list is a border document.

  `PickABoat.jsx` carries the wording, because three pages now ask and **the
  REASON differs every time and the reason is the message** — a crew list needs
  one boat because it is an official document, quota because combining hides a
  shortfall. "Pick a boat" alone would lose that. It also says WHERE to answer,
  since the control is in the sidebar and a man reading the middle of the screen
  has no reason to look there.
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
