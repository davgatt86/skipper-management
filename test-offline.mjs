// The pure part of the outbox: how unsent writes are laid over server rows.
// IndexedDB is not available in node, but applyPending() is where the ordering
// and merge bugs would live, and it needs no storage.
import { applyPending, newId } from './src/lib/offline/queue.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}
const P = (o) => ({ status: 'pending', ...o })

const server = [
  { id: 'a', entry_date: '2026-08-01', litres: 100 },
  { id: 'b', entry_date: '2026-07-01', litres: 200 },
]

eq('no pending writes changes nothing',
  applyPending(server, []).map((r) => r.id), ['a', 'b'])

eq('an insert appears at the top, marked pending',
  applyPending(server, [P({ op: 'insert', id: 'n1', payload: { litres: 50 } })])
    .map((r) => [r.id, !!r._pending]),
  [['n1', true], ['a', false], ['b', false]])

eq('an update merges onto the server row and marks it',
  applyPending(server, [P({ op: 'update', id: 'b', payload: { litres: 999 } })])
    .map((r) => [r.id, r.litres, !!r._pending]),
  [['a', 100, false], ['b', 999, true]])

eq('a delete removes the row',
  applyPending(server, [P({ op: 'delete', id: 'a', payload: null })]).map((r) => r.id), ['b'])

// The case that matters at sea: create a row offline, then edit it, then delete
// it — all before anything syncs. Each op must find the one before it.
eq('insert then update, offline',
  applyPending(server, [
    P({ op: 'insert', id: 'n1', payload: { litres: 50 } }),
    P({ op: 'update', id: 'n1', payload: { litres: 75 } }),
  ]).find((r) => r.id === 'n1').litres, 75)

eq('insert then delete leaves no trace',
  applyPending(server, [
    P({ op: 'insert', id: 'n1', payload: { litres: 50 } }),
    P({ op: 'delete', id: 'n1', payload: null }),
  ]).map((r) => r.id), ['a', 'b'])

eq('two updates to the same row, last wins',
  applyPending(server, [
    P({ op: 'update', id: 'a', payload: { litres: 1 } }),
    P({ op: 'update', id: 'a', payload: { litres: 2 } }),
  ]).find((r) => r.id === 'a').litres, 2)

// A refused write must NOT be shown as if it were going to arrive — the strip
// reports it separately so it can be fixed or discarded deliberately.
eq('a failed item is not applied',
  applyPending(server, [{ status: 'failed', op: 'insert', id: 'n1', payload: { litres: 50 } }])
    .map((r) => r.id), ['a', 'b'])

eq('the server rows are not mutated', server.map((r) => r.litres), [100, 200])

// Re-applying the same insert (a reload arriving mid-flush) must not double it.
eq('an insert already present on the server is not duplicated',
  applyPending([{ id: 'n1', litres: 50 }, ...server],
    [P({ op: 'insert', id: 'n1', payload: { litres: 50 } })]).map((r) => r.id),
  ['n1', 'a', 'b'])

const ids = new Set(Array.from({ length: 500 }, () => newId()))
eq('newId is unique over 500 draws', ids.size, 500)
eq('newId looks like a uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(newId()), true)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
