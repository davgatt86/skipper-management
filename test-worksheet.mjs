/* The Square Up worksheet, saved and read back.
 *
 * THIS TEST EXISTS BECAUSE THE READ PATH DID NOT. The save was written first,
 * `loadLatestWorksheet` returned only the head and was called by nothing at
 * all, and so nobody ever found out whether what went in could come out again.
 * Two things were wrong and neither was visible from the page:
 *
 *  - the haulage note was discarded by a ternary whose arms were both `null`;
 *  - the BOND was totalled on the crewman's NAME while every other reader in
 *    the app — BondSection, Preview, pdfGenerator — assigns and reads it by his
 *    ID, so every worksheet ever kept recorded every man's bond as zero.
 *
 * A round trip is the only test that would have caught either.
 */
import assert from 'node:assert/strict'
import { stateToRows, rowsToState } from './src/lib/su/worksheetShape.js'

let n = 0
const ok = (c, m) => { n++; assert.ok(c, m) }
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }

const BOAT = 'boat-1'

/* A full sheet, with something in every section. */
const state = {
  tripDate: '2026-08-13', tripNo: '64', market: 'Peterhead',
  daysAtSea: '6.75', boxesLanded: '1192', quota: '10',
  haulageNote: 'Second load went direct to the smokehouse.',
  crew: [
    { id: 'c1', rosterId: 'r1', name: 'David Gatt', shareKey: 'full', shareCustom: '', bonus: '1.5' },
    { id: 'c2', rosterId: null, name: 'Barry Reid', shareKey: '6_8', shareCustom: '', bonus: '' },
    { id: 'c3', rosterId: null, name: 'Kitty', shareKey: 'custom', shareCustom: '148', bonus: '0.5' },
  ],
  bondItems: [
    { id: 'b1', description: 'Baccy', qty: 2, unitPrice: 12.5, amount: 25, assignedTo: 'c1' },
    { id: 'b2', description: 'Phone', qty: 1, unitPrice: 40, amount: 40, assignedTo: 'c1' },
    { id: 'b3', description: 'Sundry', qty: 1, unitPrice: 18, amount: 18, assignedTo: 'c3' },
    { id: 'b4', description: 'Galley', qty: 1, unitPrice: 60, amount: 60, assignedTo: 'stores' },
    { id: 'b5', description: 'Nobody', qty: 1, unitPrice: 9, amount: 9, assignedTo: null },
  ],
  fuel: [{ id: 'f1', location: 'Peterhead', date: '2026-08-05', litres: '38000' }],
  haulage: [{ id: 'h1', haulier: 'Nor-Sea', from: 'Scrabster', loads: '2', note: 'both chilled' }],
  labour: [
    { id: 'l1', name: 'Boxing', basis: 'box', boxes: '1192', rate: '0.35', amount: '417.2' },
    { id: 'l2', name: 'Washing', basis: 'flat', boxes: '', rate: '', amount: '150' },
  ],
  foreignCrew: [{ id: 'x1', name: 'Elizer Tano', bonus: '250' }],
}

/* Rows come back from PostgREST as the DATABASE holds them — numerics as
 * numbers, absent columns as null — not as the object the writer built. Model
 * that, or the test proves only that two functions agree on a shape neither of
 * them will ever be handed. */
const asStored = ({ head, lines, crewRows }) => ({
  head: { id: 'ws-1', settlement_id: null, ...head },
  lines: lines.map((l, i) => ({
    id: 'ln-' + i, section: null, label: null, detail: null, note: null,
    entry_date: null, qty: null, unit: null, basis: null, rate: null, amount: null,
    ...l,
  })),
  crewRows: crewRows.map((c, i) => ({ id: 'cr-' + i, ...c })),
})

const stored = asStored(stateToRows(state, BOAT))
const back = rowsToState(stored.head, stored.lines, stored.crewRows)

// --- the head -------------------------------------------------------------
eq(back.tripDate, '2026-08-13', 'trip date')
eq(back.tripNo, '64', 'trip no')
eq(back.market, 'Peterhead', 'market')
eq(back.daysAtSea, '6.75', 'days at sea')
eq(back.boxesLanded, '1192', 'boxes landed')
eq(back.quota, '10', 'quota')
eq(back.worksheetId, 'ws-1', 'worksheet id')

/* THE NOTE. Both arms of the ternary that wrote it were `null`, so it was
 * discarded whether there was one or not. */
eq(back.haulageNote, state.haulageNote, 'haulage note survives')

// --- the lines ------------------------------------------------------------
const strip = rows => rows.map(({ id, ...r }) => r)
eq(strip(back.fuel), strip(state.fuel), 'fuel round-trips')
eq(strip(back.haulage), strip(state.haulage), 'haulage round-trips')
eq(strip(back.labour), strip(state.labour), 'labour round-trips')
eq(strip(back.foreignCrew), strip(state.foreignCrew), 'foreign crew bonuses round-trip')

/* The carried-over note is written as a haulage LINE as well as onto the head.
 * A reader that did not know to skip it would show a phantom haulier called
 * "Carried over from Logistics" with no loads against it. */
ok(!back.haulage.some(h => h.haulier.startsWith('Carried over')),
   'the note is not read back as a haulier')

// --- the crew -------------------------------------------------------------
eq(back.crew.map(c => c.name), ['David Gatt', 'Barry Reid', 'Kitty'], 'crew names and order')
eq(back.crew.map(c => c.shareKey), ['full', '6_8', 'custom'], 'share keys')
eq(back.crew.map(c => c.shareCustom), ['', '', '148'], 'custom share value')
/* A man with no bonus comes back with a BLANK box, not a literal '0'. The
 * figure is a share adjustment and zero is the absence of one, so printing it
 * would put a number in front of the skipper that nobody entered. */
eq(back.crew.map(c => c.bonus), ['1.5', '', '0.5'], 'crew bonuses, and no bonus reads blank')

// --- THE BOND -------------------------------------------------------------
/* Assigned by id everywhere in the app; the save totalled on name and so wrote
 * zero for everybody, on every worksheet ever kept. */
const sumBondFor = (items, target) =>
  items.filter(b => b.assignedTo === target).reduce((s, b) => s + (Number(b.amount) || 0), 0)

eq(stored.crewRows.map(c => Number(c.bond)), [65, 0, 18], 'bond totals are stored per man')
eq(sumBondFor(back.bondItems, back.crew[0].id), 65, "David's bond comes back whole")
eq(sumBondFor(back.bondItems, back.crew[2].id), 18, "Kitty's bond comes back")
eq(sumBondFor(back.bondItems, back.crew[1].id), 0, 'a man with no bond has none')

/* WHAT DOES NOT SURVIVE, stated rather than papered over: the itemisation.
 * Only each man's total is stored, so David's two items return as one line. */
eq(back.bondItems.filter(b => b.assignedTo === back.crew[0].id).length, 1,
   'two bond items return as one line — only the total was ever kept')

/* The stores and unassigned bonds are not kept at all: they hang off no crew
 * row, so there is nowhere for them to live. */
eq(sumBondFor(back.bondItems, 'stores'), 0, 'the stores bond is not stored')
ok(!back.bondItems.some(b => b.assignedTo == null), 'an unassigned bond is not stored')

// --- a second trip through is stable --------------------------------------
/* Opening a kept sheet and keeping it again must not quietly change a figure.
 * This is what makes the bond keying safe: the ids `rowsToState` mints have to
 * be the ones `stateToRows` then totals on. */
const s2 = asStored(stateToRows(back, BOAT))
const twice = rowsToState(s2.head, s2.lines, s2.crewRows)
eq(twice.crew.map(c => c.name), back.crew.map(c => c.name), 'crew stable on a second trip')
eq(sumBondFor(twice.bondItems, twice.crew[0].id), 65, 'bond stable on a second trip')
eq(twice.haulageNote, state.haulageNote, 'note stable on a second trip')
eq(strip(twice.labour), strip(back.labour), 'labour stable on a second trip')
eq(strip(twice.fuel), strip(back.fuel), 'fuel stable on a second trip')

// --- empties and edges ----------------------------------------------------
eq(rowsToState(null), null, 'a missing head gives null, not a half-built object')

const bare = rowsToState({
  id: 'w', landed_date: null, trip_no: null, market: null, days_at_sea: null,
  boxes_landed: null, quota_recovery_pct: null, notes: null,
}, [], [])
eq(bare.crew, [], 'no crew')
eq(bare.bondItems, [], 'no bond')
eq(bare.haulageNote, '', 'a missing note reads blank, never the word "null"')
eq(bare.quota, '',
   'a missing quota is blank — NOT defaulted to 10, which would look like a figure somebody chose')

/* A blank-named crewman is dropped on save, and the men after him must not
 * take his bond with them — the indexing has to survive the filter. */
const gappy = stateToRows({
  crew: [{ id: 'a', name: '', shareKey: 'full' }, { id: 'b', name: 'Real Man', shareKey: 'full' }],
  bondItems: [{ id: 'z', amount: 30, assignedTo: 'b' }],
}, BOAT)
eq(gappy.crewRows.length, 1, 'a nameless crewman is not saved')
eq(Number(gappy.crewRows[0].bond), 30, 'and the bond stays with the man it belongs to')

/* Same on the way back: a man with no bond must not shift the pairing of the
 * men after him onto the wrong names. */
const gapBack = rowsToState({ id: 'w' }, [], [
  { crew_name: 'No Bond', bond: 0, share_key: 'full' },
  { crew_name: 'Has Bond', bond: 40, share_key: 'full' },
])
eq(gapBack.bondItems.length, 1, 'one bond line')
eq(gapBack.bondItems[0].assignedTo, gapBack.crew[1].id,
   'and it is against the right man, not the first one in the list')

/* An empty row in any section is skipped rather than saved blank. */
const empties = stateToRows({
  fuel: [{ id: 'f', location: '', litres: '' }],
  haulage: [{ id: 'h', haulier: '', loads: '' }],
  labour: [{ id: 'l', name: '', amount: '' }],
  foreignCrew: [{ id: 'x', name: '', bonus: '' }],
}, BOAT)
eq(empties.lines.length, 0, 'blank rows are not written')

/* The office is handed quantities, so a figure typed with its unit still has
 * to arrive as a number. */
eq(stateToRows({ fuel: [{ location: 'Peterhead', litres: '38,000 lt' }] }, BOAT).lines[0].qty,
   38000, 'a quantity typed with commas and a unit still stores as a number')

// --- THE ROLE AND ITS LANDINGS SURVIVE ------------------------------------
/* The bonus percentage is DERIVED from the role and the landings held. Storing
 * only the percentage is how the bond went wrong: reopening the sheet would
 * recompute every man as if he had done every landing, and quietly change what
 * two of them were owed. */
{
  const withRoles = {
    ...state,
    landings: '2',
    crew: [
      { id: 'c1', name: 'David Gatt', shareKey: 'full', shareCustom: '', bonus: '3', role: 'skipper' },
      { id: 'c2', name: 'Norman Wood', shareKey: 'full', shareCustom: '', bonus: '0.25', role: 'engineer', roleLandings: [1] },
      { id: 'c3', name: 'Animal', shareKey: 'full', shareCustom: '', bonus: '0.25', role: 'engineer', roleLandings: [2] },
    ],
    bondItems: [],
  }
  const st = asStored(stateToRows(withRoles, BOAT))
  const back2 = rowsToState(st.head, st.lines, st.crewRows)

  eq(back2.landings, '2', 'the landing count comes back')
  eq(back2.crew.map(c => c.role), ['skipper', 'engineer', 'engineer'], 'and every role')
  eq(back2.crew.map(c => c.roleLandings), [[], [1], [2]],
     'with the landings each man held it on — empty meaning all of them')
  eq(back2.crew.map(c => c.bonus), ['3', '0.25', '0.25'], 'and the figures they produced')

  /* The two engineers must not come back looking like they both did both
     landings — that would double the engineer bonus on the next save. */
  ok(back2.crew[1].roleLandings.length === 1 && back2.crew[2].roleLandings.length === 1,
     'one landing each, not both')

  const twice2 = (() => { const s = asStored(stateToRows(back2, BOAT)); return rowsToState(s.head, s.lines, s.crewRows) })()
  eq(twice2.crew.map(c => c.roleLandings), [[], [1], [2]], 'stable on a second trip through')
  eq(twice2.landings, '2', 'and so is the landing count')
}

// A man with no role stores nothing rather than an empty string.
{
  const st = asStored(stateToRows({ crew: [{ id: 'x', name: 'Deckhand', shareKey: 'full' }] }, BOAT))
  eq(st.crewRows[0].role, null, 'no role is null, not blank')
  eq(st.crewRows[0].role_landings, null, 'and no landings either')
}

console.log('worksheet round trip: ' + n + ' checks passed')
