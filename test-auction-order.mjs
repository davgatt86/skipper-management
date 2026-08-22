/* THE ORDER THE MARKET SELLS IN — measured off Peterhead's own transaction
 * export, and applied to both the chalk sheet and the buyers' catalogue.
 *
 *   node test-auction-order.mjs
 */
import {
  FAO_SPECIES, DEFAULT_AUCTION_ORDER, orderIndex, bySaleOrder,
  parseTransactions, mergeOrders, resolveAuctionOrder, clockOrders,
} from './src/lib/market/auctionOrder.js'
import { resolveRules } from './src/lib/market/layoutRules.js'
import { planLayout } from './src/lib/market/planLayout.js'
import { buildCatalogue } from './src/lib/market/catalogue.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const rules = resolveRules(null)

/* ---- the three live clocks ---------------------------------------------
 * David's own listing, Aug 2026: "rough will be pok, anf, lin, pol, usk, cat.
 * flats will be hke, lem, ple, lez, wit, hal, tur." Cod is a clock by itself
 * and haddock/whiting are not live yet.
 *
 * The shipped order is stored BLENDED, exactly as the export gives it, and
 * de-blended through each species' clock. This is the assertion that the one
 * stored list really does produce the three he named. */
{
  const o = clockOrders(DEFAULT_AUCTION_ORDER, rules)
  eq('cod is a clock on its own', o.cod, ['COD'])
  eq('rough sells pok, anf, lin, pol, usk, cat',
    o.rough, ['BLACK', 'MONKS', 'LING', 'LYTHE', 'TUSK', 'CAT'])
  eq('flats sell hke, lem, ple, lez, wit, hal, tur',
    o.flats, ['HAKE', 'LEMONS', 'PLAICE', 'MEGS', 'WITCH', 'HALIBUT', 'TURBOT'])
  // Not live yet, so nothing measured — and it must read as empty rather than
  // be missing, or "no order for these" looks like an oversight.
  eq('haddock and whiting have no sale order yet', o.hadwhit, [])
}

/* ---- reading the export ------------------------------------------------
 * The real file has no timestamp column: the ROW ORDER is the record. So this
 * takes first appearance and never sorts anything. */
{
  const csv = [
    ',,,,,,,Transactions per supplier,,,',
    ',,,,,,,,15/08/2026 - 22/08/2026,,',
    'Salesdate:,20/08/2026,,,,,,,,,',
    'Supplier:,AUDACIOUS - BF83,,,,,,,,,',
    'Species,,Boat,Quality,Quality,MSC,Total Full Boxes ,,,Boxweight (Kg),Buyer',
    'POK,,GUT,1 - ,A,,1,,,14.00,TOPSAIL',
    'HKE,,GUT,1a,A,MSC,1,,,30.00,SUSTAINABLE',
    'HKE,,GUT,1b,A,MSC,2,,,30.00,TOPSAIL',
    'COD,,GUT,1b,A,,4,,,30.00,A DUFF',
    'ANF,,GUT,1 - ,A+,,2,,,30.00,J SMITH',
    'Total,,,,,,,,,,',
    'AUDACIOUS - BF83,,,,,,,,,,',
    '22/08/2026,,,,,,,,,,',
  ].join('\n')
  const r = parseTransactions(csv)
  eq('the sale date and supplier come off the header',
    [r.saleDate, r.supplier], ['20/08/2026', 'AUDACIOUS - BF83'])
  eq('species come out in first-appearance order', r.order, ['BLACK', 'HAKE', 'COD', 'MONKS'])
  eq('a repeated species is not repeated in the order', r.order.length, 4)
  eq('the transaction count is the rows, not the species', r.lines, 5)
  eq('the Total and tail rows are not species', r.codes.includes('Total'), false)
  eq('nothing was unmapped', r.unmapped, [])

  eq('a file with no Species column is refused',
    !!parseTransactions('a,b,c\n1,2,3').error, true)

  /* AN UNMAPPED FAO CODE IS KEPT AND NAMED, never dropped. Dropping it would
   * silently shorten the sale order, and the first anyone would know is a fish
   * laid out in the wrong place. */
  const odd = parseTransactions([
    'Species,,Boat,Quality',
    'POK,,GUT,1 - ',
    'ZZZ,,GUT,1 - ',
  ].join('\n'))
  eq('an unknown code is kept in the order', odd.order, ['BLACK', 'ZZZ'])
  eq('and named back to the caller', odd.unmapped, ['ZZZ'])
}

/* ---- merging two sales -------------------------------------------------
 * One sale only carries what was landed that day. The 13-08 sale has no tusk
 * at all, so reading a single sale as the whole order drops every species that
 * happened not to be on the market. */
{
  const aug13 = ['BLACK', 'HAKE', 'COD', 'MONKS', 'LING', 'LYTHE', 'LEMONS', 'CAT',
    'PLAICE', 'MEGS', 'WITCH', 'HALIBUT', 'TURBOT']
  const aug20 = ['BLACK', 'HAKE', 'COD', 'MONKS', 'LING', 'LYTHE', 'LEMONS', 'TUSK', 'CAT',
    'PLAICE', 'MEGS', 'WITCH', 'HALIBUT', 'TURBOT']
  eq('merging the two real sales gives the shipped order',
    mergeOrders(aug13, aug20), DEFAULT_AUCTION_ORDER)
  eq('and the newer sale alone would have lost nothing here',
    mergeOrders(aug20), aug20)

  // A species only the OLDER sale saw keeps its place beside the neighbour it
  // was seen with, rather than being appended to the end.
  eq('an older-only species keeps its neighbours',
    mergeOrders(['A', 'X', 'B'], ['A', 'B']), ['A', 'X', 'B'])
  eq('a genuinely new species is appended, not guessed at',
    mergeOrders(['A', 'B'], ['A', 'B', 'C']), ['A', 'B', 'C'])
  eq('nothing to merge is empty, not a default', mergeOrders(), [])
}

/* ---- unmeasured species ------------------------------------------------ */
{
  const idx = orderIndex(DEFAULT_AUCTION_ORDER)
  eq('a measured species has a position', idx('HAKE'), 1)
  eq('an unmeasured one is null, not a number', idx('SQUID'), null)
  eq('case and spacing do not matter', idx(' hake '), 1)

  /* A fish nobody has a sale order for keeps the tally's own position and
   * sorts AFTER everything measured. Letting it land in the middle would make
   * the measured part look wrong. */
  const cmp = bySaleOrder(DEFAULT_AUCTION_ORDER, (s) => ({ SQUID: 0, OTHER: 1, CAT: 9 }[s] ?? 0))
  eq('measured before unmeasured', ['CAT', 'SQUID'].sort(cmp), ['CAT', 'SQUID'])
  eq('and the other way round too', ['SQUID', 'CAT'].sort(cmp), ['CAT', 'SQUID'])
  eq('two unmeasured keep the tally order', ['OTHER', 'SQUID'].sort(cmp), ['SQUID', 'OTHER'])
}

/* ---- the stored override ----------------------------------------------- */
{
  eq('no stored row behaves as the shipped order', resolveAuctionOrder(null), DEFAULT_AUCTION_ORDER)
  eq('an empty list does too', resolveAuctionOrder({ auctionOrder: [] }), DEFAULT_AUCTION_ORDER)
  eq('a stored order wins', resolveAuctionOrder({ auctionOrder: ['cat', 'ling'] }), ['CAT', 'LING'])
}

/* ---- THE SHEET AND THE CATALOGUE MUST AGREE ----------------------------
 *
 * This is the one that matters, and it is the one that caught a real bug: the
 * catalogue was handed objects by a comparator expecting species names, so it
 * silently fell back to the tally's order while the chalk sheet used the sale
 * order. Both documents rendered perfectly well and disagreed with each other
 * — a buyer reads down for his next lot and finds it three species from where
 * the fish actually is. */
{
  const lines = [
    { species: 'COD', grade: 'Large (1b)', day: 1, boxes: 40, seq: 0 },
    { species: 'HADDOCK', grade: 'Med (3)', day: 1, boxes: 90, seq: 1 },
    // deliberately in a DIFFERENT order from the auction, so the tally's own
    // order cannot accidentally agree
    { species: 'CAT', grade: 'Large', day: 1, boxes: 20, seq: 2 },
    { species: 'LYTHE', grade: 'Large', day: 1, boxes: 25, seq: 3 },
    { species: 'MONKS', grade: 'Large', day: 1, boxes: 30, seq: 4 },
    { species: 'BLACK', grade: 'Sma (4a)', day: 1, boxes: 60, seq: 5 },
    { species: 'LING', grade: 'Large', day: 1, boxes: 35, seq: 6 },
    { species: 'HALIBUT', grade: 'Large', day: 1, boxes: 8, seq: 7 },
    { species: 'MEGS', grade: 'Large', day: 1, boxes: 15, seq: 8 },
    { species: 'HAKE', grade: 'Sel (2)', day: 1, boxes: 40, seq: 9 },
    { species: 'LEMONS', grade: 'Med', day: 1, boxes: 12, seq: 10 },
  ]
  const plan = planLayout(lines, { rules })
  const cat = buildCatalogue({ lines, rules, freshest: 'high' })

  const sheetOrder = {}
  for (const list of [plan.rows.top, plan.rows.bottom])
    for (const s of list) {
      const run = (sheetOrder[s.auction] ||= [])
      if (run[run.length - 1] !== s.species) run.push(s.species)
    }

  eq('the chalk sheet lays the rough in sale order',
    sheetOrder.rough, ['BLACK', 'MONKS', 'LING', 'LYTHE', 'CAT'])
  eq('and the flats too',
    sheetOrder.flats, ['HAKE', 'LEMONS', 'MEGS', 'HALIBUT'])

  for (const cl of cat.clocks) {
    eq(`the catalogue agrees with the sheet on ${cl.clock.label}`,
      cl.species.map((s) => s.species), sheetOrder[cl.clock.id] || [])
  }

  // And grades inside a species still follow the tally, never the name —
  // "sheet follows my grades not alphabetical".
  const two = planLayout([
    { species: 'HADDOCK', grade: 'Sprag', day: 1, boxes: 10, seq: 0 },
    { species: 'HADDOCK', grade: 'Med (3)', day: 1, boxes: 10, seq: 1 },
    { species: 'HADDOCK', grade: 'Large (1)', day: 1, boxes: 10, seq: 2 },
  ], { rules })
  eq('grades inside a species still follow the tally',
    [...two.rows.top, ...two.rows.bottom].map((s) => s.grade)
      .filter((g, i, a) => g !== a[i - 1]), ['Sprag', 'Med (3)', 'Large (1)'])
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
