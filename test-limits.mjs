/* Engine operating ranges.
 *
 * The case this whole file exists for: Gearbox 1 Oil Press read
 * 28, 28, 2.8, 2.8, 38, 25, 38 — two of seven entries on the wrong scale, and
 * the MEDIAN was 28. So a check derived from history alone called the CORRECT
 * readings outliers, and an engineer trusting it would have "fixed" the good
 * data into the bad. David settled it 21-08-2026: the gauge runs 25–38.
 *
 * Hence: the range is STATED and the rolling average only ever comments.
 */
import {
  checkRange, checkReadings, isCounter, seedLimits, limitFor, limitKey,
  DRIFT_PCT, MIN_HISTORY, counterReversals,
} from './src/lib/engine/limits.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const LIM = (o) => ({
  group_key: 'Main Engine 1', param_key: 'Lube Oil Pressure',
  min_val: 4, max_val: 5.5, enabled: true, is_counter: false, confirmed: true, ...o,
})

// ---- the range ------------------------------------------------------------
eq('a reading inside the range', checkRange(4.6, LIM())?.side, 'in')
eq('one over the top', checkRange(9, LIM())?.side, 'over')
eq('one under the bottom', checkRange(1, LIM())?.side, 'under')
eq('exactly on the ceiling is inside', checkRange(5.5, LIM())?.side, 'in')
eq('exactly on the floor is inside', checkRange(4, LIM())?.side, 'in')

/* NULL, NOT "IN" — the caller must be able to tell "inside the range" from
 * "there is no range", or an unchecked parameter reads as a passed one. */
eq('no limit at all checks nothing', checkRange(4.6, null), null)
eq('a disabled limit checks nothing', checkRange(999, LIM({ enabled: false })), null)
eq('a counter checks nothing', checkRange(999, LIM({ is_counter: true })), null)
eq('a limit with no bounds checks nothing',
  checkRange(4.6, LIM({ min_val: null, max_val: null })), null)
eq('a blank reading checks nothing', checkRange('', LIM()), null)
eq('and so does a word', checkRange('n/a', LIM()), null)

// One-sided limits are legitimate — plenty of things have a floor and no ceiling.
eq('a floor with no ceiling still bites', checkRange(1, LIM({ max_val: null }))?.side, 'under')
eq('and lets a high reading through', checkRange(900, LIM({ max_val: null }))?.side, 'in')

// ---- counters, detected not guessed ---------------------------------------
/* Running hours only ever climb, so a range on them is meaningless. Reading
 * that off the series is honest; matching the word "hours" would be another
 * guess of exactly the kind this file exists to stop. */
eq('a climbing series is a counter', isCounter([1000, 1100, 1180, 1260, 1320]), true)
eq('a flat-then-climbing one still is', isCounter([100, 110, 120, 140]), true)
eq('a wandering series is not', isCounter([4.6, 4.2, 4.8, 4.4, 4.6]), false)
eq('one that goes backwards is not', isCounter([100, 200, 150, 300]), false)
eq('a series that never moves is not', isCounter([5, 5, 5, 5, 5]), false)
/* A MINORITY of backward steps is a bad entry, not a different kind of
 * parameter. Demanding a perfect climb, Main Engine 1 running hours came back
 * "not a counter" over 19 readings because ONE was a duplicate of an earlier
 * day — so it got a numeric range and the reversal check never ran on it. The
 * bad entry was hiding the one test that proves it wrong. */
eq('one bad step in a long climb is still a counter',
  isCounter([100, 200, 300, 400, 250, 500, 600, 700, 800, 900]), true)
eq('but a series that wanders half the time is not',
  isCounter([100, 200, 150, 300, 250, 400, 350, 500]), false)

/* THE REAL DISCRIMINATOR: a counter makes net progress its dips cannot account
 * for. Allowing a flat fifth of backward steps let gearbox oil pressure, jacket
 * water temperature and start air pressure all pass as counters on seven
 * readings with one dip each — found by seeding against the real logs. */
// Main Engine running hours: climbs 1,948 with one 872 dip. A counter.
eq('running hours with the duplicate entry in them',
  isCounter([65662, 65697, 65820, 65924, 66032, 66081, 66176, 66235, 66433,
             66796, 65924, 67105, 67205, 67280, 67330, 67357, 67490, 67541, 67610]), true)
// Generator 2 hours: shorter, but the same shape.
eq('a shorter run of hours is still a counter',
  isCounter([8707, 8594, 8876, 8976, 9011, 9061, 9087]), true)
// Gearbox oil pressure: climbs 10 across its whole history and dips 13.
eq('gearbox oil pressure is wandering, not counting',
  isCounter([28, 28, 28, 28, 38, 25, 38]), false)
// Jacket water temperature: rises 1 degree over its life and dips further.
eq('a temperature that ends higher than it started is not a counter',
  isCounter([78, 78, 78, 79, 79, 80, 80, 80, 80, 80, 81, 80, 81, 83, 81, 81, 79]), false)
// A reversal is only dismissible on a decent run.
/* A COUNTER COUNTS, so it rarely reads the same twice. Gearbox PTO 3 bearing
 * temperature sat at 54 for fourteen readings and finished at 58 — net
 * progress, one dip, and obviously not a counter. */
eq('a reading that sits still is not a counter',
  isCounter([54, 54, 54, 54, 54, 54, 54, 54, 54, 54, 54, 54, 54, 54, 57, 54, 58]), false)
eq('while hours are all but perfectly distinct',
  isCounter([7350, 7385, 7485, 7588, 7696, 7745, 8264, 8610, 8727]), true)
eq('with too few readings a dip is not dismissed',
  isCounter([100, 200, 150, 300, 400]), false)
eq('too short to tell', isCounter([1, 2, 3]), false)
eq('nothing at all', isCounter([]), false)
eq('and null', isCounter(null), false)

// ---- both checks together --------------------------------------------------
{
  const limits = [
    LIM(),
    LIM({ param_key: 'Running Hours', is_counter: true, enabled: false, min_val: null, max_val: null }),
    LIM({ group_key: 'Gearbox 1', param_key: 'Oil Press', min_val: 20, max_val: 45 }),
  ]
  const prior = [
    { readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Charge Air Pressure': 1.8 } } },
    { readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Charge Air Pressure': 1.8 } } },
    { readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Charge Air Pressure': 1.8 } } },
  ]

  // THE GEARBOX CASE. 28 is correct and must pass, even though a mean taken
  // over a series polluted with 2.8s would call it wild.
  const gearboxPrior = [
    { readings: { 'Gearbox 1': { 'Oil Press': 2.8 } } },
    { readings: { 'Gearbox 1': { 'Oil Press': 2.8 } } },
    { readings: { 'Gearbox 1': { 'Oil Press': 2.8 } } },
  ]
  const good = checkReadings({ 'Gearbox 1': { 'Oil Press': 28 } }, limits, gearboxPrior)
  eq('a correct reading is not called a range breach',
    good.filter((f) => f.kind === 'range').length, 0)
  // It is still flagged as drift, which is right — it IS unusual against that
  // history — but it is the softer of the two, and it says the stated range
  // allows it.
  eq('though it is noted as drifting', good[0].kind, 'drift')
  eq('and the note says the stated range allows it', good[0].insideStatedRange, true)

  // And the mis-key it replaced fails the range outright.
  const bad = checkReadings({ 'Gearbox 1': { 'Oil Press': 2.8 } }, limits, [])
  eq('the mis-key breaches the range', bad[0].kind, 'range')
  eq('under the floor', bad[0].side, 'under')

  // A range breach outranks a drift note on the SAME parameter — one fact
  // should not wear two hats.
  const both = checkReadings({ 'Main Engine 1': { 'Lube Oil Pressure': 42 } }, limits, prior)
  eq('one finding, not two', both.length, 1)
  eq('and it is the range', both[0].kind, 'range')

  // Range findings sort above drift findings.
  const mixed = checkReadings({
    'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Charge Air Pressure': 9 },
    'Gearbox 1': { 'Oil Press': 2.8 },
  }, limits, prior)
  eq('the range breach comes first', mixed[0].kind, 'range')

  // A counter is never checked and never drifts.
  eq('a counter raises nothing',
    checkReadings({ 'Main Engine 1': { 'Running Hours': 99999 } }, limits,
      [{ readings: { 'Main Engine 1': { 'Running Hours': 100 } } },
       { readings: { 'Main Engine 1': { 'Running Hours': 200 } } },
       { readings: { 'Main Engine 1': { 'Running Hours': 300 } } }]).length, 0)

  eq('a reading with no limit and no history raises nothing',
    checkReadings({ 'Generator 9': { Whatever: 5 } }, limits, []).length, 0)
  eq('nothing at all is handled', checkReadings(null, limits, prior).length, 0)
}

// ---- seeding ---------------------------------------------------------------
/* The seed is a SUGGESTION and comes back unconfirmed. An engineer confirming
 * a range is what turns it into the authority — a guess presented as a fact is
 * worse than an obvious gap. */
{
  const logs = [
    { log_date: '2026-01-01', readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.2, 'Running Hours': 1000 } } },
    { log_date: '2026-01-02', readings: { 'Main Engine 1': { 'Lube Oil Pressure': 5.0, 'Running Hours': 1100 } } },
    { log_date: '2026-01-03', readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Running Hours': 1200 } } },
    { log_date: '2026-01-04', readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.6, 'Running Hours': 1300 } } },
    { log_date: '2026-01-05', readings: { 'Main Engine 1': { 'Lube Oil Pressure': 4.4, 'Running Hours': 1400 } } },
    { log_date: '2026-01-06', readings: { 'Main Engine 1': { Rare: 7 } } },
  ]
  const seeded = seedLimits(logs)
  const oil = seeded.find((x) => x.param_key === 'Lube Oil Pressure')
  const hrs = seeded.find((x) => x.param_key === 'Running Hours')

  eq('nothing is seeded as confirmed', seeded.every((x) => !x.confirmed), true)
  eq('and everything is marked as seeded', seeded.every((x) => x.source === 'seeded'), true)
  eq('a parameter with too few readings is skipped',
    seeded.some((x) => x.param_key === 'Rare'), false)
  eq('the count is carried so the page can show it', oil.n, 5)
  eq('and the observed span, so the margin is visible', oil.observed, [4.2, 5])

  /* The range is the span WITH A MARGIN. An engine that has run 4.2 to 5.0 will
   * one day run 4.1 with nothing wrong, and a limit that cries at the first
   * ordinary reading gets switched off — which is worse than no limit. */
  eq('the floor sits below what was seen', oil.min_val < 4.2, true)
  eq('and the ceiling above it', oil.max_val > 5.0, true)
  eq('by the stated margin', [oil.min_val, oil.max_val], [4.08, 5.12])

  // The counter is found and left unchecked.
  eq('running hours is spotted as a counter', hrs.is_counter, true)
  eq('and is not checked', hrs.enabled, false)
  eq('with no bounds to check against', [hrs.min_val, hrs.max_val], [null, null])

  /* A parameter that has never moved must not get a single-point range, or the
   * next reading breaks it. */
  const flat = seedLimits([1, 2, 3, 4, 5].map((i) => ({
    log_date: `2026-02-0${i}`, readings: { G: { Steady: 100 } },
  })))
  eq('a never-moving parameter still gets room', flat[0].max_val > flat[0].min_val, true)
  eq('centred on what it reads',
    flat[0].min_val < 100 && flat[0].max_val > 100, true)

  eq('no logs, no seed', seedLimits([]).length, 0)
  eq('and null', seedLimits(null).length, 0)
}

// ---- odds and ends ---------------------------------------------------------
eq('a key is group and param', limitKey('Gearbox 1', 'Oil Press'), 'Gearbox 1||Oil Press')
eq('a limit is found by both', limitFor([LIM()], 'Main Engine 1', 'Lube Oil Pressure')?.min_val, 4)
eq('and not by one', limitFor([LIM()], 'Gearbox 1', 'Lube Oil Pressure'), null)
eq('drift threshold is documented', DRIFT_PCT, 0.6)
eq('and the history floor', MIN_HISTORY, 3)

// ---- a counter that went backwards ----------------------------------------
/* The most reliable signal in the log, and it needs no limit at all: running
 * hours only climb, so a reading below the one before it is wrong, full stop.
 *
 * It found a real one on the first run. Main Engine 1 read 66,796 on 17-07-2026,
 * 65,924 on 30-07, then 67,105 on 31-07 — and the whole 30-07 block turned out
 * to be an exact copy of 09-06's. A RANGE CHECK WOULD NEVER HAVE CAUGHT IT:
 * every figure in it is perfectly ordinary, and it is only wrong in relation to
 * the one before. */
{
  const counter = [LIM({ group_key: 'ME', param_key: 'Hours',
                         is_counter: true, enabled: false, min_val: null, max_val: null })]
  const real = [
    { log_date: '2026-07-17', readings: { ME: { Hours: 66796 } } },
    { log_date: '2026-07-30', readings: { ME: { Hours: 65924 } } },
    { log_date: '2026-07-31', readings: { ME: { Hours: 67105 } } },
  ]
  const rev = counterReversals(real, counter)
  eq('the reversal is found', rev.length, 1)
  eq('on the right day', rev[0].on, '2026-07-30')
  eq('against the reading before it', rev[0].previous, 66796)
  eq('and says how far back it went', rev[0].back, 872)

  /* ONE bad entry must not make every good reading after it look like a second
   * reversal — the high-water mark only advances on a forward step. */
  eq('the entry after it is not also flagged',
    rev.filter((r) => r.on === '2026-07-31').length, 0)

  eq('a clean climb raises nothing', counterReversals([
    { log_date: '2026-01-01', readings: { ME: { Hours: 100 } } },
    { log_date: '2026-01-02', readings: { ME: { Hours: 200 } } },
  ], counter).length, 0)
  eq('a repeated reading is not a reversal', counterReversals([
    { log_date: '2026-01-01', readings: { ME: { Hours: 100 } } },
    { log_date: '2026-01-02', readings: { ME: { Hours: 100 } } },
  ], counter).length, 0)
  // Only counters. A pressure going down is just a pressure going down.
  eq('a non-counter is left alone', counterReversals([
    { log_date: '2026-01-01', readings: { ME: { Press: 5 } } },
    { log_date: '2026-01-02', readings: { ME: { Press: 4 } } },
  ], [LIM({ group_key: 'ME', param_key: 'Press' })]).length, 0)
  eq('and one with no limit at all', counterReversals(real, []).length, 0)
  // Order in the array must not decide it — the dates do.
  eq('out-of-order rows are sorted first',
    counterReversals([real[2], real[0], real[1]], counter)[0].on, '2026-07-30')
  eq('nothing at all', counterReversals(null, counter).length, 0)
}


console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
