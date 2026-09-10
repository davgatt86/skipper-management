import assert from 'node:assert'
import {
  ITEMS, itemOf, predeparture, nextAfterCrewList,
  GUIDES, DEFAULT_GUIDES, resolveGuides, statutoryFor, guidesFor, crewChangeBetween, SKIP_NOTE,
} from './src/lib/certification/predeparture.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

const DEP = '2026-09-10'
const PREV = '2026-09-01'
const base = { departureAt: DEP, previousDepartureAt: PREV, asOf: DEP }
/* Shaped like the real rows: the Official Log Book dates its entries
   `occurred_on` and the radio log uses `log_date`. Written from the tables
   rather than from the module, because a fixture invented to match the code
   proves the logic and not the column names. */
const olb = (nn, date) => ({ entry_n: nn, occurred_on: date })

/* ---- THE THREE CLASSES ARE THE WHOLE THING -----------------------------
 * A checklist demanding all eight every trip would fire on the ordinary case
 * and stop being read inside a fortnight — the fault this repo records against
 * the 6,236 unread alerts and against a red bar on 0.4 t of skate.
 */
{
  const kinds = new Set(ITEMS.map((i) => i.cls))
  eq([...kinds].sort(), ['due', 'every', 'ifHappened'], 'three classes, not one')
  ok(ITEMS.every((i) => i.why), 'every item says why it is on the list')
  ok(ITEMS.every((i) => i.to), 'and where the entry actually gets made')
  /* NOTHING IS KEPT HERE. Each item points at the book that owns it — a second
     copy of a legal record is the parse-core failure all over again. */
  ok(ITEMS.filter((i) => i.cls === 'due').every((i) => i.olb), 'the due ones name their OLB entry')
}

/* ---- FRESH WATER AND PROVISIONS ARE ONE ENTRY, NOT TWO -----------------
 * David listed them separately. SI 1981/570 puts them together at 18:
 * "Inspection of provisions and water, and the result of it". Asking twice
 * would be asking for an entry the book does not have.
 */
{
  const water = ITEMS.filter((i) => /water|provision/i.test(i.label))
  eq(water.length, 1, 'one item covers provisions and fresh water')
  eq(water[0].olb, 18, 'and it is OLB entry 18')
  ok(/one inspection/.test(water[0].why), 'and it says so, so nobody re-splits it')
}

/* ---- AN ENTRY FOR THE LAST TRIP DOES NOT COUNT FOR THIS ONE ------------ */
{
  const before = predeparture({
    ...base,
    crewLists: [{ departure_date: '2026-08-30' }],   // the trip before last
  })
  eq(before.items.find((i) => i.key === 'crew_list').state, 'outstanding',
     'a crew list from an earlier trip is not this trip’s')

  const now = predeparture({ ...base, crewLists: [{ departure_date: DEP }] })
  eq(now.items.find((i) => i.key === 'crew_list').state, 'done',
     'one lodged for this departure is')

  /* The window opens AFTER the last sailing, so a list made on the day she last
     sailed belongs to that trip. */
  const onPrev = predeparture({ ...base, crewLists: [{ departure_date: PREV }] })
  eq(onPrev.items.find((i) => i.key === 'crew_list').state, 'outstanding',
     'and one made on the previous departure day belongs to that one')
}

/* ---- A DRILL DONE LAST WEEK IS NOT OUTSTANDING TODAY -------------------
 * The heart of it. OLB 7 runs to 30 days, not to every departure.
 */
{
  const fresh = predeparture({ ...base, olbEntries: [olb(7, '2026-09-05')] })
  const d = fresh.items.find((i) => i.key === 'olb_drills')
  eq(d.state, 'done', 'a drill five days ago is not wanted again because she is sailing')
  ok(!fresh.outstanding.some((i) => i.key === 'olb_drills'), 'and is not on the outstanding list')

  /* The SAME date for both, so the only difference is the interval. */
  const stale = predeparture({ ...base, olbEntries: [olb(7, '2026-07-01'), olb(21, '2026-07-01')] })
  /* A GUIDE IS NOT A TARGET. David: "intervals are guide not targets. we can
     do and log drills and tests weekly, fortnightlly or monthly." SI 1981/570
     says WHAT to enter, not how often to hold a drill — so nothing here is
     'overdue', which asserts a breach of a calendar nobody set. */
  eq(stale.items.find((i) => i.key === 'olb_drills').state, 'overdue', 'one from July is past the statutory month')
  eq(stale.items.find((i) => i.key === 'olb_drills').age, 71, 'and it says how long it has been')

  /* Steering gear is quarterly, so the same date is fine for it and not for the
     drill — which is why an interval per entry matters. */
  eq(stale.items.find((i) => i.key === 'olb_steering').state, 'done',
     'the same date is inside the quarterly steering interval')
}

/* ---- NEVER DONE IS NOT OVERDUE BY A NUMBER OF DAYS --------------------- */
{
  const none = predeparture(base)
  const d = none.items.find((i) => i.key === 'olb_drills')
  eq(d.state, 'never', 'a drill never recorded has its own state')
  eq(d.last, null, 'with no date to count from')
  ok(!('age' in d) || d.age == null, 'and no invented number of days')
  ok(none.outstanding.some((i) => i.key === 'olb_drills'), 'it is still something to act on')
}

/* ---- AN EMPTY BOOK IS NOT PROOF NOTHING HAPPENED -----------------------
 * The check used to resolve these to "nothing to record" whenever it found no
 * rows in the window. That is an assumption wearing a fact's clothes: an empty
 * fuel log means either that nothing was bunkered, or that the bunkering was
 * never written up, and those are opposite conclusions. The app cannot tell
 * them apart, so it ASKS.
 */
{
  const quiet = predeparture(base)
  eq(quiet.items.find((i) => i.key === 'garbage').state, 'ask',
     'no garbage entries is a question, not an all-clear')
  eq(quiet.items.find((i) => i.key === 'bunkering').state, 'ask',
     'and so is no oil movement')
  eq(quiet.asking.map((i) => i.key), ['bunkering', 'garbage'],
     'both are on the list of things still to answer')
  /* STILL TO ANSWER IS NOT A GAP AND NOT A BREACH. */
  ok(!quiet.outstanding.some((i) => ['garbage', 'bunkering'].includes(i.key)),
     'and neither is counted as not done')
  ok(!quiet.watch.some((i) => ['garbage', 'bunkering'].includes(i.key)),
     'nor as past an interval')
}

/* ---- SKIPPING SAYS IT DID NOT HAPPEN, FOR ONE DEPARTURE ----------------
 * David: "page can request a log to anything, user should be able skip if it
 * didn't happen."
 */
{
  const skip = (key, on = DEP) => ({ departure_on: on, item_key: key, skipped_name: 'B Reid' })

  const done = predeparture({ ...base, skips: [skip('garbage')] })
  const g = done.items.find((i) => i.key === 'garbage')
  eq(g.state, 'skipped', 'a skipped item says so')
  eq(g.skip.skipped_name, 'B Reid', 'and carries who said it')
  ok(!done.asking.some((i) => i.key === 'garbage'), 'and is no longer being asked')

  /* ANY ROW, not just the two that ask. A drill genuinely not held is a real
     answer. */
  const noDrill = predeparture({ ...base, skips: [skip('olb_drills')] })
  eq(noDrill.items.find((i) => i.key === 'olb_drills').state, 'skipped',
     'a drill can be skipped too')
  ok(!noDrill.outstanding.some((i) => i.key === 'olb_drills'),
     'and stops counting as not done')
  /* AND THE BOOK HAS A PLACE FOR IT. SI 1981/570 entry 8 is "the reason a
     muster, drill or inspection was NOT held when it should have been", so
     skipping one sends a man there rather than quietly closing the question. */
  ok(/entry 8/.test(SKIP_NOTE.olb_drills), 'and the book wants the reason at entry 8')

  /* PER DEPARTURE, NEVER STANDING. */
  const other = predeparture({ ...base, skips: [skip('garbage', '2026-08-22')] })
  eq(other.items.find((i) => i.key === 'garbage').state, 'ask',
     'a skip on another departure does not answer this one')

  /* IT NEVER OVERRIDES A DONE. Saying a thing did not happen when the book says
     it did would make the checklist disagree with the record it is reading, and
     the record wins. */
  const both = predeparture({
    ...base,
    garbageRows: [{ id: 'g1', entry_date: '2026-09-06' }],
    skips: [skip('garbage')],
  })
  eq(both.items.find((i) => i.key === 'garbage').state, 'done',
     'an entry in the book beats a claim that nothing happened')

  eq(predeparture({ ...base, skips: null }).asking.length, 2, 'no skips is handled')
}

/* ---- BUT AN EVENT WITH NO ENTRY IS ------------------------------------- */
{
  const bunkered = predeparture({
    ...base,
    fuelRows: [{ id: 'f1', entry_date: '2026-09-08', kind: 'fuel', litres: 18400 }],
    orbEntries: [],
  })
  const b = bunkered.items.find((i) => i.key === 'bunkering')
  eq(b.state, 'outstanding', 'fuel taken and no Oil Record Book entry is a gap')
  eq(b.unrecorded, 1, 'and it says how many')

  const recorded = predeparture({
    ...base,
    fuelRows: [{ id: 'f1', entry_date: '2026-09-08', kind: 'fuel', litres: 18400 }],
    orbEntries: [{ id: 'e1', fuel_log_id: 'f1' }],
  })
  eq(recorded.items.find((i) => i.key === 'bunkering').state, 'done',
     'and once the entry is made it is not')
}

/* ---- IT NEVER SAYS SHE IS READY TO SAIL --------------------------------
 * It reports what is done and what is not. "Ready" is a claim about a vessel
 * and her crew that no software can make out of four tables, and a green tick
 * against a departure is the sort of thing read back at an inquiry.
 */
{
  const all = predeparture({
    ...base,
    crewLists: [{ departure_date: DEP }],
    radioEntries: [{ kind: 'test', log_date: DEP }],
    olbEntries: [olb(7, '2026-09-05'), olb(17, '2026-09-05'), olb(18, '2026-09-05'), olb(21, '2026-09-05')],
  })
  eq(all.outstanding, [], 'everything done leaves nothing outstanding')
  ok(!('ready' in all), 'and there is no "ready" anywhere in the answer')
  ok(!('percent' in all) && !('score' in all), 'nor a score')
}

/* ---- NO DEPARTURE, NO CHECK -------------------------------------------- */
{
  const nil = predeparture({ crewLists: [{ departure_date: DEP }] })
  eq(nil.known, false, 'without a departure date there is nothing to check against')
  eq(nil.items, [], 'and no items are claimed either way')
  eq(predeparture().known, false, 'and nothing at all does not throw')
}

/* ---- WHAT THE CREW LIST PAGE SAYS AFTERWARDS ---------------------------
 * David: "when a crew list is lodged/saved, should the page direct the person
 * to do the rest of the entries?" — yes, and to the NEXT one, not all of them.
 */
{
  const check = predeparture({
    ...base,
    crewLists: [{ departure_date: DEP }],
    fuelRows: [{ id: 'f1', entry_date: '2026-09-08' }],
  })
  const nx = nextAfterCrewList(check)
  ok(nx, 'there is something to point at')
  ok(nx.next.key !== 'crew_list', 'and it is never the thing just done')
  ok(nx.remaining >= 1, 'with how many are left behind it')
  /* A LIST OF SEVEN AFTER SAVING ONE IS A WALL. The next single thing is an
     instruction. */
  ok(!Array.isArray(nx.next), 'one thing, not a list')

  const done = predeparture({
    ...base,
    crewLists: [{ departure_date: DEP }],
    radioEntries: [{ kind: 'test', log_date: DEP }],
    olbEntries: [olb(7, DEP), olb(17, DEP), olb(18, DEP), olb(21, DEP)],
  })
  eq(nextAfterCrewList(done), null, 'and nothing to say when there is nothing left')
  eq(nextAfterCrewList({ known: false }), null, 'nor without a departure')
}

/* ---- TWO CLOCKS: THE LAW'S, AND THE BOAT'S OWN ------------------------
 * David: "i didn't mean to put the reporting periods as guides. i was just
 * pointing out that we can log in periods less than the minimum stautuary
 * recquirement."
 *
 * So the statutory interval is a MAXIMUM and going past it is a breach; the
 * boat's own cadence is shorter, and going past that alone is her own standard
 * rather than the law's.
 */
{
  /* Past the boat's weekly cadence, well inside the statutory month. */
  const own = predeparture({
    ...base,
    guides: resolveGuides({ 7: 7 }),
    olbEntries: [olb(7, '2026-08-31')],
  })
  const d = own.items.find((i) => i.key === 'olb_drills')
  eq(d.state, 'watch', 'past her own cadence but inside the statutory is a watch')
  eq(d.age, 10, 'ten days')
  ok(!own.outstanding.some((i) => i.key === 'olb_drills'), 'and NOT counted as not done')
  ok(own.watch.some((i) => i.key === 'olb_drills'), 'it is on the watch list')

  /* Past the statutory month. That IS a breach, whatever she set for herself. */
  const breach = predeparture({
    ...base,
    guides: resolveGuides({ 7: 7 }),
    olbEntries: [olb(7, '2026-07-01')],
  })
  const b = breach.items.find((i) => i.key === 'olb_drills')
  eq(b.state, 'overdue', 'past the statutory interval is overdue and says so')
  ok(breach.outstanding.some((i) => i.key === 'olb_drills'),
     'and it counts as not done, not as a matter of preference')

  /* THE STATUTORY CHECK FIRES INDEPENDENTLY, so a cadence set longer than the
     law — or none at all — cannot hide a breach. */
  const noGuide = predeparture({
    ...base,
    guides: resolveGuides({ 7: null }),
    olbEntries: [olb(7, '2026-07-01')],
  })
  eq(noGuide.items.find((i) => i.key === 'olb_drills').state, 'overdue',
     'setting no cadence of her own does not switch the statutory off')

  const tooLong = predeparture({
    ...base,
    guides: { ...DEFAULT_GUIDES, 7: 365 },
    olbEntries: [olb(7, '2026-07-01')],
  })
  eq(tooLong.items.find((i) => i.key === 'olb_drills').state, 'overdue',
     'nor does setting a cadence longer than the law allows')

  /* And inside both, it is simply done. */
  const fine = predeparture({
    ...base,
    guides: resolveGuides({ 7: 7 }),
    olbEntries: [olb(7, '2026-09-08')],
  })
  eq(fine.items.find((i) => i.key === 'olb_drills').state, 'done', 'inside both is done')
}

/* ---- WHERE THE STATUTORY FIGURES COME FROM IS RECORDED -----------------
 * They are not all the same kind of thing. The ORB items were TRANSCRIBED from
 * Appendix III and the OLB entries from SI 1981/570; these are the skipper's
 * own reading — David: "i believe most are monthly" — which is the best
 * authority available and is not a citation.
 */
{
  for (const nn of [7, 17, 18]) {
    const st = statutoryFor(nn)
    eq(st.days, 30, 'entry ' + nn + ' is monthly, on the skipper’s word')
    eq(st.basis, 'skipper', 'and the basis says whose word it is')
    ok(st.source, 'with the source written out')
  }
  /* HE SAID "MOST", AND DID NOT NAME THIS ONE. Reading "most" as "all" would be
     putting a figure in his mouth, so steering keeps its quarterly AND keeps
     saying it is unchecked. */
  eq(statutoryFor(21).days, 90, 'steering is quarterly')
  /* David: "steering gear can be quarterly." */
  eq(statutoryFor(21).basis, 'skipper', 'and steering is on his word too now')
  eq(statutoryFor(99), null, 'an entry with no statutory interval has none')
}

/* ---- EVERY VOYAGE IS NOT A NUMBER OF DAYS ------------------------------
 * David: "it's good practice to do drills and tests every time a voyage starts."
 * A boat in port every trip can hold them every trip, and counting days would
 * call a drill held LAST voyage "done" on this one.
 */
{
  const perVoyage = resolveGuides({ 7: 'voyage' })
  eq(perVoyage[7], 'voyage', 'every voyage survives the merge as itself')

  /* Held on the previous voyage: inside the statutory month, and NOT done for
     this departure. A day count would have called this done. */
  const lastTrip = predeparture({
    ...base, guides: perVoyage, olbEntries: [olb(7, PREV)],
  })
  const a = lastTrip.items.find((i) => i.key === 'olb_drills')
  eq(a.state, 'watch', 'a drill held last voyage is not this voyage’s')
  eq(a.perVoyage, true, 'the row knows it is a per-voyage cadence')
  eq(a.thisVoyage, false, 'and that nothing was held in this window')

  const held = predeparture({
    ...base, guides: perVoyage, olbEntries: [olb(7, '2026-09-08')],
  })
  eq(held.items.find((i) => i.key === 'olb_drills').state, 'done',
     'one held since she last sailed is done')

  /* AND THE STATUTORY STILL FIRES OVER THE TOP. */
  const old = predeparture({
    ...base, guides: perVoyage, olbEntries: [olb(7, '2026-07-01')],
  })
  eq(old.items.find((i) => i.key === 'olb_drills').state, 'overdue',
     'per-voyage does not switch the statutory month off')

  eq(guidesFor(7).map((g) => g.key).includes('voyage'), true,
     'every voyage is offered even on a monthly entry')
}

/* ---- A CHANGE OF CREW IS ITS OWN REASON --------------------------------
 * David: "esp when there has been a change in the crew." The app knows who was
 * on the last list and who is on this one, so it can say so.
 */
{
  const was = [{ crew_id: 'a', full_name: 'Barry Reid' }, { crew_id: 'b', full_name: 'Alfie Reid' }]
  const now = [{ crew_id: 'a', full_name: 'Barry Reid' }, { crew_id: 'c', full_name: 'Edgel Bigno' }]

  const ch = crewChangeBetween(was, now)
  eq(ch.changed, true, 'a new man is a change')
  /* IT REPORTS WHO JOINED, NOT A COUNT. "Two changed" tells nobody which drill
     to hold or who to walk round the boat. */
  eq(ch.joined, ['Edgel Bigno'], 'and it says who, by name')
  eq(crewChangeBetween(was, was).changed, false, 'the same crew is no change')

  /* A MAN WHO LEFT IS NOT A JOINER. The drill is for the man who has not had
     it, and nobody who has gone needs one. */
  eq(crewChangeBetween(was, [{ crew_id: 'a', full_name: 'Barry Reid' }]).changed, false,
     'somebody leaving is not a reason to hold a drill')

  /* NO PREVIOUS LIST IS NOT "EVERYBODY IS NEW" — there is nothing to compare
     with, and it would fire on the first voyage the app ever sees. */
  const first = crewChangeBetween([], now)
  eq(first.changed, false, 'with no earlier list nothing is claimed')
  eq(first.known, false, 'and it says the comparison could not be made')

  /* Matched on crew_id where there is one, and on the name only where there is
     not — a man added by hand for one trip has no crew record. */
  eq(crewChangeBetween([{ full_name: 'Lorenzo  RUSIANA' }], [{ full_name: 'lorenzo rusiana' }]).changed,
     false, 'a hand-added man is matched on his name, spacing and case aside')

  /* IT NEVER TURNS A DONE INTO A NOT-DONE. It is a reason the drill is worth
     holding, added to the row — not a state of its own. */
  const withChange = predeparture({
    ...base, guides: resolveGuides({ 7: 'voyage' }),
    olbEntries: [olb(7, PREV)], crewChange: ch,
  })
  const d = withChange.items.find((i) => i.key === 'olb_drills')
  eq(d.forNewCrew, true, 'the drill row carries the crew change')
  eq(d.crewChange.joined, ['Edgel Bigno'], 'with the man who joined')

  const alreadyHeld = predeparture({
    ...base, guides: resolveGuides({ 7: 'voyage' }),
    olbEntries: [olb(7, '2026-09-08')], crewChange: ch,
  })
  eq(alreadyHeld.items.find((i) => i.key === 'olb_drills').state, 'done',
     'a drill already held this voyage stays done')
  eq(alreadyHeld.items.find((i) => i.key === 'olb_drills').forNewCrew, false,
     'and the crew change is not raised against it')

  /* ONLY THE CREW-SENSITIVE ROW. Provisions and water do not care who joined. */
  eq(withChange.items.find((i) => i.key === 'olb_provisions_water').forNewCrew, false,
     'a change of crew is not a reason to inspect the water')
}

/* ---- SHE MAY LOG OFTENER, NEVER LESS OFTEN ----------------------------- */
{
  eq(GUIDES.map((g) => g.days), [7, 14, 30, 90, 'voyage', null], 'the cadences on offer')
  /* OFFERING A LONGER ONE WOULD BE OFFERING TO BREACH. */
  eq(guidesFor(7).map((g) => g.days), [7, 14, 30, 'voyage', null],
     'a monthly entry offers weekly, fortnightly, monthly and every voyage — never quarterly')
  eq(guidesFor(21).map((g) => g.days), [7, 14, 30, 90, 'voyage', null],
     'and a quarterly one offers all of them')
  ok(guidesFor(7).some((g) => g.days == null), 'keeping to the statutory is always on offer')

  eq(resolveGuides(null), DEFAULT_GUIDES, 'nothing stored keeps the shipped cadences')
  eq(resolveGuides({ 7: 7 })[7], 7, 'a weekly drill is honoured')
  /* ONLY THE DIFFERENCE IS STORED, so a later correction reaches every boat
     that has not deliberately changed it. */
  eq(resolveGuides({ 7: 7 })[21], 90, 'and the rest are untouched')
  eq(resolveGuides({ 7: null })[7], null, 'no cadence of her own is kept as none')
  eq(resolveGuides({ 7: 0 })[7], 30, 'while nought is not a cadence and falls back')
  eq(resolveGuides({ 7: 'soon' })[7], 30, 'and neither is rubbish')
}

/* ---- the lookup --------------------------------------------------------- */
{
  eq(itemOf('crew_list').cls, 'every', 'items can be looked up by key')
  eq(itemOf('nonsense'), null, 'and a key that is not one gives nothing')
}

console.log('pre-departure: ' + n + ' checks passed')
