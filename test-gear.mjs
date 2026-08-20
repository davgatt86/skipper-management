/* The gear log.
 *
 * The unit is the NET, not the boat: a pair team carries four, two on each
 * boat, and nothing is shared. A COMPONENT is a thing with a life — fitted and
 * removed — rather than two events in a stream that some later query has to
 * pair up, which is what makes the life figures read straight off.
 *
 * The thing most worth pinning down is the BASIS of every "days since". "69
 * days since measured" and "69 days since she came aboard" are different facts,
 * and a bare number would let a net nobody has ever looked at pass for one
 * checked ten weeks ago.
 */
import {
  DEFAULT_PARTS, resolveParts, LENGTH_UNITS, toMm, fmtLength, ftInToValue, valueToFtIn, unitMm,
} from './src/lib/gear/parts.js'
import {
  daysBetween, fittedComponent, historyFor, measurementsFor, lifeDays,
  cellFor, buildMatrix, closedLives,
} from './src/lib/gear/gearAgg.js'
import {
  tripsBetween, livesOf, summarise, running, partLives, netLives, confidence,
} from './src/lib/gear/gearStats.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// ---- the parts vocabulary --------------------------------------------------
eq('the five David named ship', DEFAULT_PARTS.map((p) => p.key),
  ['ground_gear', 'headline', 'bridles', 'legs', 'codend'])
eq('nothing stored is just the shipped list', resolveParts([]).length, DEFAULT_PARTS.length)
eq('and null is handled', resolveParts(null).length, DEFAULT_PARTS.length)
{
  /* NOT A CLOSED LIST — a pair trawl and a single rig differ, and shipping a
   * fixed one is the mistake the market clocks made. */
  const merged = resolveParts([
    { part_key: 'headline', label: 'Head rope' },
    { part_key: 'discs', label: 'Discs', sort: 9 },
    { part_key: 'legs', hidden: true },
  ])
  eq('a rename lands', merged.find((p) => p.key === 'headline')?.label, 'Head rope')
  eq('an invented part joins', merged.find((p) => p.key === 'discs')?.label, 'Discs')
  eq('and is marked as the fleet’s own', merged.find((p) => p.key === 'discs')?.custom, true)
  eq('a retired part drops out', merged.some((p) => p.key === 'legs'), false)
  /* The point of code-plus-overrides: a fleet that renamed ONE part still gets
   * later corrections to the rest. */
  eq('an untouched part is still the shipped one',
    merged.find((p) => p.key === 'codend')?.label, 'Codend')
  eq('the shipped order is kept', merged.map((p) => p.key),
    ['ground_gear', 'headline', 'bridles', 'codend', 'discs'])
}

// ---- lengths ---------------------------------------------------------------
/* Fathoms, feet and inches, metres — gear is measured in all three depending on
 * the part and the man. Every reading is stored twice: as written, so it reads
 * back the way he wrote it, AND in millimetres, so a series survives the unit
 * changing partway through it. */
eq('three units', LENGTH_UNITS.map((u) => u.key), ['fathom', 'ft_in', 'm'])
eq('a fathom in mm', unitMm('fathom'), 1828.8)
eq('a foot in mm', unitMm('ft_in'), 304.8)
eq('a metre in mm', unitMm('m'), 1000)
eq('an unknown unit has no mm', unitMm('cubit'), null)

eq('60 fathoms canonicalised', toMm(60, 'fathom'), 109728)
eq('and 109.728 m is the same length', toMm(109.728, 'm'), 109728)
eq('so a series survives a unit change', toMm(60, 'fathom') === toMm(109.728, 'm'), true)
eq('a blank value has no mm', toMm('', 'm'), null)
eq('and neither does a blank unit', toMm(5, ''), null)

// Feet and inches is entered as two boxes and held as decimal feet, so the
// arithmetic is ordinary and only the display is compound.
eq('5 ft 6 in is 5.5 ft', ftInToValue(5, 6), 5.5)
eq('feet alone', ftInToValue(7, ''), 7)
eq('inches alone', ftInToValue('', 6), 0.5)
eq('nothing at all is blank, not zero', ftInToValue('', ''), null)
eq('and back again', valueToFtIn(5.5), { ft: 5, inch: 6 })
// 5.9999 ft is 6' 0", never 5' 12".
eq('inches carry rather than reading 12', valueToFtIn(5.9999), { ft: 6, inch: 0 })
eq('a whole number of feet', valueToFtIn(7), { ft: 7, inch: 0 })

eq('a fathom reading', fmtLength(60, 'fathom'), '60 fm')
eq('a metric reading', fmtLength(109.728, 'm'), '109.73 m')
eq('feet and inches', fmtLength(5.5, 'ft_in'), '5′ 6″')
eq('whole feet drop the inches', fmtLength(7, 'ft_in'), '7′')
/* BLANK STAYS BLANK the whole way through. An unknown length rendering as 0
 * reads as "measured, and it is gone" — the same trap as Number(null) being 0
 * in the maintenance running-hours figure. */
eq('null renders blank', fmtLength(null, 'm'), '')
eq('undefined renders blank', fmtLength(undefined, 'm'), '')
eq('empty renders blank', fmtLength('', 'm'), '')
eq('but a real zero is a real zero', fmtLength(0, 'm'), '0 m')

// ---- days ------------------------------------------------------------------
eq('days between two dates', daysBetween('2026-01-01', '2026-03-02'), 60)
eq('same day is nought', daysBetween('2026-08-20', '2026-08-20'), 0)
eq('no start is unknown, not zero', daysBetween(null, '2026-08-20'), null)
eq('a timestamp is trimmed to its day', daysBetween('2026-01-01T22:00:00Z', '2026-01-02'), 1)

// ---- the components --------------------------------------------------------
/* A renewal is closing one component and opening the next, so the fitted one is
 * simply the one nobody has taken off. */
const NET = { id: 'n1', vessel_id: 'v1', name: 'Port net', came_aboard: '2026-01-01' }
const NET2 = { id: 'n2', vessel_id: 'v1', name: 'Pair hopper', came_aboard: '2026-04-01' }
const NET_B = { id: 'n3', vessel_id: 'v2', name: 'Port net', came_aboard: '2026-02-01' }
const COMPS = [
  { id: 'c1', net_id: 'n1', part_key: 'headline', fitted_on: '2026-01-01', removed_on: '2026-04-11' },
  { id: 'c2', net_id: 'n1', part_key: 'headline', fitted_on: '2026-04-11', removed_on: null },
  { id: 'c3', net_id: 'n1', part_key: 'codend', fitted_on: '2026-03-01', removed_on: null },
  { id: 'c4', net_id: 'n2', part_key: 'headline', fitted_on: '2026-04-01', removed_on: null },
  { id: 'c5', net_id: 'n3', part_key: 'headline', fitted_on: '2026-02-01', removed_on: null },
]
const MEAS = [
  { id: 'm1', component_id: 'c2', kind: 'measured', done_on: '2026-06-12', value: 60, unit: 'fathom' },
  { id: 'm2', component_id: 'c2', kind: 'inspected', done_on: '2026-07-20', value: null, unit: null },
  { id: 'm3', component_id: 'c1', kind: 'measured', done_on: '2026-02-02', value: 62, unit: 'fathom' },
]

eq('the fitted set is the one not taken off',
  fittedComponent(COMPS, 'n1', 'headline')?.id, 'c2')
eq('nothing fitted reads as none', fittedComponent(COMPS, 'n2', 'codend'), null)
eq('history is newest first', historyFor(COMPS, 'n1', 'headline').map((c) => c.id), ['c2', 'c1'])
eq('and does not stray to another net', historyFor(COMPS, 'n1', 'headline').length, 2)
eq('measurements are newest first', measurementsFor(MEAS, 'c2').map((m) => m.id), ['m2', 'm1'])
eq('a life of a closed set', lifeDays({ fitted_on: '2026-01-01', removed_on: '2026-04-11' }), 100)
eq('and of one still on', lifeDays({ fitted_on: '2026-01-01', removed_on: null }, '2026-08-20'), 231)

// ---- the cell, and its BASIS ----------------------------------------------
/* This is the part most worth getting right. The number alone is not enough —
 * where it is counted FROM is the difference between a net that was checked ten
 * weeks ago and one nobody has ever looked at. */
{
  const c = cellFor(NET, 'headline', COMPS, MEAS, '2026-08-20')
  eq('a measured part counts from the measurement', c.basis, 'measured')
  eq('and shows those days', c.days, daysBetween('2026-06-12', '2026-08-20'))
  eq('the LAST measured one, not the last event', c.lastMeasured.id, 'm1')
  eq('though the last event is still known', c.lastAny.id, 'm2')
  // How long the set has been on is a different question from how long since
  // anyone measured it, and the page shows both.
  eq('and the fitted age is its own figure', c.fittedDays, daysBetween('2026-04-11', '2026-08-20'))

  // Fitted but never measured: count from when it went on.
  const c2 = cellFor(NET, 'codend', COMPS, MEAS, '2026-08-20')
  eq('an unmeasured part counts from fitting', c2.basis, 'fitted')
  eq('from the day it went on', c2.days, daysBetween('2026-03-01', '2026-08-20'))

  /* NOTHING FITTED AT ALL — David's own case: "if it's not been logged, then it
   * would show since net came aboard." */
  const c3 = cellFor(NET, 'bridles', COMPS, MEAS, '2026-08-20')
  eq('nothing fitted falls back to the net', c3.basis, 'aboard')
  eq('counting from when she came aboard', c3.days, daysBetween('2026-01-01', '2026-08-20'))
  eq('and there is no component to show', c3.component, null)

  // Nothing known at all must say so rather than showing a number.
  const c4 = cellFor({ id: 'nx', name: 'New net' }, 'bridles', [], [], '2026-08-20')
  eq('nothing known at all', c4.basis, 'none')
  eq('and no days', c4.days, null)
}

// ---- the matrix ------------------------------------------------------------
/* Nets down, parts across. A pair team carries four — two on each boat — and
 * they are never shared, so the grid groups by vessel. */
{
  const parts = resolveParts([])
  const vessels = [{ id: 'v1', label: 'AUDACIOUS BF83' }, { id: 'v2', label: 'BERYL BF440' }]
  const m = buildMatrix({
    nets: [NET, NET2, NET_B], parts, components: COMPS, measurements: MEAS,
    vessels, today: '2026-08-20',
  })
  eq('grouped by boat', m.map((g) => g.vessel.label), ['AUDACIOUS BF83', 'BERYL BF440'])
  eq('two nets on the first', m[0].rows.length, 2)
  eq('one on the second', m[1].rows.length, 1)
  eq('every net gets a cell per part', m[0].rows[0].cells.length, parts.length)
  eq('and they are in the parts order', m[0].rows[0].cells.map((c) => c.partKey),
    parts.map((p) => p.key))

  // A retired net is out of the way by default but never deleted — the history
  // is the point of the log.
  const retired = [...[NET, NET2, NET_B], { id: 'n9', vessel_id: 'v1', name: 'Old net', retired_on: '2026-05-01' }]
  eq('a retired net is hidden by default',
    buildMatrix({ nets: retired, parts, components: COMPS, measurements: MEAS, vessels, today: '2026-08-20' })[0].rows.length, 2)
  eq('and shown when asked for',
    buildMatrix({ nets: retired, parts, components: COMPS, measurements: MEAS, vessels, today: '2026-08-20', includeRetired: true })[0].rows.length, 3)

  // A vessel nobody can name still shows its nets rather than dropping them.
  const orphan = buildMatrix({ nets: [NET], parts, components: COMPS, measurements: MEAS, vessels: [], today: '2026-08-20' })
  eq('a net whose boat is unknown is still listed', orphan[0].rows.length, 1)
  eq('and says so', orphan[0].vessel.label, 'Unknown vessel')
}

// ---- lives, for the stats --------------------------------------------------
/* A set still on the net is NOT a life. It has not finished, and averaging it
 * in would drag every figure down towards however recently the last renewal
 * happened — the same discipline as reporting the count of intervals rather
 * than a headline number off one. */
{
  const lives = closedLives(COMPS)
  eq('only closed sets count', lives.map((c) => c.id), ['c1'])
  eq('and carry their length', lives[0].days, 100)
  eq('filtered by part', closedLives(COMPS, 'codend').length, 0)
  eq('a set with no fitted date cannot have a life',
    closedLives([{ id: 'x', part_key: 'headline', fitted_on: null, removed_on: '2026-01-01' }]).length, 0)
  eq('nothing at all is handled', closedLives(null).length, 0)
}

// ---- STAGE 2: how long the gear lasts -------------------------------------

/* Trips in a window, both ends INCLUSIVE. A set fitted the day the boat landed
 * was fitted after that trip; a set taken off the day she landed came off after
 * that one too. The gear did the trip either way, and getting this wrong is an
 * off-by-one no amount of looking at the page would reveal. */
{
  const dates = ['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16', '2026-03-02']
  eq('trips inside a window', tripsBetween(dates, '2026-01-10', '2026-02-20'), 3)
  eq('the start date counts', tripsBetween(dates, '2026-01-05', '2026-01-06'), 1)
  eq('and so does the end date', tripsBetween(dates, '2026-01-04', '2026-01-05'), 1)
  eq('a window with nothing in it', tripsBetween(dates, '2026-01-06', '2026-01-18'), 0)
  eq('the whole run', tripsBetween(dates, '2026-01-01', '2026-12-31'), 5)
  eq('no start is unknown, not zero', tripsBetween(dates, null, '2026-12-31'), null)
  // A backwards window is nought, never a negative or a crash.
  eq('a backwards window', tripsBetween(dates, '2026-06-01', '2026-01-01'), 0)
  eq('no dates at all', tripsBetween([], '2026-01-01', '2026-12-31'), 0)
  eq('and no list at all', tripsBetween(null, '2026-01-01', '2026-12-31'), 0)
  // Timestamps get trimmed to their day rather than compared as strings.
  eq('a timestamp still counts',
    tripsBetween(['2026-01-05T18:30:00Z'], '2026-01-05', '2026-01-05'), 1)
}

// ---- lives -----------------------------------------------------------------
const TRIPS = {
  v1: ['2026-01-15', '2026-02-01', '2026-02-20', '2026-03-10', '2026-03-28',
       '2026-04-15', '2026-05-02', '2026-05-20', '2026-06-08', '2026-06-25',
       '2026-07-12', '2026-08-01'],
  v2: ['2026-02-10', '2026-03-15', '2026-04-20'],
}
const NETVESSEL = { n1: 'v1', n2: 'v1', n3: 'v2' }
const LIFE_COMPS = [
  // Two finished bridle lives on n1, and one still running.
  { id: 'b1', net_id: 'n1', part_key: 'bridles', fitted_on: '2026-01-01', removed_on: '2026-03-02', cost: 900 },
  { id: 'b2', net_id: 'n1', part_key: 'bridles', fitted_on: '2026-03-02', removed_on: '2026-05-01', cost: null },
  { id: 'b3', net_id: 'n1', part_key: 'bridles', fitted_on: '2026-05-01', removed_on: null },
  // One finished on another net.
  { id: 'b4', net_id: 'n3', part_key: 'bridles', fitted_on: '2026-02-01', removed_on: '2026-04-02', cost: 1100 },
  // A codend nobody has renewed yet — still on, so NOT a life.
  { id: 'k1', net_id: 'n1', part_key: 'codend', fitted_on: '2026-02-01', removed_on: null },
  // A set with no fitted date has no measurable life.
  { id: 'x1', net_id: 'n1', part_key: 'legs', fitted_on: null, removed_on: '2026-04-01' },
]

{
  const lives = livesOf(LIFE_COMPS, { partKey: 'bridles', tripDates: TRIPS, netVessel: NETVESSEL })
  eq('only finished lives count', lives.map((l) => l.id), ['b2', 'b4', 'b1'])
  // Newest by when it CAME OFF: b2 on 05-01 beats b4 on 04-02.
eq('newest off first', lives[0].id, 'b2')
  eq('a life is its two dates', lives.find((l) => l.id === 'b1').days, 60)
  // n1 is on v1, so its trips come from v1's list — not the other boat's.
  eq('trips come from the net’s own boat',
    lives.find((l) => l.id === 'b1').trips, tripsBetween(TRIPS.v1, '2026-01-01', '2026-03-02'))
  eq('and a net on the other boat uses the other list',
    lives.find((l) => l.id === 'b4').trips, tripsBetween(TRIPS.v2, '2026-02-01', '2026-04-02'))
  eq('scoped to one net', livesOf(LIFE_COMPS, { netId: 'n1', partKey: 'bridles' }).length, 2)
  eq('a set with no fitted date is not a life',
    livesOf(LIFE_COMPS, { partKey: 'legs' }).length, 0)
  eq('nothing at all is handled', livesOf(null, {}).length, 0)
}

// ---- the summary -----------------------------------------------------------
{
  const lives = livesOf(LIFE_COMPS, { partKey: 'bridles', tripDates: TRIPS, netVessel: NETVESSEL })
  const st = summarise(lives)
  eq('three finished lives', st.n, 3)
  eq('averaged in days', st.avgDays, Math.round((60 + 60 + 60) / 3))
  eq('with the range', [st.minDays, st.maxDays], [60, 60])
  /* COST IS AVERAGED OVER THE ONES THAT HAVE IT, and the count is reported.
   * A mean over "the ones we know" presented as a mean over all of them is a
   * quiet lie, and David said the cost often is not known. */
  eq('cost averaged over what is known', st.avgCost, 1000)
  eq('and says how many that was', st.costKnown, 2)

  /* NOTHING TO AVERAGE IS NULL, NEVER ZERO. A zero average reads as "they last
   * no time at all", which is the opposite of "nobody has renewed one yet". */
  const none = summarise([])
  eq('no lives, no average', none.avgDays, null)
  eq('no trips average either', none.avgTrips, null)
  eq('no cost average', none.avgCost, null)
  eq('and the count is nought', none.n, 0)
}

// ---- what is running now ---------------------------------------------------
/* A set still on the net is reported separately and compared against the
 * average, never folded into it — averaging it in would drag every figure down
 * towards however recently the last renewal happened, so the better the log is
 * kept the worse the answer would get. */
{
  const r = running(LIFE_COMPS.find((c) => c.id === 'b3'),
    { avgDays: 60, tripDates: TRIPS.v1, today: '2026-08-20' })
  eq('the running set has an age', r.days, daysBetween('2026-05-01', '2026-08-20'))
  eq('and its trips', r.trips, tripsBetween(TRIPS.v1, '2026-05-01', '2026-08-20'))
  // 111 days against an average of 60 is 85% over.
  eq('and how far past the average it is', r.over, Math.round(((111 - 60) / 60) * 100) / 100)

  // With no average there is nothing to be past, and the page must not imply
  // there is.
  eq('no average, no comparison',
    running(LIFE_COMPS.find((c) => c.id === 'k1'), { avgDays: null, today: '2026-08-20' }).over, null)
  eq('an average of zero is not a divisor',
    running(LIFE_COMPS.find((c) => c.id === 'k1'), { avgDays: 0, today: '2026-08-20' }).over, null)
  eq('nothing fitted is null', running(null, {}), null)
  eq('and a set with no fitted date is too',
    running({ id: 'z', fitted_on: null }, { today: '2026-08-20' }), null)
}

// ---- the per-part table ----------------------------------------------------
{
  const parts = resolveParts([])
  const nets = [
    { id: 'n1', vessel_id: 'v1', name: 'Port net', came_aboard: '2026-01-01' },
    { id: 'n3', vessel_id: 'v2', name: 'Port net', came_aboard: '2026-02-01' },
  ]
  const rows = partLives({ parts, nets, components: LIFE_COMPS, tripDates: TRIPS, today: '2026-08-20' })
  eq('a row per part', rows.length, parts.length)
  const bridles = rows.find((r) => r.part.key === 'bridles')
  eq('bridles have three finished lives', bridles.n, 3)
  eq('and one still running', bridles.running.length, 1)
  eq('which knows its net', bridles.running[0].net.name, 'Port net')

  const codend = rows.find((r) => r.part.key === 'codend')
  eq('a part never renewed has no average', codend.avgDays, null)
  eq('but is still shown as running', codend.running.length, 1)
  eq('with no comparison to make', codend.running[0].over, null)

  const legs = rows.find((r) => r.part.key === 'legs')
  eq('a part with nothing fitted has nothing running', legs.running.length, 0)

  /* A component on a net that is not in scope must not appear. Otherwise a
   * retired net's rig quietly joins the live figures. */
  const scoped = partLives({
    parts, nets: [nets[0]], components: LIFE_COMPS, tripDates: TRIPS, today: '2026-08-20',
  })
  eq('a component off an out-of-scope net is not running',
    scoped.find((r) => r.part.key === 'bridles').running.length, 1)
}

// ---- the per-net table -----------------------------------------------------
{
  const nets = [
    { id: 'n1', vessel_id: 'v1', name: 'Port net', came_aboard: '2026-01-01' },
    { id: 'n3', vessel_id: 'v2', name: 'Starboard twin', came_aboard: '2026-02-01', retired_on: '2026-06-01' },
  ]
  const vessels = [{ id: 'v1', label: 'AUDACIOUS BF83' }, { id: 'v2', label: 'BERYL BF440' }]
  const rows = netLives({ nets, components: LIFE_COMPS, tripDates: TRIPS, today: '2026-08-20', vessels })
  const n1 = rows.find((r) => r.net.id === 'n1')
  eq('a net in use is aged to today', n1.ageDays, daysBetween('2026-01-01', '2026-08-20'))
  eq('and carries its boat', n1.vessel.label, 'AUDACIOUS BF83')
  eq('with its renewals counted', n1.renewals, 2)

  /* A RETIRED NET IS AGED TO ITS RETIREMENT, not to today. Otherwise every net
   * ever taken off keeps getting older, and the oldest net on the books is
   * always the one longest gone. */
  const n3 = rows.find((r) => r.net.id === 'n3')
  eq('a retired net stops ageing', n3.ageDays, daysBetween('2026-02-01', '2026-06-01'))
  eq('and is marked as retired', n3.retired, true)
  eq('its trips stop too', n3.ageTrips, tripsBetween(TRIPS.v2, '2026-02-01', '2026-06-01'))

  eq('a net with no date aboard has no age',
    netLives({ nets: [{ id: 'z', vessel_id: 'v1', name: 'X' }], components: [], today: '2026-08-20' })[0].ageDays,
    null)
}

// ---- saying how sure we are ------------------------------------------------
/* One renewal is an anecdote, not an average. Kept in one place so every panel
 * hedges the same way rather than each inventing its own. */
eq('nothing logged', confidence(0).level, 'none')
eq('one renewal is not an average', confidence(1).level, 'one')
eq('two is thin', confidence(2).level, 'thin')
eq('three will do', confidence(3).level, 'ok')
eq('and it says how many', confidence(5).text, '5 renewals')


console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
