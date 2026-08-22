/* The buyers' catalogue.
 *
 * Buyers are complaining the auction is not clear: the market staff catalogue
 * it, and it is hard to keep track of what has been sold, so a buyer cannot
 * tell whether the lot coming up is day 5 fish or day 1.
 *
 * THE FRESHEST DAY SELLS AS A+, EVERYTHING ELSE AS A. That is the whole reason
 * the day matters to a buyer, and getting it backwards would put A+ on the
 * OLDEST fish on every sheet the market hands out — which is why it is a
 * parameter and not my reading of it.
 */
import { buildCatalogue, freshestDayOf, tagFor, TAG_COLOURS, freshestNote } from './src/lib/market/catalogue.js'
import { resolveRules } from './src/lib/market/layoutRules.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const RULES = resolveRules(null)
const L = (species, grade, day, boxes, seq, size = null) =>
  ({ species, grade, day, boxes, seq, size, boxKg: '30kg' })

// ---- the tag colours --------------------------------------------------------
/* The MARKET'S own scheme, off the tally workbook's Tag Colours tab — not the
 * chalk sheet's DAY_INK, which is brand colour for the boat's own marking. A
 * buyer is looking at the tag stapled to the box. */
eq('ten days are tagged', TAG_COLOURS.length, 10)
eq('day 1 is black', tagFor(1).name, 'Black')
eq('day 5 is green', tagFor(5).name, 'Green')
eq('day 10 is white', tagFor(10).name, 'White')
// White and yellow tags need dark ink or the sheet is unreadable.
eq('a pale tag takes dark ink', tagFor(10).ink, '#1B1B1B')
eq('a dark tag takes light ink', tagFor(1).ink, '#FFFFFF')
eq('an unknown day still gets something printable', tagFor(99).name, 'Day 99')

// ---- which day is freshest --------------------------------------------------
eq('the highest day is freshest by default', freshestDayOf([1, 2, 3, 4, 5]), 5)
eq('and it does not assume the days start at one', freshestDayOf([3, 4, 7]), 7)
// The other way round, in case the market counts the other way.
eq('the lowest, if told so', freshestDayOf([1, 2, 3, 4, 5], 'low'), 1)
eq('no days at all', freshestDayOf([]), null)
eq('and null', freshestDayOf(null), null)

// ---- the catalogue -----------------------------------------------------------
{
  const lines = [
    L('COD', 'XL (1a)', 5, 12, 12, '12kg+'),
    L('COD', 'XL (1a)', 4, 8, 12, '12kg+'),
    L('COD', 'XL (1a)', 3, 4, 12, '12kg+'),
    L('COD', 'Large (1b)', 5, 20, 13, '10-12kg'),
    L('HADDOCK', 'Med (3)', 5, 30, 40),
    L('HADDOCK', 'Med (3)', 2, 10, 40),
    L('MONKS', 'Large', 4, 6, 70),
    L('HAKE', 'Large', 5, 9, 80),
  ]
  const cat = buildCatalogue({ lines, rules: RULES })

  eq('the freshest day is found', cat.freshestDay, 5)
  eq('every box is counted', cat.totalBoxes, 99)
  eq('and the species counted', cat.speciesCount, 4)

  /* ONE SECTION PER CLOCK, in the auction's own order — 1 Cod, 2 Haddock &
   * Whiting, 3 Rough, 4 Flats — never alphabetical. */
  eq('a section per clock, in the auction’s order',
    cat.clocks.map((c) => c.clock.label), ['Cod', 'Haddock & Whiting', 'Rough', 'Flats'])
  eq('cod is on the cod clock', cat.clocks[0].species.map((s) => s.species), ['COD'])
  eq('monks are rough', cat.clocks[2].species.map((s) => s.species), ['MONKS'])
  eq('hake is flats', cat.clocks[3].species.map((s) => s.species), ['HAKE'])

  const xl = cat.clocks[0].species[0].grades[0]
  eq('the grade keeps the tally’s own order', xl.grade, 'XL (1a)')
  eq('and its size', xl.size, '12kg+')

  /* FRESHEST FIRST — the order the lots actually come up, which is what lets a
   * buyer crossing them off know what is next. */
  eq('days run freshest first', xl.rows.map((r) => r.day), [5, 4, 3])
  eq('only the freshest is A+', xl.rows.map((r) => r.mark), ['A+', 'A', 'A'])
  eq('with the tag colour on each', xl.rows.map((r) => r.tag.name), ['Green', 'Orange', 'Red'])
  eq('boxes carried through', xl.rows.map((r) => r.boxes), [12, 8, 4])
  eq('and a grade total', xl.total, 24)

  /* "IF I LET THIS GO, WHAT IS LEFT?" — the question a buyer is actually
   * asking when he crosses one off. */
  eq('what is still to come after each lot', xl.rows.map((r) => r.after), [12, 4, 0])

  // A grade landed on one day only is still A+ and still has a row.
  const large = cat.clocks[0].species[0].grades[1]
  eq('a single-day grade', large.rows.map((r) => [r.day, r.mark]), [[5, 'A+']])

  // A species landed on a day that is not the freshest has no A+ at all —
  // which is right: there is no fresher fish of it on the floor.
  const monk = cat.clocks[2].species[0].grades[0]
  eq('a species with none of the freshest day', monk.rows.map((r) => r.mark), ['A'])
}

// ---- the other way round -----------------------------------------------------
/* If the market counts the other way, A+ has to follow. Getting this backwards
 * would put A+ on the oldest fish on every sheet handed out. */
{
  const lines = [L('COD', 'XL (1a)', 1, 5, 12), L('COD', 'XL (1a)', 4, 7, 12)]
  const low = buildCatalogue({ lines, rules: RULES, freshest: 'low' })
  eq('the lowest day is freshest when told so', low.freshestDay, 1)
  eq('days run that way too', low.clocks[0].species[0].grades[0].rows.map((r) => r.day), [1, 4])
  eq('and A+ follows', low.clocks[0].species[0].grades[0].rows.map((r) => r.mark), ['A+', 'A'])
}

// ---- only what is aboard ------------------------------------------------------
/* A catalogue listing every grade the market recognises is a WORSE document
 * than none: the buyer has to read past the fish that is not there. */
{
  const cat = buildCatalogue({ lines: [L('COD', 'XL (1a)', 5, 3, 12)], rules: RULES })
  eq('one species aboard, one section', cat.clocks.length, 1)
  eq('and one grade in it', cat.clocks[0].species[0].grades.length, 1)
  // A zero-box line never reaches here, but must not slip through if it does.
  eq('a zero-box line is not catalogued',
    buildCatalogue({ lines: [L('COD', 'XL (1a)', 5, 0, 12)], rules: RULES }).clocks.length, 0)
  eq('nothing at all is handled', buildCatalogue({ lines: [], rules: RULES }).totalBoxes, 0)
  eq('and null', buildCatalogue({ lines: null, rules: RULES }).clocks.length, 0)
}

// ---- a species nobody has filed ------------------------------------------------
/* It goes on the sheet anyway and is NAMED — quietly leaving a fish off a
 * catalogue the buyers are working from is worse than an untidy heading. */
{
  const cat = buildCatalogue({ lines: [L('SCALLOPS', 'Whole', 5, 4, 90)], rules: RULES })
  eq('an unfiled species is not lost', cat.unfiled.map((s) => s.species), ['SCALLOPS'])
  eq('and its boxes still count', cat.totalBoxes, 4)
}

// ---- the line the sheet leads with ---------------------------------------------
{
  const cat = buildCatalogue({ lines: [L('COD', 'XL (1a)', 5, 3, 12)], rules: RULES })
  eq('the rule is spelt out', freshestNote(cat),
    'Day 5 (Green) is the freshest and sells as A+. Every other day is A.')
  eq('and says so when there are no tags',
    freshestNote(buildCatalogue({ lines: [], rules: RULES })), 'No day tags on this tally.')
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
