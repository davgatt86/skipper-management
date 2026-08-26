/* THE BOX-TOP TICKETS.
 *
 * The spec is six numbers David gave for cod on trip 63 — large x2, cod x4,
 * sprag x4, med x4, b baby x2, baby x4 — and then, when I could not see why
 * baby needed four: "a ticket at first box after big baby, a ticket at bottom
 * of 4th tier, ticket at top of 5th tier and a ticket between baby and next
 * speices/grade."
 *
 * Both ends of both runs. That is the whole rule, and these are his figures.
 */
import assert from 'node:assert/strict'
import {
  runsOf, ticketsFor, ticketSummary, splitGrade, isRegraded, REGRADED, tableFor,
} from './src/lib/market/gradingCards.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- reading a grade -----------------------------------------------------
eq(splitGrade('Large (1b)'), { name: 'Large', code: '1b' }, 'name and code come apart')
eq(splitGrade('X Sma (4b)'), { name: 'X Sma', code: '4b' }, 'and with a space in the name')
eq(splitGrade('Frogs (5a)'), { name: 'Frogs', code: '5a' }, 'and the odd ones')
eq(splitGrade('Whatever'), { name: 'Whatever', code: '' }, 'a grade with no code keeps its name')
eq(splitGrade(null), { name: '', code: '' }, 'and nothing gives nothing')

/* DAVID'S OWN COD, page 1 of trip 63, transcribed from the sheet he sent —
 * tiers 7 to 11, cod along the top row, haddock underneath. The heights matter:
 * big baby and baby are 2HI under Audacious's own rules, and that is what moves
 * where the runs break. Checking this against the DEFAULT rules put them FLAT
 * and made two of his six figures look wrong when the rule was right. */
const cod = (grade, fp, height = 1) =>
  Array.from({ length: fp }, () => ({ species: 'COD', grade, boxes: height, height }))
const had = (grade, fp) => Array.from({ length: fp }, () => ({ species: 'HADDOCK', grade, boxes: 1, height: 1 }))
const blk = (grade, fp) => Array.from({ length: fp }, () => ({ species: 'BLACK', grade, boxes: 2, height: 2 }))

const plan = {
  byTier: [
    { number: 7, tier: 1, area: 'new', top: [...cod('Large (1b)', 9), ...cod('Cod (1c)', 12)], bottom: had('XL (1a)', 26) },
    { number: 8, tier: 2, area: 'new', top: [...cod('Cod (1c)', 6), ...cod('Sprag (2)', 15)], bottom: had('Good Seed (1d)', 26) },
    { number: 9, tier: 3, area: 'new', top: [...cod('Sprag (2)', 18), ...cod('Med (3)', 3)], bottom: had('Seed (2a)', 26) },
    { number: 10, tier: 4, area: 'new', top: [...cod('Med (3)', 15), ...cod('B Baby (4)', 4, 2), ...cod('Baby (5a)', 2, 2)], bottom: had('Seed (2a)', 26) },
    { number: 11, tier: 5, area: 'new', top: [...cod('Baby (5a)', 2, 2), ...blk('Large (1)', 19)], bottom: had('Chipper (2b)', 26) },
  ],
}

// ---- runs ----------------------------------------------------------------
const codRuns = runsOf(plan).filter((r) => r.species === 'COD')
eq(codRuns.map((r) => `${r.name} t${r.tier}`),
   ['Large t7', 'Cod t7', 'Cod t8', 'Sprag t8', 'Sprag t9', 'Med t9', 'Med t10', 'B Baby t10', 'Baby t10', 'Baby t11'],
   'the runs, exactly as his page 1 breaks them')

/* A RUN IS PER TIER AND PER ROW. Cod carrying on into the next tier is a new
 * run because it is a new place on the floor, which is the entire point — the
 * buyer walking past tier 8 needs to be told what he is looking at. */
eq(codRuns.filter((r) => r.name === 'Cod').length, 2, 'cod 1c breaks across tiers 7 and 8')
eq(codRuns.find((r) => r.name === 'Large').footprints, 9, 'and a run knows how long it is')

// ---- HIS SIX FIGURES -----------------------------------------------------
const tickets = ticketsFor(plan)
const per = new Map()
for (const t of tickets.filter((t) => t.species === 'COD')) {
  per.set(t.name, (per.get(t.name) || 0) + 1)
}
eq(Object.fromEntries(per),
   { Large: 2, Cod: 4, Sprag: 4, Med: 4, 'B Baby': 2, Baby: 4 },
   "DAVID'S OWN COUNT for cod on trip 63 — large 2, cod 4, sprag 4, med 4, b baby 2, baby 4")

/* His four for baby, named. "a ticket at first box after big baby, a ticket at
 * bottom of 4th tier, ticket at top of 5th tier and a ticket between baby and
 * next speices/grade" — both ends of both runs. */
const baby = tickets.filter((t) => t.species === 'COD' && t.name === 'Baby')
eq(baby.map((t) => `t${t.tier} ${t.at}`), ['t10 start', 't10 end', 't11 start', 't11 end'],
   'baby is marked four times: after big baby, end of tier 10, top of tier 11, and where black starts')

// A single-footprint run still gets both ends — it is the start AND the finish.
const one = ticketsFor({ byTier: [{ number: 1, top: cod('Sprag (2)', 1), bottom: [] }] })
eq(one.length, 2, 'one box on its own is still marked at both ends')

// ---- REGRADED AT THE MARKET ----------------------------------------------
ok(isRegraded('TURBOT') && isRegraded('halibut'), 'turbot and halibut are regraded')
ok(!isRegraded('COD'), 'cod is not')
eq(REGRADED.TURBOT.length, 8, 'eight turbot bands, off the boat\'s own artwork')
eq(REGRADED.HALIBUT.length, 5, 'five halibut bands')

{
  /* The boat can only call them Large or Small; the market splits them by
   * weight. So the ticket carries a BAND and no grade code — and the number of
   * them is gauged by how much there is, because printing all eight bands for
   * a single box is the waste this page exists to stop. */
  const p = { byTier: [{ number: 1, top: [
    { species: 'TURBOT', grade: 'Small (U9b)', boxes: 1, height: 1 },
    ...Array.from({ length: 8 }, () => ({ species: 'HALIBUT', grade: 'Large (U9a)', boxes: 1, height: 1 })),
  ], bottom: [] }] }
  const t = ticketsFor(p)
  const tur = t.filter((x) => x.species === 'TURBOT')
  const hal = t.filter((x) => x.species === 'HALIBUT')
  eq(tur.length, 1, 'one turbot box on trip 63 gives ONE band ticket, not eight')
  eq(hal.length, 5, 'eight halibut boxes gives all five bands')
  eq(tur[0].code, '', 'a regraded ticket carries no grade code')
  eq(tur[0].name, '0-1 kg', 'it carries a weight band')
  ok(t.every((x) => x.species !== 'TURBOT' || x.regraded), 'and no ordinary grade ticket is printed for them')
}

// ---- what the page tells him ---------------------------------------------
{
  const s = ticketSummary(plan)
  eq(s.tickets, tickets.length, 'the count')
  eq(s.pages, Math.ceil(tickets.length / 8), 'eight tickets to an A4 page, as the folder does it')
  ok(s.kinds <= s.tickets, 'kinds never exceeds tickets')
  ok(s.species.includes('COD') && s.species.includes('HADDOCK'), 'and it names what is aboard')
}

// ---- the grading table, cut to what is landed ----------------------------
{
  /* The folder's four sheets carry every grade Peterhead recognises. This is
   * the handful the crew are grading to, so nobody reads past fish that is not
   * there — the same argument as the buyers' catalogue. */
  const TABLE = {
    COD: [{ code: '1b', name: 'LARGE', band: '10-12 kg' }, { code: '1c', name: 'COD', band: '7-10 kg' },
          { code: '2', name: 'SPRAG', band: '4-7 kg' }, { code: '1a', name: 'XL', band: '12 + kg' }],
  }
  const t = tableFor(plan, TABLE)
  const codRow = t.find((x) => x.species === 'COD')
  eq(codRow.rows.map((r) => r.code).sort(), ['1b', '1c', '2'], 'only the cod grades actually landed')
  ok(!codRow.rows.some((r) => r.code === '1a'), 'XL cod is not on the trip, so it is not on the sheet')
  ok(t.find((x) => x.species === 'HADDOCK').unknown, 'a species with no table rows is flagged, not dropped')
}

// ---- empties -------------------------------------------------------------
eq(runsOf(null), [], 'no plan, no runs')
eq(ticketsFor({ byTier: [] }), [], 'no tiers, no tickets')
eq(ticketSummary({ byTier: [] }).pages, 0, 'and no paper')

console.log('grading cards: ' + n + ' checks passed')
