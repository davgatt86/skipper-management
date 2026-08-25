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
  partHasHalves, halvesCheck, fmtMm, HALVES_TOLERANCE_MM,
} from './src/lib/gear/parts.js'
import {
  daysBetween, fittedComponent, historyFor, measurementsFor, lifeDays,
  cellFor, buildMatrix, closedLives,
} from './src/lib/gear/gearAgg.js'
import {
  tripsBetween, livesOf, summarise, running, partLives, netLives, confidence,
} from './src/lib/gear/gearStats.js'
import {
  iceLabel, groundKey, groundLabel, splitKey, groundMix, mixShares,
  groundWear, groundConfidence, normaliseArea,
} from './src/lib/gear/grounds.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// ---- the parts vocabulary --------------------------------------------------
eq('the shipped vocabulary, footrope included', DEFAULT_PARTS.map((p) => p.key),
  ['ground_gear', 'footrope', 'headline', 'bridles', 'legs', 'codend'])
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
    ['ground_gear', 'footrope', 'headline', 'bridles', 'codend', 'discs'])
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
/* A renewal written at sea is queued and the CLOSE happens server-side, so
 * between writing it and syncing there are briefly two open rows on the device.
 * The latest must win, or the man is told his renewal did not take. */
eq('the latest open set wins while a renewal is still pending',
  fittedComponent([
    { id: 'old', net_id: 'n1', part_key: 'legs', fitted_on: '2025-07-31', removed_on: null },
    { id: 'new', net_id: 'n1', part_key: 'legs', fitted_on: '2026-08-20', removed_on: null },
  ], 'n1', 'legs')?.id, 'new')
eq('and order in the array does not decide it',
  fittedComponent([
    { id: 'new', net_id: 'n1', part_key: 'legs', fitted_on: '2026-08-20', removed_on: null },
    { id: 'old', net_id: 'n1', part_key: 'legs', fitted_on: '2025-07-31', removed_on: null },
  ], 'n1', 'legs')?.id, 'new')
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


// ---- STAGE 3: which grounds eat gear ---------------------------------------

/* The logbook writes 27.4.a; the trade — and David — say IVa. */
eq('a division', iceLabel('27.4.a'), 'IVa')
eq('another', iceLabel('27.6.a'), 'VIa')
eq('and another', iceLabel('27.6.b'), 'VIb')
// A numeric sub-division runs on, as it is written.
eq('a numbered sub-division', iceLabel('27.6.b.2'), 'VIb2')
eq('and a two-deep one', iceLabel('27.2.a.2'), 'IIa2')
/* A LOCAL SUB-AREA TAG FOLDS BACK INTO ITS DIVISION. The logbook carried
 * 27.6.a.s for 24 days; David, Aug 2026: it is VIa, the .s being a local
 * south tag on the West of Scotland ground rather than a division of its own.
 * The rule follows the ICES hierarchy rather than special-casing that code:
 * a real subdivision is NUMERIC (VIb1, VIb2, IIa2 stay apart), so anything
 * alphabetic at that depth is a local tag. */
eq('a local sub-area tag folds into its division', iceLabel('27.6.a.s'), 'VIa')
// Anything not a 27.x area passes through rather than being mangled into a
// wrong-looking Roman numeral.
eq('a non-27 area is left alone', iceLabel('34.1.1'), '34.1.1')
eq('a bare code is left alone', iceLabel('IVa'), 'IVa')
eq('and nothing is nothing', iceLabel(null), '')
eq('an unknown division number is left alone', iceLabel('27.99.a'), '27.99.a')

/* The EEZ is part of the ground's identity. Audacious fished 27.4.a for 578
 * days in GBR waters and 337 in NOR, and those are different grounds to the man
 * towing over them. */
eq('the EEZ is in the label', groundLabel('27.4.a', 'GBR'), 'IVa (GBR)')
eq('and the same area in another EEZ is a different ground',
  groundKey('27.4.a', 'GBR') === groundKey('27.4.a', 'NOR'), false)
eq('no EEZ, no brackets', groundLabel('27.6.a', null), 'VIa')
eq('a key round-trips', splitKey(groundKey('27.4.a', 'NOR')).label, 'IVa (NOR)')
eq('and one with no EEZ', splitKey(groundKey('27.6.a', null)).eez, null)

// ---- the mix ---------------------------------------------------------------
/* Day-ground PAIRS, not days: a day worked over two grounds counts in both,
 * which is right for attributing wear and is why the shares still sum to 1. */
{
  const rows = [
    { day: '2026-01-10', fao_area: '27.4.a', eez: 'GBR' },
    { day: '2026-01-11', fao_area: '27.4.a', eez: 'GBR' },
    { day: '2026-01-11', fao_area: '27.4.a', eez: 'NOR' },  // same day, two grounds
    { day: '2026-02-01', fao_area: '27.6.a', eez: 'GBR' },
    { day: '2026-05-01', fao_area: '27.6.b', eez: 'GBR' },  // outside the window
  ]
  const mix = groundMix(rows, '2026-01-01', '2026-03-01')
  eq('pairs, not days', mix.pairs, 4)
  eq('a day over two grounds counts in both',
    mix.byGround[groundKey('27.4.a', 'NOR')], 1)
  eq('and outside the window is out', mix.byGround[groundKey('27.6.b', 'GBR')], undefined)

  const shares = mixShares(mix)
  eq('biggest ground first', shares[0].label, 'IVa (GBR)')
  eq('with its share', Math.round(shares[0].share * 100), 50)
  // Shares sum to 1 even though pairs exceed days.
  eq('shares sum to one', Math.round(shares.reduce((a, b) => a + b.share, 0)), 1)

  eq('no window, no mix', groundMix(rows, null, '2026-03-01').pairs, 0)
  eq('no rows, no mix', groundMix(null, '2026-01-01', '2026-03-01').pairs, 0)
  eq('an empty mix has no shares', mixShares({ pairs: 0, byGround: {} }).length, 0)
}

// ---- the wear rate ---------------------------------------------------------
/* THE METHOD. A finished set is ONE set consumed, split across the grounds it
 * was worked over in proportion to the days on each. A ground's rate is then
 * sets-attributed over days-fished.
 *
 * Splitting the set is the whole point: count a set's whole life against every
 * ground it touched and a ground always fished alongside a long-lasting one
 * inherits its figure. */
{
  const netVessel = { n1: 'v1' }
  // Set A: 10 days, all in IVa. Set B: 10 days, all in VIa. Same life, so the
  // rates must come out equal — this is the control.
  const groundDays = {
    v1: [
      ...Array.from({ length: 10 }, (_, i) => ({ day: `2026-01-${String(i + 1).padStart(2, '0')}`, fao_area: '27.4.a', eez: 'GBR' })),
      ...Array.from({ length: 10 }, (_, i) => ({ day: `2026-02-${String(i + 1).padStart(2, '0')}`, fao_area: '27.6.a', eez: 'GBR' })),
    ],
  }
  const lives = [
    { id: 'a', net_id: 'n1', fitted_on: '2026-01-01', removed_on: '2026-01-31' },
    { id: 'b', net_id: 'n1', fitted_on: '2026-02-01', removed_on: '2026-02-28' },
  ]
  const { rows, unattributed } = groundWear(lives, groundDays, netVessel)
  eq('a ground per set', rows.length, 2)
  eq('one whole set attributed to each', rows.map((r) => r.sets), [1, 1])
  eq('and equal time gives equal rates', rows[0].per100, rows[1].per100)
  eq('ten days each', rows.map((r) => r.days), [10, 10])
  eq('nothing went unattributed', unattributed, 0)

  /* A set split across two grounds contributes a FRACTION to each, never a
   * whole set to both. */
  const split = groundWear(
    [{ id: 'c', net_id: 'n1', fitted_on: '2026-01-01', removed_on: '2026-02-28' }],
    groundDays, netVessel)
  eq('a split set is halved', split.rows.map((r) => r.sets), [0.5, 0.5])
  eq('not doubled', split.rows.reduce((a, r) => a + r.sets, 0), 1)

  /* A life with no logbook days inside it is COUNTED, not dropped. Silently
   * losing it would make the rates look better founded than they are. */
  const orphan = groundWear(
    [{ id: 'd', net_id: 'n1', fitted_on: '2030-01-01', removed_on: '2030-02-01' }],
    groundDays, netVessel)
  eq('a life with no ground days is reported', orphan.unattributed, 1)
  eq('and contributes nothing', orphan.rows.length, 0)

  eq('no lives at all', groundWear([], groundDays, netVessel).rows.length, 0)
  eq('and null', groundWear(null, groundDays, netVessel).rows.length, 0)
  // A net whose vessel has no logbook rows must not throw.
  eq('an unknown vessel is handled',
    groundWear([{ id: 'e', net_id: 'zz', fitted_on: '2026-01-01', removed_on: '2026-02-01' }],
      groundDays, netVessel).unattributed, 1)
}

/* A GROUND THAT WORE GEAR FASTER SHOWS A HIGHER RATE. The direction of the
 * measure, asserted rather than assumed: same days fished, shorter life. */
{
  const netVessel = { n1: 'v1' }
  const days = (m, n, fao) => Array.from({ length: n }, (_, i) =>
    ({ day: `2026-${m}-${String(i + 1).padStart(2, '0')}`, fao_area: fao, eez: 'GBR' }))
  const groundDays = {
    // Rough ground: 20 fished days consumed TWO sets.
    // Clean ground: 20 fished days consumed ONE.
    v1: [...days('01', 10, '27.6.b'), ...days('02', 10, '27.6.b'), ...days('03', 20, '27.4.a')],
  }
  const lives = [
    { id: 'r1', net_id: 'n1', fitted_on: '2026-01-01', removed_on: '2026-01-31' },
    { id: 'r2', net_id: 'n1', fitted_on: '2026-02-01', removed_on: '2026-02-28' },
    { id: 'c1', net_id: 'n1', fitted_on: '2026-03-01', removed_on: '2026-03-31' },
  ]
  const { rows } = groundWear(lives, groundDays, netVessel)
  eq('the rough ground ranks first', rows[0].label, 'VIb (GBR)')
  eq('at twice the rate', rows[0].per100 / rows[1].per100, 2)
  eq('on the same fished days', rows[0].days, rows[1].days)
}

// ---- saying whether it means anything --------------------------------------
/* Deliberately strict. Ranking grounds off one or two finished sets would be
 * inventing a finding, and the top of that table is exactly where a thin figure
 * misleads most. */
{
  const thin = [{ days: 4, lives: 1 }, { days: 3, lives: 1 }]
  const solid = [{ days: 200, lives: 4 }, { days: 150, lives: 3 }]
  eq('nothing finished yet', groundConfidence([], 0).level, 'none')
  eq('one set is not a comparison', groundConfidence(solid, 1).level, 'thin')
  eq('two is not either', groundConfidence(solid, 2).level, 'thin')
  eq('three sets on thin grounds is still thin', groundConfidence(thin, 3).level, 'thin')
  eq('three sets on real ground days will do', groundConfidence(solid, 3).level, 'ok')
  eq('and it says what it rests on', groundConfidence(solid, 5).text,
    '5 finished sets across 2 grounds')
}


// ---- folding a local tag ----------------------------------------------------
eq('the tag is dropped from the area itself', normaliseArea('27.6.a.s'), '27.6.a')
eq('a numeric subdivision is kept', normaliseArea('27.6.b.2'), '27.6.b.2')
eq('and a two-deep numeric one', normaliseArea('27.2.a.2'), '27.2.a.2')
eq('a plain division is untouched', normaliseArea('27.4.a'), '27.4.a')
eq('a non-27 area is untouched', normaliseArea('34.1.1'), '34.1.1')
eq('and nothing is nothing', normaliseArea(null), '')

/* FOLDED IN THE KEY, NOT JUST THE LABEL. Relabelling alone would leave
 * 27.6.a and 27.6.a.s as two separate grounds both reading "VIa (GBR)" — two
 * identical rows in the wear table, which is worse than the odd label was. */
eq('the tag keys to the same ground as its division',
  groundKey('27.6.a.s', 'GBR'), groundKey('27.6.a', 'GBR'))
eq('but a numeric subdivision still keys apart',
  groundKey('27.6.b.2', 'GBR') === groundKey('27.6.b', 'GBR'), false)
// The EEZ still separates them: IVa (GBR) and IVa (NOR) are different grounds.
eq('and the EEZ still separates',
  groundKey('27.6.a.s', 'GBR') === groundKey('27.6.a', 'NOR'), false)

{
  // The real case: 24 days of 27.6.a.s joining 149 of 27.6.a.
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => ({ day: `2026-01-0${i + 1}`, fao_area: '27.6.a', eez: 'GBR' })),
    ...Array.from({ length: 2 }, (_, i) => ({ day: `2026-01-1${i + 1}`, fao_area: '27.6.a.s', eez: 'GBR' })),
  ]
  const shares = mixShares(groundMix(rows, '2026-01-01', '2026-02-01'))
  eq('they come back as ONE ground', shares.length, 1)
  eq('named for the division', shares[0].label, 'VIa (GBR)')
  eq('carrying both lots of days', shares[0].days, 5)
}



// ---- HALVES: two halves and an overall -------------------------------------
/* David, Aug 2026: "when measuring a headline/footrope/ground gear we do in 2x
 * halves & total overall." He was already doing it — the 19-08-2026 record
 * carries `Stb 60'3"/Port 60'5"` typed into the NOTES of a separate `inspected`
 * row, because the form had nowhere to put it. Those are the figures below. */
{
  const parts = resolveParts([])
  eq('a headline is measured in halves', partHasHalves(parts, 'headline'), true)
  eq('so is a footrope', partHasHalves(parts, 'footrope'), true)
  eq('so is the ground gear', partHasHalves(parts, 'ground_gear'), true)
  /* NOT the bridles or legs: there is one of each per side already, so they are
   * two components, not one rope with two halves. Halving them would quarter
   * the gear. */
  eq('bridles are NOT halved — they are already per side', partHasHalves(parts, 'bridles'), false)
  eq('nor legs', partHasHalves(parts, 'legs'), false)
  eq('a codend has no halves', partHasHalves(parts, 'codend'), false)

  // And the boat may say otherwise, like every other rule in this app.
  const own = resolveParts([{ part_key: 'codend', halves: true }, { part_key: 'headline', halves: false }])
  eq('a fleet may halve something I did not', partHasHalves(own, 'codend'), true)
  eq('and un-halve something I did', partHasHalves(own, 'headline'), false)
  eq('a row that says nothing about halves keeps the shipped answer',
    partHasHalves(resolveParts([{ part_key: 'headline', label: 'Head rope' }]), 'headline'), true)
}

{
  // THE REAL READING off Audacious's ground gear, 19-08-2026.
  const port = ftInToValue(60, 5)
  const stbd = ftInToValue(60, 3)
  const overall = ftInToValue(120, 8)
  const h = halvesCheck({ port, stbd, overall, unit: 'ft_in' })

  eq('the halves sum to the overall he measured', Math.round(h.diffMm * 100) / 100, 0)
  eq('so the three readings agree', h.agrees, true)
  eq('the overall is the one he measured, not a sum', h.basis, 'measured')
  eq("port is the longer side", h.longer, 'port')
  eq('by two inches', fmtMm(h.imbalanceMm, 'ft_in'), '0′ 2″')
  eq('and the total reads as he wrote it', fmtMm(h.totalMm, 'ft_in'), '120′ 8″')
}

{
  /* THE OVERALL IS NOT DERIVED. It is a third act of measuring, so it can
   * disagree — and when it does, one of the three is wrong. That is a check
   * the paper method could never make, and it is reported, never corrected. */
  const h = halvesCheck({ port: 60, stbd: 60, overall: 121, unit: 'ft_in' })
  eq('a foot out is a real disagreement', h.agrees, false)
  eq('and the size of it is reported', fmtMm(h.diffMm, 'ft_in'), '1′')
  eq('the overall is still what he measured, not the sum', fmtMm(h.totalMm, 'ft_in'), '121′')

  // Within an inch is the same measurement written twice, not a discrepancy.
  const close = halvesCheck({ port: 60, stbd: 60, overall: ftInToValue(120, 1), unit: 'ft_in' })
  eq('an inch is inside the tolerance', close.agrees, true)
  eq('the tolerance is one inch, the resolution ft_in rounds to',
    Math.round(HALVES_TOLERANCE_MM * 10) / 10, 25.4)
}

{
  /* NO OVERALL TAKEN — sum the halves, and SAY it is a sum. A summed total and
   * a measured total are different facts; the basis is what keeps them apart,
   * same as "since measured / since fitted / since aboard" on the matrix. */
  const h = halvesCheck({ port: 60, stbd: 60, overall: '', unit: 'ft_in' })
  eq('the total falls back to the sum', fmtMm(h.totalMm, 'ft_in'), '120′')
  eq('and says so', h.basis, 'summed')
  eq('there is nothing to reconcile against', h.agrees, null)
  eq('agreement unknown is null, never false', h.diffMm, null)
}

{
  /* ONE HALF ONLY. Partial is kept rather than refused — a man who measured one
   * side before the weather came in has a real reading — but nothing may be
   * inferred from it. */
  const h = halvesCheck({ port: 60, stbd: '', overall: '', unit: 'ft_in' })
  eq('one half is not a pair', h.haveBoth, false)
  eq('no sum from one side', h.sumMm, null)
  eq('no imbalance from one side', h.imbalanceMm, null)
  eq('and no longer side', h.longer, null)
  eq('nothing to total', h.totalMm, null)
  eq('and no basis to claim', h.basis, null)
}

{
  // The plain old case: an overall and no halves at all. Every measurement
  // before Aug 2026 is this shape and must still read correctly.
  const h = halvesCheck({ port: '', stbd: '', overall: 120, unit: 'ft_in' })
  eq('an overall on its own still totals', fmtMm(h.totalMm, 'ft_in'), '120′')
  eq('measured, because it was', h.basis, 'measured')
  eq('with no imbalance to report', h.imbalanceMm, null)
  eq('and nothing to check it against', h.agrees, null)
}

{
  // Equal halves have no longer side — `null`, not an arbitrary pick.
  const h = halvesCheck({ port: 60, stbd: 60, overall: 120, unit: 'ft_in' })
  eq('dead level has no longer side', h.longer, null)
  eq('and no imbalance', h.imbalanceMm, 0)

  // BLANK IS NOT ZERO, the trap toMm already guards, checked through this door.
  const blank = halvesCheck({ port: '', stbd: '', overall: '', unit: 'ft_in' })
  eq('all blank gives nothing, not a rope of zero length', blank.totalMm, null)
  eq('and no false agreement', blank.agrees, null)
}

{
  // The unit travels with the reading: fathoms and metres work the same.
  const fm = halvesCheck({ port: 30, stbd: 31, overall: 61, unit: 'fathom' })
  eq('fathoms agree', fm.agrees, true)
  eq('and the imbalance is a fathom', fmtMm(fm.imbalanceMm, 'fathom'), '1 fm')
  const m = halvesCheck({ port: 18.3, stbd: 18.3, overall: 36.6, unit: 'm' })
  eq('metres agree', m.agrees, true)
  eq('and read back in metres', fmtMm(m.totalMm, 'm'), '36.6 m')
}
console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
