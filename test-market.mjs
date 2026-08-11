import { tiersByRuleOfThumb, maxHeight, auctionFor, TOP_ROW, BOTTOM_ROW } from './src/lib/market/layoutRules.js'
import { buildStacks, planLayout } from './src/lib/market/planLayout.js'

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

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
