import assert from 'node:assert'
import { ITEMS, itemOf, predeparture, nextAfterCrewList } from './src/lib/certification/predeparture.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

const DEP = '2026-09-10'
const PREV = '2026-09-01'
const base = { departureAt: DEP, previousDepartureAt: PREV, asOf: DEP }
const olb = (nn, date) => ({ entry_n: nn, entry_date: date })

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
  eq(stale.items.find((i) => i.key === 'olb_drills').state, 'overdue', 'one from July is')
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

/* ---- THE ABSENCE OF THE EVENT IS NOT A GAP -----------------------------
 * There is no missing garbage entry when nothing went ashore.
 */
{
  const quiet = predeparture(base)
  eq(quiet.items.find((i) => i.key === 'garbage').state, 'nothing', 'no garbage, no entry wanted')
  eq(quiet.items.find((i) => i.key === 'bunkering').state, 'nothing', 'no oil moved, nothing to record')
  ok(!quiet.outstanding.some((i) => ['garbage', 'bunkering'].includes(i.key)),
     'and neither is outstanding')
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
    radioEntries: [{ kind: 'test', entry_date: DEP }],
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
    radioEntries: [{ kind: 'test', entry_date: DEP }],
    olbEntries: [olb(7, DEP), olb(17, DEP), olb(18, DEP), olb(21, DEP)],
  })
  eq(nextAfterCrewList(done), null, 'and nothing to say when there is nothing left')
  eq(nextAfterCrewList({ known: false }), null, 'nor without a departure')
}

/* ---- the lookup --------------------------------------------------------- */
{
  eq(itemOf('crew_list').cls, 'every', 'items can be looked up by key')
  eq(itemOf('nonsense'), null, 'and a key that is not one gives nothing')
}

console.log('pre-departure: ' + n + ' checks passed')
