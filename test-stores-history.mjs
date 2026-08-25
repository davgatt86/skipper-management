/* "Regularly ordered" — and the discipline about not saying that too early.
 *
 * The ranking is easy to get plausibly wrong: rank on recency and a one-off
 * bought last week outranks the bread bought every trip, which is the exact
 * distinction the panel exists to draw.
 */
import assert from 'node:assert/strict'
import {
  historyLists, median, orderHistory, heading, basis, itemNote,
} from './src/lib/stores/history.js'

let n = 0
const ok = (c, m) => { n++; assert.ok(c, m) }
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }

// --- median ---------------------------------------------------------------
eq(median([5]), 5, 'one value')
eq(median([1, 3]), 2, 'two values average')
eq(median([1, 2, 30]), 2, 'the middle, so one heavy trip does not set the usual')
eq(median([]), null, 'nothing to average is null, never 0')

// --- which lists count as history ------------------------------------------
const lists = [
  { id: 'L1', starts_on: '2026-05-01' },
  { id: 'L2', starts_on: '2026-06-01' },
  { id: 'L3', starts_on: '2026-07-01' },
  { id: 'CUR', starts_on: '2026-08-01' },
  { id: 'EMPTY', starts_on: '2026-07-15' },
]
const L = (list_id, item_key, name, qty, extra = {}) =>
  ({ list_id, item_key, name, qty, unit: 'unit', category: 'BAKERS', ...extra })

const lines = [
  // Softies: every trip. The habit.
  L('L1', 'softies', 'Softies', 20), L('L2', 'softies', 'Softies', 26), L('L3', 'softies', 'Softies', 30),
  // Milk: two of three.
  L('L2', 'milk', 'Milk', 4), L('L3', 'milk', 'Milk', 6),
  // Scampi: once, and MOST RECENTLY. Must not outrank softies.
  L('L3', 'scampi', 'Scampi', 1),
  // Shortbread: once, long ago.
  L('L1', 'shortbread', 'Shortbread', 1),
  // On the current list already.
  L('CUR', 'softies', 'Softies', 12), L('CUR', 'chillies', 'Chillies', 10),
]

const hist = historyLists(lists, lines, 'CUR')
eq(hist.map((l) => l.id), ['L3', 'L2', 'L1'], 'history is newest first, current excluded')
ok(!hist.some((l) => l.id === 'EMPTY'), 'a list with no lines is not history — it is an empty list')

// --- the ranking ----------------------------------------------------------
const h = orderHistory(lists, lines, { excludeListId: 'CUR', excludeKeys: ['softies', 'chillies'] })
eq(h.trips, 3, 'three lists behind it')
ok(!h.items.some((i) => i.key === 'softies'), 'what is already on the list is not suggested back')

const keys = h.items.map((i) => i.key)
eq(keys, ['milk', 'scampi', 'shortbread'],
   'REGULARITY BEFORE RECENCY: milk (2 trips) beats scampi, bought once and most recently')

const milk = h.items.find((i) => i.key === 'milk')
eq(milk.count, 2, 'milk on two lists')
eq(milk.typicalQty, 5, 'the usual quantity is the median of what was ordered')
eq(milk.lastOn, '2026-07-01', 'last ordered on the most recent list that carried it')

/* Without excludeKeys the habit tops the list — the check that the ordering
 * is not merely an artefact of what was filtered out. */
const all = orderHistory(lists, lines, { excludeListId: 'CUR' })
eq(all.items[0].key, 'softies', 'the thing bought every trip ranks first')
eq(all.items[0].count, 3, 'on all three')
eq(all.items[0].typicalQty, 26, 'the middle of 20, 26 and 30')

// --- the name comes from the MOST RECENT list -----------------------------
const renamed = [
  L('L1', 'x', 'Old Name', 1, { unit: 'unit', pack_size: null }),
  L('L3', 'x', 'New Name', 2, { unit: 'case', pack_size: 8 }),
]
const r = orderHistory(lists, renamed, { excludeListId: 'CUR' })
eq(r.items[0].name, 'New Name', 'a name corrected last trip is the one the boat means now')
eq(r.items[0].unit, 'case', 'and so is the unit')
eq(r.items[0].packSize, 8, 'and the pack size')

// --- ONE LIST IS NOT A HABIT ----------------------------------------------
/* The whole point of the wording. Jackson's boat has exactly one kept list
 * with lines on it today, so this is the live case, not a hypothetical. */
eq(heading(0), null, 'no history, no panel')
eq(heading(1), 'Ordered last trip', 'ONE list may not call itself regular')
eq(heading(2), 'Ordered recently', 'two is recent, still not regular')
eq(heading(3), 'Regularly ordered', 'three is enough to speak of a habit')

ok(basis(1).includes('not a pattern yet'), 'and it says so in as many words')
ok(basis(4).includes('last 4 lists'), 'otherwise it says what it rests on')

const one = orderHistory(
  [{ id: 'A', starts_on: '2026-08-20' }, { id: 'CUR', starts_on: '2026-08-25' }],
  [L('A', 'softies', 'Softies', 26)],
  { excludeListId: 'CUR' })
eq(one.trips, 1, 'one list of history')
eq(one.heading, 'Ordered last trip', 'and it is headed honestly')
eq(one.items[0].typicalQty, 26, 'the quantity is still the real one')
eq(itemNote(one.items[0]), 'last trip', 'per item too — never "1 of the last 1"')

// --- per-item wording -----------------------------------------------------
eq(itemNote({ trips: 3, count: 3 }), 'every one of the last 3', 'bought every time')
eq(itemNote({ trips: 3, count: 1 }), 'once', 'bought once')
eq(itemNote({ trips: 4, count: 2 }), '2 of the last 4', 'and the plain case')
eq(itemNote(null), '', 'nothing to say about nothing')

// --- empties --------------------------------------------------------------
const none = orderHistory([], [], {})
eq(none.trips, 0, 'no lists')
eq(none.items, [], 'no items')
eq(none.heading, null, 'and no heading to put over them')

/* A fleet whose only other list is EMPTY has no history — and that must read
 * as "nothing ordered yet", not as a habit of ordering nothing. */
const onlyEmpty = orderHistory(
  [{ id: 'EMPTY', starts_on: '2026-08-25' }, { id: 'CUR', starts_on: '2026-08-26' }],
  [], { excludeListId: 'CUR' })
eq(onlyEmpty.trips, 0, 'an empty list is not history')
eq(onlyEmpty.heading, null, 'so nothing is offered')

// --- limit ----------------------------------------------------------------
const many = Array.from({ length: 60 }, (_, i) => L('L1', 'k' + i, 'Item ' + i, 1))
const cut = orderHistory(lists, many, { excludeListId: 'CUR', limit: 12 })
eq(cut.items.length, 12, 'limit respected')
/* AND IT SAYS SO. Audacious's last real list carried 64 items; showing 40 of
 * them under "what you usually order", with nothing to say a third is missing,
 * is the kind of gap nobody notices until the shop delivers. */
eq(cut.total, 60, 'the full count is reported even when the shown list is cut')
eq(orderHistory([], [], {}).total, 0, 'and it is 0, not undefined, when there is nothing')

console.log('stores history: ' + n + ' checks passed')
