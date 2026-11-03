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
  DRIFT_PCT, MIN_HISTORY, counterFaults, hoursLeap,
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
  const rev = counterFaults(real, counter)
  eq('the reversal is found', rev.length, 1)
  eq('on the right day', rev[0].on, '2026-07-30')
  eq('against the reading before it', rev[0].previous, 66796)
  eq('and says how far back it went', rev[0].back, 872)

  /* ONE bad entry must not make every good reading after it look like a second
   * reversal — the high-water mark only advances on a forward step. */
  eq('the entry after it is not also flagged',
    rev.filter((r) => r.on === '2026-07-31').length, 0)

  eq('a clean climb raises nothing', counterFaults([
    { log_date: '2026-01-01', readings: { ME: { Hours: 100 } } },
    { log_date: '2026-01-02', readings: { ME: { Hours: 200 } } },
  ], counter).length, 0)
  eq('a repeated reading is not a reversal', counterFaults([
    { log_date: '2026-01-01', readings: { ME: { Hours: 100 } } },
    { log_date: '2026-01-02', readings: { ME: { Hours: 100 } } },
  ], counter).length, 0)
  // Only counters. A pressure going down is just a pressure going down.
  eq('a non-counter is left alone', counterFaults([
    { log_date: '2026-01-01', readings: { ME: { Press: 5 } } },
    { log_date: '2026-01-02', readings: { ME: { Press: 4 } } },
  ], [LIM({ group_key: 'ME', param_key: 'Press' })]).length, 0)
  eq('and one with no limit at all', counterFaults(real, []).length, 0)
  // Order in the array must not decide it — the dates do.
  eq('out-of-order rows are sorted first',
    counterFaults([real[2], real[0], real[1]], counter)[0].on, '2026-07-30')
  eq('nothing at all', counterFaults(null, counter).length, 0)
  eq('a blank counter box is not a reading of nought, so not a reversal', counterFaults([
    { log_date: '2026-01-01', readings: { ME: { Hours: 100 } } },
    { log_date: '2026-01-02', readings: { ME: { Hours: '' } } },
  ], counter).length, 0)
}

/* WRITTEN AGAINST THE WRONG ENGINE. David, Sep 2026: a counter logged lower is
 * the engineer's mistake, and the likeliest one is the wrong generator heading.
 * The generator figures are the boat's real last readings: Generator 2 9,087 on
 * 09-08, Generator 1 8,864 on 26-08. */
{
  const GEN = (g) => LIM({ group_key: g, param_key: 'Running Hours', is_counter: true, enabled: false, min_val: null, max_val: null })
  const gens = [GEN('Generator 1'), GEN('Generator 2'), GEN('Main Engine 1')]
  const hist = [
    { id: 'a', log_date: '2026-08-09', readings: { 'Generator 2': { 'Running Hours': 9087 } } },
    { id: 'b', log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 8864 } } },
  ]
  const add = (id, log_date, readings) => counterFaults([...hist, { id, log_date, readings }], gens)

  const swapped = add('c', '2026-09-06', { 'Generator 2': { 'Running Hours': 8900 } })
  eq('a Generator 1 figure typed under Generator 2 is caught as lower', swapped.length, 1)
  eq('and the warning names the entry it is on, so the card can carry it', swapped[0].id, 'c')
  eq('it fits Generator 1, whose last reading it follows', swapped[0].fitsGroup?.group, 'Generator 1')
  eq('against that reading', swapped[0].fitsGroup?.previous, 8864)

  const nowhere = add('d', '2026-09-06', { 'Generator 1': { 'Running Hours': 7396 } })
  eq('7,396 under Generator 1 is lower than 8,864', nowhere[0]?.previous, 8864)
  eq('and fits Generator 2 no better, so no engine is named', nowhere[0]?.fitsGroup, null)
  eq('but it says the other generator WAS checked', nowhere[0]?.siblingsChecked, 1)

  /* 24 HOURS A DAY IS THE CEILING. Generator 2 was 9,087 on 09-08, so by 06-09
   * it can read at most 9,087 + 24 × 29 = 9,783. */
  const ceiling = [
    { id: 'e', log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 10000 } } },
    { id: 'f', log_date: '2026-09-06', readings: { 'Generator 1': { 'Running Hours': 9950 } } },
  ]
  const tooFar = counterFaults([hist[0], ...ceiling], gens)
  eq('a figure further ahead than 24 hours a day allows fits no machine', tooFar[0]?.fitsGroup, null)
  const inReach = counterFaults([hist[0], ceiling[0], { ...ceiling[1], readings: { 'Generator 1': { 'Running Hours': 9780 } } }], gens)
  eq('one inside that ceiling does', inReach[0]?.fitsGroup?.group, 'Generator 2')

  const main = counterFaults([
    { log_date: '2026-08-26', readings: { 'Main Engine 1': { 'Running Hours': 67746 } } },
    { log_date: '2026-09-06', readings: { 'Main Engine 1': { 'Running Hours': 67700 } } },
  ], gens)
  eq('the main engine has no twin, so nothing is compared', [main[0]?.fitsGroup, main[0]?.siblingsChecked], [null, 0])

  /* THE ONE LOWER READING THAT IS NOT A MISTAKE. David: the meter goes back to
   * nought, but at 9,999 hours. */
  const wrapped = counterFaults([
    { log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 9990 } } },
    { log_date: '2026-08-29', readings: { 'Generator 1': { 'Running Hours': 40 } } },
    { log_date: '2026-08-30', readings: { 'Generator 1': { 'Running Hours': 64 } } },
  ], gens)
  eq('9,990 then 40 three days later is the meter rolling over, not a reversal', wrapped.length, 0)
  eq('and the count carries on from 40, so 64 the next day is fine too', wrapped.length, 0)
  eq('the real 8,864 to 7,396 is still a mistake — 8,532 hours in eleven days is impossible',
    add('g', '2026-09-06', { 'Generator 1': { 'Running Hours': 7396 } }).length, 1)
  eq('9,000 to 100 the next day is not a rollover either — 1,100 hours in a day', counterFaults([
    { log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 9000 } } },
    { log_date: '2026-08-27', readings: { 'Generator 1': { 'Running Hours': 100 } } },
  ], gens).length, 1)
  eq('a five-figure meter wraps at 100,000', counterFaults([
    { log_date: '2026-08-26', readings: { 'Main Engine 1': { 'Running Hours': 99990 } } },
    { log_date: '2026-08-27', readings: { 'Main Engine 1': { 'Running Hours': 10 } } },
  ], gens).length, 0)
  eq('with no dates, a rollover is never assumed', counterFaults([
    { readings: { 'Generator 1': { 'Running Hours': 9990 } } },
    { readings: { 'Generator 1': { 'Running Hours': 40 } } },
  ], gens).length, 1)
  eq('only an hour meter rolls over — a counter with no hours unit does not', counterFaults([
    { log_date: '2026-08-26', readings: { ME: { Hours: 9990 } } },
    { log_date: '2026-08-27', readings: { ME: { Hours: 5 } } },
  ], [LIM({ group_key: 'ME', param_key: 'Hours', is_counter: true, enabled: false, min_val: null, max_val: null })]).length, 1)

  /* Needs a THIRD generator to be possible at all, so it brings its own
   * template — with two, there is only ever one other machine to fit. */
  const three = ['Generator 1', 'Generator 2', 'Generator 3'].map((group) => ({ group, params: [{ label: 'Running Hours', unit: 'h' }] }))
  const both = counterFaults([
    { log_date: '2026-08-25', readings: { 'Generator 1': { 'Running Hours': 9000 }, 'Generator 2': { 'Running Hours': 8800 }, 'Generator 3': { 'Running Hours': 8810 } } },
    { log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 8830 } } },
  ], [...gens, GEN('Generator 3')], three)[0]
  eq('two machines that both fit name neither — that would be a guess', [both?.fitsGroup, both?.siblingsChecked], [null, 2])
}


/* A COUNTER THAT GAINED MORE HOURS THAN THERE WERE HOURS.
 *
 * The real one: David's log of 01-10-2026, entered on 2 November with the month
 * a wheel out. Main Engine 1 at 68,959 against 68,223 two days before — 736
 * hours in 48. Every figure on the entry is ordinary and only the DATE is
 * wrong, which is the shape neither the range check nor the reversal check can
 * see; it sailed in, and the stale-log alert went on firing because the latest
 * log_date had not moved.
 */
{
  const GEN = (g) => LIM({ group_key: g, param_key: 'Running Hours', is_counter: true, enabled: false, min_val: null, max_val: null })
  const gens = [GEN('Generator 1'), GEN('Generator 2'), GEN('Main Engine 1')]
  const ME = (log_date, h, id) => ({ id, log_date, readings: { 'Main Engine 1': { 'Running Hours': h } } })

  const real = counterFaults([ME('2026-09-29', 68223), ME('2026-10-01', 68959, 'x')], gens)
  eq('the real 01-10 entry is caught', real.length, 1)
  eq('as a leap, not a reversal — it went the other way', real[0].kind, 'leap')
  eq('it names the entry, so the card can carry it', real[0].id, 'x')
  eq('736 hours gained', real[0].gained, 736)
  eq('over 2 days', real[0].days, 2)
  eq('against a ceiling of 24 x (2 + 1)', real[0].allowed, 72)
  eq('which is 368 hours a day', real[0].perDay, 368)

  /* DATED 1 NOVEMBER, WHERE IT BELONGS, IT IS AN ORDINARY ENTRY: 92 hours on
   * from 27-10, five days later. The figure was never the problem. */
  eq('the same reading on its real day raises nothing',
    counterFaults([ME('2026-10-27', 68867), ME('2026-11-01', 68959)], gens).length, 0)

  /* THE CEILING IS PHYSICS, AND IT HAS TO LET A HARD-WORKED ENGINE THROUGH.
   * This boat tows round the clock, so a day's slack is the whole margin. */
  eq('24 hours in a day is fine', counterFaults([ME('2026-01-01', 100), ME('2026-01-02', 124)], gens).length, 0)
  eq('so is 48, which is the slack for readings taken at different times',
    counterFaults([ME('2026-01-01', 100), ME('2026-01-02', 148)], gens).length, 0)
  eq('49 is not', counterFaults([ME('2026-01-01', 100), ME('2026-01-02', 149)], gens).length, 1)

  /* A GAP IN THE BOOK IS NOT A FAULT. The ceiling scales with the clock, so
   * this never fires merely because nobody wrote anything down for two months. */
  eq('1,000 hours over 60 days is well inside the ceiling',
    counterFaults([ME('2026-01-01', 100), ME('2026-03-02', 1100)], gens).length, 0)

  /* ONLY HOURS CARRY THE CEILING. Oil added is a counter too and a man may add
   * as many litres as he likes in a day. */
  const litres = [LIM({ group_key: 'Main Engine 1', param_key: 'Oil added', is_counter: true, enabled: false, min_val: null, max_val: null })]
  eq('a counter that is not an hour meter never leaps', counterFaults([
    { log_date: '2026-01-01', readings: { 'Main Engine 1': { 'Oil added': 10 } } },
    { log_date: '2026-01-02', readings: { 'Main Engine 1': { 'Oil added': 9999 } } },
  ], litres).length, 0)

  eq('with no date there is no ceiling to breach', counterFaults([
    { readings: { 'Main Engine 1': { 'Running Hours': 100 } } },
    { readings: { 'Main Engine 1': { 'Running Hours': 99999 } } },
  ], gens).length, 0)
  eq('the first reading of a series cannot leap', counterFaults([ME('2026-01-01', 99999)], gens).length, 0)
  const sameDay = hoursLeap({ value: 100, on: '2026-01-01' }, 125, '2026-01-01')
  eq('two readings on one day still get 24 hours', sameDay?.allowed, 24)
  /* STRINGIFIED, because JSON.stringify(Infinity) is "null" — asserting
   * perDay === null the ordinary way passed happily on a copy that divided by
   * nought days and would have printed "Infinity a day" on the warning. */
  eq('and no per-day rate, since dividing by nought days is not a number',
    String(sameDay?.perDay), 'null')
  eq('a step that goes backwards is the reversal check’s business, not this one',
    hoursLeap({ value: 100, on: '2026-01-01' }, 50, '2026-01-02'), null)
  eq('and a rollover is still a rollover', counterFaults([
    { log_date: '2026-08-26', readings: { 'Generator 1': { 'Running Hours': 9990 } } },
    { log_date: '2026-08-29', readings: { 'Generator 1': { 'Running Hours': 40 } } },
  ], gens).length, 0)

  /* TWO BASELINES, AND THIS IS WHAT THEY BUY.
   *
   * A leap carries the series FORWARD — 68,959 is a true reading of that meter,
   * just filed early — so the next entry is measured from it and not from a
   * stale mark that the engine's own 24-hour working day can never catch up
   * with. Measured on the boat's real August run, where the old single
   * high-water baseline reported seven. */
  const august = counterFaults([
    ME('2026-07-31', 67105), ME('2026-08-03', 67205), ME('2026-08-05', 67280),
    ME('2026-08-08', 67330), ME('2026-08-09', 67357), ME('2026-08-15', 67490),
    ME('2026-08-17', 67541), ME('2026-08-20', 67610),
  ], gens)
  eq('the real August run has two breaks, not seven', august.length, 2)
  eq('on the two days consecutive readings cannot both be right',
    august.map((f) => f.on), ['2026-08-03', '2026-08-05'])

  /* AND A LEAP NEVER BECOMES THE HIGH-WATER MARK, or the six ordinary entries
   * after 68,959 would every one read as a reversal — one mistake, six red
   * cards, and the wrong six. */
  const after = counterFaults([
    ME('2026-09-29', 68223), ME('2026-10-01', 68959), ME('2026-10-02', 68315),
    ME('2026-10-06', 68385), ME('2026-10-10', 68493),
  ], gens)
  eq('the leap is reported once and the entries after it are left alone', after.length, 1)
  eq('and it is the leap, not a reversal on the entry that follows', after[0].on, '2026-10-01')

  /* THE OTHER DIRECTION OF THE SAME RULE. A reversal is not believed at all, so
   * it must not seed the forward check either — measuring 68,100 from a
   * mis-keyed 6,800 would manufacture a 61,240-hour leap out of a good entry.
   *
   * The 40 hours is deliberate and the first draft of this test got it wrong:
   * 68,100 two days on is 50 hours a day, which is impossible whatever happened
   * in between, so the check flagged it and was right to. A fixture has to be
   * physically possible before it can prove anything about the physics. */
  const dip = counterFaults([ME('2026-01-01', 68000), ME('2026-01-02', 6800), ME('2026-01-03', 68040)], gens)
  eq('a mis-keyed low reading is one reversal', dip.length, 1)
  eq('and the good reading after it is not turned into a leap', dip[0].kind, 'reversal')
  eq('on the mis-keyed entry, not the good one', dip[0].on, '2026-01-02')
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
