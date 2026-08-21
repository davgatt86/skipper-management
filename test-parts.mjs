/* The parts inventory.
 *
 * THE FIRST RUNNING BALANCE IN THIS APP, which is why it gets its own file.
 * Every other figure here is a snapshot and a wrong one is wrong on its own; a
 * wrong movement moves every later balance too. So the tests are less about
 * arithmetic than about the three things that must never be confused:
 *
 *   a balance resting on a real stock take
 *   a balance that is only net movements from an assumed zero
 *   nothing recorded at all
 */
import { balanceOf, ledgerOf, stockOf, effectOf, partsUsedOn } from './src/lib/maintenance/parts.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const M = (kind, qty, moved_on, extra = {}) =>
  ({ id: `${kind}-${moved_on}-${qty}`, part_id: 'p1', kind, qty, moved_on, created_at: `${moved_on}T09:00:00Z`, ...extra })

// ---- one movement at a time ------------------------------------------------
eq('received adds', effectOf(M('received', 6, '2026-01-01')), 6)
eq('used takes away', effectOf(M('used', 4, '2026-01-01')), -4)
// Only `adjusted` carries its own sign, because it is the only kind where the
// direction is not in the word.
eq('an adjustment can be negative', effectOf(M('adjusted', -2, '2026-01-01')), -2)
eq('and positive', effectOf(M('adjusted', 3, '2026-01-01')), 3)
eq('a count is absolute, not an effect', effectOf(M('count', 12, '2026-01-01')), 0)
// A sign typed into the wrong kind must not flip it.
eq('a negative "used" still takes away', effectOf(M('used', -4, '2026-01-01')), -4)
eq('a negative "received" still adds', effectOf(M('received', -6, '2026-01-01')), 6)
eq('a nonsense quantity does nothing', effectOf(M('used', 'four', '2026-01-01')), 0)
eq('and an unknown kind does nothing', effectOf({ kind: 'borrowed', qty: 3 }), 0)

// ---- the balance -----------------------------------------------------------
{
  /* THE WHOLE DESIGN IN ONE CASE: counted 12, then 6 came aboard and 4 went
   * into a job, so there are 14 — and it is derived, not typed. */
  const b = balanceOf([
    M('received', 99, '2025-06-01'),          // before the count: irrelevant
    M('count', 12, '2026-08-03'),
    M('received', 6, '2026-08-10'),
    M('used', 4, '2026-08-14', { event_id: 'e1' }),
  ])
  eq('counted 12, +6, -4', b.balance, 14)
  eq('it rests on a real count', b.counted, true)
  eq('and says when', b.countedAt, '2026-08-03')
  eq('everything before the count is forgotten', b.received, 6)
  eq('the workings are returned, not just the answer',
    [b.countedQty, b.received, b.used, b.adjusted], [12, 6, -4, 0])
  eq('and how many movements since', b.movesSince, 2)
}

/* THE DISTINCTION THE PAGE RESTS ON. A part nobody has counted has a balance of
 * net movements from an assumed zero, which is very likely wrong, and it must
 * not render like a figure resting on a stock take. */
{
  const never = balanceOf([M('received', 10, '2026-01-01'), M('used', 3, '2026-02-01')])
  eq('never counted still gives a figure', never.balance, 7)
  eq('but says it rests on nothing', never.counted, false)
  eq('with no date behind it', never.countedAt, null)

  const nothing = balanceOf([])
  eq('nothing recorded is empty', nothing.empty, true)
  eq('and not a balance of zero dressed up', nothing.counted, false)
  eq('though the number is nought', nothing.balance, 0)
  eq('null is handled', balanceOf(null).empty, true)

  // Counted, and none left — a real fact, and not the same as never counted.
  const none = balanceOf([M('count', 0, '2026-08-03')])
  eq('counted none is counted', none.counted, true)
  eq('and empty is false — something was recorded', none.empty, false)
  eq('with a balance of nought', none.balance, 0)
}

/* A LATER COUNT WIPES THE SLATE. That is what counting the shelf means, and it
 * is how a running balance gets corrected without editing history. */
{
  const b = balanceOf([
    M('count', 12, '2026-08-03'),
    M('used', 4, '2026-08-10'),
    M('count', 5, '2026-08-14'),        // somebody counted: there are 5
    M('used', 1, '2026-08-15'),
  ])
  eq('the latest count is the base', b.countedQty, 5)
  eq('and only what came after it counts', b.balance, 4)
  eq('from the later date', b.countedAt, '2026-08-14')
}

/* SAME-DAY ORDER. A stock take entered after a use on the same day supersedes
 * it — sorting by date alone would leave that to chance. */
{
  const b = balanceOf([
    { ...M('used', 4, '2026-08-14'), created_at: '2026-08-14T09:00:00Z' },
    { ...M('count', 5, '2026-08-14'), created_at: '2026-08-14T17:00:00Z' },
  ])
  eq('a count entered later that day wins', b.balance, 5)

  const other = balanceOf([
    { ...M('count', 5, '2026-08-14'), created_at: '2026-08-14T09:00:00Z' },
    { ...M('used', 4, '2026-08-14'), created_at: '2026-08-14T17:00:00Z' },
  ])
  eq('and a use entered after the count still comes off', other.balance, 1)
}

// As at a date, for asking what was aboard when a job was done.
{
  const ms = [M('count', 12, '2026-08-03'), M('used', 4, '2026-08-14')]
  eq('as at before the use', balanceOf(ms, { asOf: '2026-08-10' }).balance, 12)
  eq('as at after it', balanceOf(ms, { asOf: '2026-08-20' }).balance, 8)
  eq('as at before anything', balanceOf(ms, { asOf: '2026-01-01' }).empty, true)
}

// ---- the ledger a person reads --------------------------------------------
/* Newest first, with the balance AFTER each row — which is the only way to show
 * what each movement left behind, and the point of showing the workings at all
 * on a figure that propagates forward. */
{
  const rows = ledgerOf([
    M('count', 12, '2026-08-03'),
    M('received', 6, '2026-08-10'),
    M('used', 4, '2026-08-14'),
  ])
  eq('newest first', rows.map((r) => r.kind), ['used', 'received', 'count'])
  eq('the running balance after each', rows.map((r) => r.after), [14, 18, 12])
  eq('a count shows no effect, because it is not one', rows[2].effect, null)
  eq('a use shows its effect', rows[0].effect, -4)
  eq('nothing at all is handled', ledgerOf(null).length, 0)
}

// ---- the list ---------------------------------------------------------------
{
  const parts = [
    { id: 'p1', name: 'Impeller', min_stock: 2 },
    { id: 'p2', name: 'Fuel filter', min_stock: 4 },
    { id: 'p3', name: 'Gasket', min_stock: null },
    { id: 'p4', name: 'Never touched', min_stock: 1 },
  ]
  const moves = [
    { part_id: 'p1', kind: 'count', qty: 6, moved_on: '2026-08-01' },
    { part_id: 'p1', kind: 'used', qty: 5, moved_on: '2026-08-10' },   // 1 left, min 2
    { part_id: 'p2', kind: 'received', qty: 2, moved_on: '2026-08-01' }, // never counted
    { part_id: 'p3', kind: 'count', qty: 9, moved_on: '2026-08-01' },
  ]
  const stock = stockOf(parts, moves)
  const byName = (n) => stock.find((s) => s.part.name === n)

  eq('a part per row', stock.length, 4)
  eq('the impeller is down to one', byName('Impeller').balance, 1)
  eq('and is low against its minimum', byName('Impeller').low, true)

  /* LOW ONLY WHERE THE FIGURE RESTS ON A REAL COUNT. Calling a part low on a
   * balance nobody has verified is how a reorder list stops being believed. */
  eq('the filter looks short but has never been counted', byName('Fuel filter').balance, 2)
  eq('so it is NOT called low', byName('Fuel filter').low, false)
  eq('it is called unverified instead', byName('Fuel filter').unverified, true)

  eq('a part with no minimum is never low', byName('Gasket').low, false)
  eq('and a counted one is not unverified', byName('Gasket').unverified, false)

  eq('a part with no movements at all is empty', byName('Never touched').empty, true)
  eq('and not flagged low off nothing', byName('Never touched').low, false)
  eq('nor unverified, since nothing was claimed', byName('Never touched').unverified, false)

  eq('no parts at all', stockOf([], moves).length, 0)
  eq('and null', stockOf(null, null).length, 0)
}

// ---- what a job consumed ----------------------------------------------------
{
  const moves = [
    { id: 'a', part_id: 'p1', kind: 'used', qty: 2, event_id: 'e1' },
    { id: 'b', part_id: 'p2', kind: 'used', qty: 1, event_id: 'e1' },
    { id: 'c', part_id: 'p1', kind: 'used', qty: 4, event_id: 'e2' },
    { id: 'd', part_id: 'p1', kind: 'received', qty: 9, event_id: 'e1' },
  ]
  eq('the job names what it used', partsUsedOn(moves, 'e1').map((m) => m.id), ['a', 'b'])
  // A delivery is not consumption, even if it somehow carries an event.
  eq('and not what arrived', partsUsedOn(moves, 'e1').every((m) => m.kind === 'used'), true)
  eq('a job that used nothing', partsUsedOn(moves, 'e9').length, 0)
  eq('nothing at all', partsUsedOn(null, 'e1').length, 0)
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
