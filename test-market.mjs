import {
  tiersByRuleOfThumb, maxHeight, auctionFor, valueOf, gradeBand, resolveRules,
  TOP_ROW, BOTTOM_ROW,
} from './src/lib/market/layoutRules.js'
import { buildStacks, planLayout, solveDrops } from './src/lib/market/planLayout.js'
import {
  runsOf, sheetPages, assignColours, gradeName, gradeCode, shortSpecies,
} from './src/lib/market/sheet.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// ---- the tier rule of thumb, against David's own worked examples ----------
eq('94 boxes -> 2 tiers (lands whole, +1)', tiersByRuleOfThumb(94), 2)
eq('1200 -> 14 (12.76, over .7 so +1)', tiersByRuleOfThumb(1200), 14)
eq('1550 -> 17 (16.49, under .7)', tiersByRuleOfThumb(1550), 17)
eq('188 -> 3 (lands whole on 2, +1)', tiersByRuleOfThumb(188), 3)
eq('nothing -> 0', tiersByRuleOfThumb(0), 0)

// ---- heights, including the three edges David confirmed -------------------
eq('haddock M Metro 4 high', maxHeight('HADDOCK', 'M Metro (4)'), 4)
eq('haddock Metro 3 high', maxHeight('HADDOCK', 'Metro (3)'), 3)
eq('haddock Good Seed flat', maxHeight('HADDOCK', 'Good Seed (1d)'), 1)
eq('haddock Chipper 2 high', maxHeight('HADDOCK', 'Chipper (2b)'), 2)
eq('cod Sprag flat (the edge case)', maxHeight('COD', 'Sprag (2)'), 1)
eq('cod Med flat', maxHeight('COD', 'Med (3)'), 1)
eq('cod Baby 2 high', maxHeight('COD', 'Baby (5a)'), 2)
eq('black XX Sma 4 high (the edge case)', maxHeight('BLACK', 'XX Sma (4c)'), 4)
eq('black Sel 3 high', maxHeight('BLACK', 'Sel (3)'), 3)
eq('black Large 2 high', maxHeight('BLACK', 'Large (1)'), 2)
eq('whiting S Round 4 high', maxHeight('WHITING', 'S Round (4)'), 4)
eq('whiting Small 2 high', maxHeight('WHITING', 'Small (2)'), 2)
eq('cod roe lies flat (the edge case)', maxHeight('COD ROE', 'Cod Roe'), 1)
eq('monks flat', maxHeight('MONKS', 'Large (1)'), 1)
eq('cat 2 high', maxHeight('CAT', 'Large (U9a)'), 2)

// ---- auctions ------------------------------------------------------------
eq('cod roe rides with cod', auctionFor('COD ROE'), 'cod')
eq('whiting with haddock', auctionFor('WHITING'), 'hadwhit')
eq('black is rough', auctionFor('BLACK'), 'rough')
eq('cat is rough (David, Aug 2026)', auctionFor('CAT'), 'rough')
eq('hake is a flat', auctionFor('HAKE'), 'flats')
eq('an unknown fish still gets a home', auctionFor('WOLFFISH'), 'rough')

// ---- stacks --------------------------------------------------------------
const s1 = buildStacks([{ day: 1, boxes: 5 }, { day: 3, boxes: 4 }], 4)
eq('stacks fill to the height', s1.map((s) => s.boxes), [4, 4, 1])
eq('and run day HIGH to LOW', s1[0].parts.map((p) => p.day), [3])
eq('a stack may span two days rather than stand part-full',
  s1[1].parts.map((p) => `${p.day}:${p.boxes}`), ['3:0'].length ? ['1:4'] : [])
eq('every box survives stacking', s1.reduce((a, s) => a + s.boxes, 0), 9)

const flat = buildStacks([{ day: 2, boxes: 3 }], 1)
eq('a flat grade makes one footprint per box', flat.length, 3)

// ---- a whole plan --------------------------------------------------------
const lines = [
  { species: 'COD', grade: 'Sprag (2)', day: 6, boxes: 5 },
  { species: 'COD', grade: 'Sprag (2)', day: 5, boxes: 2 },
  { species: 'HADDOCK', grade: 'M Metro (4)', day: 6, boxes: 167 },
  { species: 'HADDOCK', grade: 'Metro (3)', day: 6, boxes: 67 },
  { species: 'BLACK', grade: 'Sma (4a)', day: 4, boxes: 38 },
  { species: 'HAKE', grade: 'Sel (2)', day: 5, boxes: 6 },
]
const plan = planLayout(lines)
const placed = [...plan.rows.top, ...plan.rows.bottom]

eq('every box is on the market',
  placed.reduce((a, s) => a + s.boxes, 0), lines.reduce((a, l) => a + l.boxes, 0))
eq('no stack is over its height',
  placed.every((s) => s.boxes <= s.height), true)
eq('tiers hold what they should',
  plan.byTier.every((t) => t.top.length <= TOP_ROW && t.bottom.length <= BOTTOM_ROW), true)
eq('every footprint lands in a tier',
  plan.byTier.reduce((a, t) => a + t.top.length + t.bottom.length, 0), plan.footprints)

// A species must not be broken across the two rows — except the flats.
const bandsOf = (sp) => new Set([
  ...plan.rows.top.filter((s) => s.species === sp).map(() => 'top'),
  ...plan.rows.bottom.filter((s) => s.species === sp).map(() => 'bottom'),
])
eq('cod stays in one row', bandsOf('COD').size <= 1, true)
eq('haddock stays in one row', bandsOf('HADDOCK').size <= 1, true)
eq('black stays in one row', bandsOf('BLACK').size <= 1, true)

// Day order within a grade must run high to low.
const mmDays = placed.filter((s) => s.grade === 'M Metro (4)').flatMap((s) => s.parts.map((p) => p.day))
eq('day tags run high to low', mmDays, [...mmDays].sort((a, b) => b - a))

eq('the rule of thumb is reported alongside', typeof plan.ruleOfThumb, 'number')

// An empty tally must not throw.
const none = planLayout([])
eq('an empty tally is handled', none.tiers, 0)

/* ---- spare space goes to the dear fish -------------------------------- *
 * "Can not go higher, but can go lower." Heights are a ceiling, and the
 * valuable grades are favoured low — so leftover footprints inside the tiers
 * already being paid for should end up under good fish, not left as gaps.
 *
 * The comparison is against the same tally laid at ceiling heights throughout
 * (`drop: false`), which is what the allocator used to do. */
const tall = planLayout(lines, { drop: false })

eq('lowering never costs a tier', plan.tiers <= tall.tiers, true)
eq('lowering uses space rather than leaving it', plan.footprints >= tall.footprints, true)
eq('and the spare shrinks', plan.spare <= tall.spare, true)
eq('nothing is laid higher than its ceiling', placed.every((s) => s.height <= s.max), true)
eq('the boxes are all still there after lowering',
  placed.reduce((a, s) => a + s.boxes, 0), tall.totalBoxes)
eq('what was lowered is reported', Array.isArray(plan.lowered), true)
eq('a lowered grade really is under its ceiling',
  plan.lowered.every((l) => l.to < l.from && l.to >= 1), true)

// Value order, from Audacious's own sales: cod (£5.94/kg) is dropped before
// black (£2.05) which is dropped before whiting (£1.72). A grade only gets a
// second level once the dearer ones have had their first.
{
  const room = [
    { species: 'COD', grade: 'Baby (5a)', day: 1, boxes: 4, seq: 1 },
    { species: 'BLACK', grade: 'Med (2)', day: 1, boxes: 4, seq: 2 },
    { species: 'WHITING', grade: 'Med (1b)', day: 1, boxes: 4, seq: 3 },
  ]
  const p = planLayout(room)
  // 12 boxes, all 2 high — 6 footprints in a tier that holds 47. Everything
  // affordable, so everything goes flat.
  eq('with room to spare, all three lie flat', p.lowered.length, 3)
  eq('and the dearest is named first', p.lowered[0].species, 'COD')

  // Now starve it: one spare footprint buys exactly one drop, and the cod
  // must be the fish that gets it.
  const heights = solveDrops(
    room.map((l) => ({ key: l.species, species: l.species, boxes: l.boxes, seq: l.seq, max: 2, value: valueOf(l.species) })),
    2)
  eq('a tight budget goes to the cod', heights.get('COD'), 1)
  eq('and not to the whiting', heights.get('WHITING'), 2)
}

// A grade at height 1 already cannot be lowered, and must not loop forever.
{
  const flatOnly = [{ species: 'MONKS', grade: 'Med', day: 1, boxes: 9, seq: 0 }]
  const p = planLayout(flatOnly)
  eq('a flat grade has nothing to lower', p.lowered.length, 0)
  eq('and still gets its footprints', p.footprints, 9)
}

/* ---- value is per GRADE, not per species ------------------------------ *
 * The correction David made on the market floor, and the sales notes agree
 * with him: big haddock beats every grade of black, and only the M Metro
 * falls below it. A species average (haddock 2.02, black 2.05) gets this
 * exactly backwards, which is what shipped first. */
eq('a code comes off the tally grade', gradeBand('Good Seed (1d)'), 1)
eq('as does a U9', gradeBand('Large (U9a)'), 'U9')
eq('and a plain grade has none', gradeBand('Tusk'), null)

eq('big haddock beats the best black',
  valueOf('HADDOCK', 'XL (1a)') > valueOf('BLACK', 'Med (2)'), true)
eq('so does the seed haddock',
  valueOf('HADDOCK', 'Seed (2a)') > valueOf('BLACK', 'Large (1)'), true)
eq('but M Metro does not',
  valueOf('HADDOCK', 'M Metro (4)') < valueOf('BLACK', 'Sma (4a)'), true)
eq('and a grade beats the smaller grade of its own species',
  valueOf('COD', 'Med (3)') > valueOf('COD', 'Baby (5a)'), true)
eq('an unpriced fish still gets a figure', typeof valueOf('SQUID', 'Large (1)'), 'number')

/* ---- the chalk sheet --------------------------------------------------- */
{
  const st = (species, grade, days, boxes = 1) =>
    ({ species, grade, auction: 'x', height: 2, max: 2, boxes, parts: days.map((d) => ({ day: d, boxes: 1 })) })

  const runs = runsOf([
    st('COD', 'Large (1b)', [6]), st('COD', 'Large (1b)', [6]),   // merge
    st('COD', 'Large (1b)', [5]),                                  // new day
    st('COD', 'Sprag (2)', [5]),                                   // new grade
    st('HADDOCK', 'XL (1a)', [5]),                                 // new species
  ])
  eq('consecutive stacks of the same fish and tag are one block', runs.length, 4)
  eq('and the block carries both footprints', runs[0].footprints, 2)
  eq('a new day starts a block', runs[1].newDay, true)
  eq('a new grade is marked', runs[2].newGrade, true)
  eq('a new species is marked', runs[3].newSpecies, true)
  // A new grade already carries the heavier mark; flagging the day as well
  // fired on 287 of 297 blocks on a real trip and buried the species rule.
  eq('a new grade does not also count as a new day', runs[2].newDay, false)
  eq('every footprint survives the grouping',
    runs.reduce((s, r) => s + r.footprints, 0), 5)

  // Ten tiers to a page — beyond that the columns are too narrow to write in.
  const fakePlan = { byTier: Array.from({ length: 23 }, (_, i) => ({ tier: i + 1, top: [], bottom: [] })) }
  const pages = sheetPages(fakePlan, 10)
  eq('tiers are cut into pages of ten', pages.map((p) => p.columns.length), [10, 10, 3])
  eq('and the pages are numbered by tier', [pages[0].from, pages[0].to, pages[2].from], [1, 10, 21])

  // No two TOUCHING blocks of different fish may share a colour. Repeats
  // elsewhere on the floor are fine and expected — the palette is only six.
  const real = planLayout(lines)
  const rp = sheetPages(real, 10)
  const col = assignColours(rp)
  let clash = 0
  for (const p of rp) for (const c of p.columns) for (const row of [c.top, c.bottom]) {
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1], b = row[i]
      if (a.species === b.species && a.grade === b.grade) continue
      if (col.styleFor(a.species, a.grade).fill === col.styleFor(b.species, b.grade).fill) clash++
    }
  }
  eq('no two touching blocks of different fish share a colour', clash, 0)
  eq('and the palette is actually spread, not all one hue',
    new Set(col.species.map((s) => col.styleFor(s, '').hue)).size >= 4, true)

  eq('a grade name drops its code', gradeName('Good Seed (1d)'), 'Good Seed')
  eq('and the code is available on its own', gradeCode('Good Seed (1d)'), '1d')
  eq('a species is shortened to fit a column', shortSpecies('HADDOCK'), 'HAD')
}

/* ---- the rules are settings, not law --------------------------------- *
 * The market moves species between clocks. That used to be a code change and
 * a deploy for something the skipper knows the day it happens. */
{
  eq('nothing stored behaves exactly as the defaults',
    [resolveRules(null).clockFor('COD'), resolveRules(null).maxHeight('HADDOCK', 'M Metro (4)')],
    [auctionFor('COD'), maxHeight('HADDOCK', 'M Metro (4)')])

  // Changing one thing must not freeze a copy of everything else — a fleet
  // that moves haddock still gets later corrections to the rest.
  const moved = resolveRules({ speciesClock: { HADDOCK: 'rough' } })
  eq('a moved species goes where it is told', moved.clockFor('HADDOCK'), 'rough')
  eq('and the untouched ones keep the shipped default', moved.clockFor('WHITING'), 'hadwhit')
  eq('as do the heights', moved.maxHeight('BLACK', 'Sma (4a)'), 4)

  const taller = resolveRules({ heights: { COD: { 1: 2, '*': 3 } } })
  eq('a changed height is used', taller.maxHeight('COD', 'Large (1b)'), 2)
  eq('and its species default with it', taller.maxHeight('COD', 'Tusky'), 3)
  eq('while another species is untouched', taller.maxHeight('HADDOCK', 'Metro (3)'), 3)

  // The clocks themselves are editable, including the order and which one may
  // be broken across the two rows.
  const five = resolveRules({
    clocks: [
      { id: 'flats', n: 1, label: 'Flats', splitRows: true },
      { id: 'cod', n: 2, label: 'Cod' },
      { id: 'hadwhit', n: 3, label: 'Had/Whg' },
      { id: 'rough', n: 4, label: 'Rough' },
      { id: 'shell', n: 5, label: 'Shellfish', splitRows: false },
    ],
    speciesClock: { SQUID: 'shell' },
  })
  eq('clocks run in the order given', five.clocks.map((c) => c.id)[0], 'flats')
  eq('a new clock can be added', five.clockFor('SQUID'), 'shell')
  eq('and told whether it may split rows', [five.canSplitRows('flats'), five.canSplitRows('cod')], [true, false])

  // An unfiled fish must still get onto the market, on the catch-all clock,
  // and must be NAMED — quietly sending it to the wrong auction is the failure.
  eq('an unfiled fish falls to rough, not to whichever clock is last',
    resolveRules(null).clockFor('OCTOPUS'), 'rough')
  const odd = planLayout([
    { species: 'COD', grade: 'Large (1b)', day: 1, boxes: 4, seq: 0 },
    { species: 'OCTOPUS', grade: 'Med (2)', day: 1, boxes: 3, seq: 1 },
  ])
  eq('and it is named on the plan', odd.unfiled, ['OCTOPUS'])
  eq('with a warning that says where it went',
    odd.warnings.some((w) => w.includes('OCTOPUS') && w.includes('Rough')), true)
  eq('but it is still laid out', odd.rows.top.length + odd.rows.bottom.length > 0, true)
  eq('a fully filed tally reports nothing unfiled', planLayout(lines).unfiled, [])

  // The whole point: a different rule set gives a different plan.
  const flat = planLayout(lines, { rules: resolveRules({ heights: { HADDOCK: { '*': 1 } } }) })
  eq('flattening a species costs tiers', flat.tiers > planLayout(lines).tiers, true)
}

/* ---- floors: stiff on some grades, flexible on others ------------------ *
 * "It keeps dropping chippers flat." Heights are a ceiling and the fish can
 * always go lower, but the MARKET cannot afford it: flattening 124 boxes of
 * chippers costs 62 footprints and buys nobody a better look. */
{
  const r = resolveRules(null)
  eq('a bulk haddock grade will not be laid flat', r.minHeight('HADDOCK', 'Chipper (2b)'), 2)
  eq('nor will its band-mate', r.minHeight('HADDOCK', 'Seed (2a)'), 2)
  eq('but small dear cod still may', r.minHeight('COD', 'B Baby (4)'), 1)
  eq('and a flat fish has nothing to hold up', r.minHeight('MONKS', 'Large (1)'), 1)
  eq('a floor may never sit above the ceiling',
    resolveRules({ floors: { COD: { 1: 4 } } }).minHeight('COD', 'Large (1b)'), 1)

  // The reason per-grade rules exist at all: Seed (2a) and Chipper (2b) are
  // the SAME band and the same price, so no band rule can separate them.
  eq('a band cannot tell Seed from Chipper',
    gradeBand('Seed (2a)'), gradeBand('Chipper (2b)'))
  const split = resolveRules({ gradeRules: { 'HADDOCK||Seed (2a)': { min: 1 } } })
  eq('an exact-grade rule can', [split.minHeight('HADDOCK', 'Seed (2a)'), split.minHeight('HADDOCK', 'Chipper (2b)')], [1, 2])
  eq('and it overrides the ceiling too',
    resolveRules({ gradeRules: { 'HADDOCK||Metro (3)': { max: 2 } } }).maxHeight('HADDOCK', 'Metro (3)'), 2)
  eq('pinning a grade exactly leaves it nothing to give',
    resolveRules({ gradeRules: { 'COD||B Baby (4)': { min: 2 } } }).canDrop('COD', 'B Baby (4)'), false)

  // End to end on the real trip.
  const p = planLayout(lines)
  eq('no grade is ever laid below its floor',
    [...p.rows.top, ...p.rows.bottom].every((s) => s.height >= resolveRules(null).minHeight(s.species, s.grade)), true)

  const freed = planLayout(lines, { rules: resolveRules({ floors: {} }) })
  eq('lifting every floor lets more grades drop', freed.lowered.length >= p.lowered.length, true)
  eq('and holding them all pins everything',
    planLayout(lines, { rules: resolveRules({ floors: Object.fromEntries(
      [...new Set(lines.map((l) => l.species))].map((s) => [s, { '*': 9 }])) }) }).lowered.length, 0)

  eq('what a floor held back is reported', Array.isArray(p.held), true)
  eq('and only where it actually bit', p.held.every((h) => h.at <= h.floor && h.floor > 1), true)
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
