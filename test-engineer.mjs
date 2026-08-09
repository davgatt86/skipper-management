import { taskStatus, maintenanceBoard, daysBetween, STATUS } from './src/lib/maintenance.js'
import { splitCharts, seriesMagnitudes } from './src/lib/engineCharts.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}
const TODAY = '2026-08-09'

// ---------------------------------------------------------------- days since
eq('daysBetween', daysBetween('2026-08-01', TODAY), 8)
eq('daysBetween handles nulls', daysBetween(null, TODAY), null)

// ---------------------------------------------------------------- one clock
const byDays = { id: 't1', name: 'Anodes', interval_days: 180 }
eq('within interval → in date',
  taskStatus(byDays, { done_on: '2026-07-01', running_hours: null }, null, TODAY).status.key, 'ok')
eq('past interval → overdue',
  taskStatus(byDays, { done_on: '2025-12-01', running_hours: null }, null, TODAY).status.key, 'overdue')
eq('near the end → due soon',
  taskStatus(byDays, { done_on: '2026-02-20', running_hours: null }, null, TODAY).status.key, 'due')
eq('never done → never recorded',
  taskStatus(byDays, null, null, TODAY).status.key, 'never')

// ---------------------------------------------------------------- hours clock
const byHours = { id: 't2', name: 'Fuel filters', interval_hours: 250 }
eq('hours since is now minus then',
  taskStatus(byHours, { done_on: '2026-06-01', running_hours: 30000 }, 30100, TODAY).hours, 100)
eq('hours within interval → in date',
  taskStatus(byHours, { done_on: '2026-06-01', running_hours: 30000 }, 30100, TODAY).status.key, 'ok')
eq('hours past interval → overdue',
  taskStatus(byHours, { done_on: '2026-06-01', running_hours: 30000 }, 30300, TODAY).status.key, 'overdue')

// Unknown hours must NOT read as zero — an engineer could act on that.
eq('no current hours → hours not reported',
  taskStatus(byHours, { done_on: '2026-06-01', running_hours: 30000 }, null, TODAY).hours, null)
eq('no current hours → not claimed to be in date',
  taskStatus(byHours, { done_on: '2026-06-01', running_hours: 30000 }, null, TODAY).status.key, 'tracked')

// ---------------------------------------------------------------- both clocks
const both = { id: 't3', name: 'Oil change', interval_days: 365, interval_hours: 500 }
eq('whichever comes first: hours blown, days fine → overdue',
  taskStatus(both, { done_on: '2026-07-01', running_hours: 30000 }, 30600, TODAY).status.key, 'overdue')
eq('whichever comes first: days blown, hours fine → overdue',
  taskStatus(both, { done_on: '2024-01-01', running_hours: 30000 }, 30100, TODAY).status.key, 'overdue')
eq('both fine → in date',
  taskStatus(both, { done_on: '2026-07-01', running_hours: 30000 }, 30100, TODAY).status.key, 'ok')

// No interval at all is tracked, never chased.
eq('no interval → tracked',
  taskStatus({ id: 't4', name: 'Impeller' }, { done_on: '2020-01-01' }, null, TODAY).status.key, 'tracked')

// ---------------------------------------------------------------- the board
const tasks = [
  { id: 'a', name: 'A', interval_days: 30, active: true },
  { id: 'b', name: 'B', interval_days: 3650, active: true },
  { id: 'c', name: 'C', active: true },
  { id: 'd', name: 'D', active: false },          // retired, must not appear
]
const events = [
  { task_id: 'a', done_on: '2026-01-01' },        // long overdue
  { task_id: 'b', done_on: '2026-08-01' },        // fine
  { task_id: 'c', done_on: '2026-05-01' },        // tracked only
]
const board = maintenanceBoard(tasks, events, null, TODAY)
eq('retired tasks are dropped', board.length, 3)
// overdue, then in-date, then interval-less "tracked" items — nothing below
// the first entry needs acting on, so their order only has to be stable.
eq('worst first', board.map((b) => b.task.id), ['a', 'b', 'c'])
eq('latest event wins',
  maintenanceBoard([tasks[0]],
    [{ task_id: 'a', done_on: '2026-01-01' }, { task_id: 'a', done_on: '2026-08-05' }],
    null, TODAY)[0].days, 4)

// ---------------------------------------------------------------- chart split
const P = (key, unit) => ({ key, label: key, unit })
const rows = [
  { rpm: 750, exh: 400, press: 2.1, hours: 30000, intake: 22 },
  { rpm: 760, exh: 410, press: 2.3, hours: 30010, intake: 24 },
  { rpm: 740, exh: 395, press: 2.0, hours: 30020, intake: 21 },
]
const params = [P('rpm', 'rpm'), P('exh', '°C'), P('press', 'bar'), P('hours', 'h'), P('intake', '°C')]
const { charts, empty } = splitCharts(params, rows)

eq('different units never share a chart',
  charts.every((c) => new Set(params.filter((p) => c.keys.includes(p.key)).map((p) => p.unit)).size === 1), true)
const degC = charts.filter((c) => c.unit === '°C')
eq('22°C intake and 400°C exhaust are pulled apart', degC.length, 2)
eq('every series is charted exactly once',
  charts.flatMap((c) => c.keys).sort(), ['exh', 'hours', 'intake', 'press', 'rpm'])
eq('nothing reported empty', empty, [])

// Close temperatures stay together even across a power of ten.
const closeRows = [{ a: 95, b: 105 }, { a: 98, b: 110 }]
eq('95 and 105 stay on one chart',
  splitCharts([P('a', '°C'), P('b', '°C')], closeRows).charts.length, 1)

// A series with no readings cannot be charted, and is reported.
eq('empty series reported',
  splitCharts([P('rpm', 'rpm'), P('never', 'rpm')], rows).empty, ['never'])

// A wild mis-key must not drag its series onto its own chart — median, not mean.
const spiky = [{ p: 2.1 }, { p: 2.2 }, { p: 175 }, { p: 2.0 }, { p: 2.3 }]
eq('one mis-keyed 175 bar does not split the series',
  splitCharts([P('p', 'bar'), P('q', 'bar')],
    spiky.map((r, i) => ({ ...r, q: 2.5 + i * 0.1 }))).charts.length, 1)

eq('magnitude uses median not mean',
  Math.round(seriesMagnitudes(['p'], spiky).p.median * 10) / 10, 2.2)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
