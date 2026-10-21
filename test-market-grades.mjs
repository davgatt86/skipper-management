/* THE PETERHEAD BOARD MOVED ONTO THE GRADING TABLE'S CODES — 21 Oct 2026.
 *
 * David: *"Don Co have updated their prices to match the grading finally!!"*
 *
 *   before   Cod A1 Large · A2 Sprags · A3 Medium · A4 Selected · A5 Small
 *   after    Cod 1a · 1b · 1c · 2 · 3 · 4 · 5a · 5b
 *
 * Measured on the real sheet BEFORE any of this was written, through the real
 * parser entry point: all 44 rows lost their grade, six took a grade code as
 * their SPECIES, and cod's eight lines came back as eight rows all called
 * "Cod" with nothing to tell them apart. The board had already been uploaded,
 * so those six invented fish were in `market_prices`.
 *
 * Positions below are VERBATIM from pdf.js's extraction of the real sheets —
 * x and y as printed — not a guessed layout. Two P&J buyer fixes in this repo
 * failed for being written blind against an assumed one.
 */
import assert from 'node:assert'
import { parseMarketFromDoc } from './src/lib/market/parseMarket.js'
import { pdSpecies, pdGuideName } from './src/lib/market/marketCanon.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

/** A pdf.js document standing in for a one-page sheet. */
function fakePdf(rows) {
  const items = []
  for (const [y, line] of rows) for (const [x, str] of line) items.push({ str, transform: [0, 0, 0, 0, x, y] })
  return { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items }) }) }
}
const TITLE = [810, [[38.3, 'PETERHEAD DAILY MARKET PRICES 21st OCTOBER 2026']]]
const HEAD = [800, [[148.1, 'LOW'], [181, 'HIGH'], [218.1, 'AVE'], [448.3, 'LOW'], [482.6, 'HIGH'], [520.4, 'AVE']]]
const find = (rs, sp, g) => rs.find(r => r.species === sp && r.grade === g)

/* ---- THE NEW LADDER PARSES, AND METRO IS NO LONGER ONE ROW ------------ */
{
  const { prices } = await parseMarketFromDoc(fakePdf([
    TITLE, HEAD,
    [747.8, [[38.3, 'Cod/Sprag'], [116.1, '2'], [152.5, '£9.66'], [181.8, '£10.43'], [215.8, '£10.24'],
             [314.5, 'Lemons/Small'], [392.8, '3a'], [451.9, '£5.96'], [488, '£7.98'], [523.7, '£6.74']]],
    [623.1, [[38.3, 'Hadd/Metro'], [116.1, '3'], [152.5, '£2.49'], [186.5, '£2.49'], [220.5, '£2.49']]],
    [612.7, [[38.3, 'Hadd/Mini Metro'], [116.1, '4'], [152.5, '£1.81'], [186.5, '£1.98'], [220.5, '£1.93']]],
  ]), 'x')

  eq(prices.length, 4, 'four rows read')
  ok(prices.every(p => p.grade), 'every row carries its grade — none did before')

  /* THE CODE IS WRITTEN AS THE GRADING TABLE WRITES IT, lowercase size
     letter, because the boat's day tally spells it the same way
     (`Chipper (2b)`, `M Metro (4)`) and the two are meant to join on it. */
  eq(find(prices, 'Cod', '2').subgrade, 'Sprag', 'the printed guide name rides along')
  eq(find(prices, 'Lemon', '3a').ave, 6.74, 'a lettered code keeps its lower case')

  /* MINI METRO IS A LINE ON THE BOARD NOW, and that retires a documented
     rule. It used to be derived by blending the single Metro row —
     Mini = (low+ave)/2, Metro = (ave+high)/2 — because the board printed one
     Metro and the boat graded two. On this day that blend gives 2.49 for
     BOTH, where the board actually prints 1.93 for Mini Metro: 29% out on
     the grade that is usually the bulk of the A4. */
  eq(find(prices, 'Haddock', '3').ave, 2.49, 'Metro is its own row')
  eq(find(prices, 'Haddock', '4').ave, 1.93, 'and Mini Metro is its own row, at its own price')
  ok(find(prices, 'Haddock', '3').ave !== find(prices, 'Haddock', '4').ave,
    'the two are different money — a blend of one row could not say so')
}

/* ---- A FISH IS NAMED ONCE AND ITS GRADES RUN ON BENEATH IT ------------ *
 * The real trap is Turbot: its FIRST row carries no prices at all, so a
 * parser that drops empty rows before reading the name would still be
 * carrying SQUID and would file turbot's £20.84 under squid. A wrong price
 * on a real fish is worse than the invented species it replaces. */
{
  const { prices } = await parseMarketFromDoc(fakePdf([
    TITLE, HEAD,
    [508.3, [[38.3, 'Catfish Scottish'], [116.1, 'U9a'],
             [314.5, 'Squid'], [392.8, 'U9a'], [451.9, '£4.52'], [488, '£4.52'], [523.7, '£4.52']]],
    [487.4, [[392.8, 'U9c'], [451.9, '£3.02'], [488, '£3.98'], [523.7, '£3.85']]],
    [435.2, [[38.3, 'Coley/Large'], [116.1, '1'], [152.5, '£3.80'], [186.5, '£4.18'], [220.5, '£4.00'],
             [314.5, 'Turbot'], [392.8, 'U9a']]],
    [424.8, [[392.8, 'U9b'], [451.9, '£12.45'], [488, '£21.65'], [523.7, '£20.84']]],
  ]), 'x')

  eq(find(prices, 'Squid', 'U9c').ave, 3.85, 'a bare grade row belongs to the fish above it')
  eq(find(prices, 'Turbot', 'U9b').ave, 20.84,
    'and the carry moved on at Turbot even though that row had no prices')
  ok(!prices.some(p => /^(U9[a-f]|[0-9][a-f]?)$/.test(p.species)),
    'no grade code is left standing as a species')
  eq(find(prices, 'Saithe', '1').ave, 4, 'the left block is unaffected by the right block’s carry')
  /* A carried row has no name of its own, so it gets no guide name —
     inventing one would put a word on the row that the board never printed. */
  eq(find(prices, 'Squid', 'U9c').subgrade, null, 'a carried row claims no guide name')
}

/* ---- AND THE OLD BOARD READS EXACTLY AS IT ALWAYS DID ----------------- *
 * Verbatim from the real sheet of 12-10-2026, the one the Unsold work used.
 * Proved separately by parsing that whole sheet before and after this change
 * and diffing: byte-identical, 49 rows. */
{
  const { prices } = await parseMarketFromDoc(fakePdf([
    TITLE, HEAD,
    [747.8, [[38.3, 'Cod/Large'], [116.1, 'A1'], [152.5, '£8.00'], [181.8, '£9.68'], [215.8, '£8.89']]],
    [623.1, [[38.3, 'Hadd Chipper'], [116.1, 'A4'], [152.5, 'Unsold'], [186.5, '£2.35'], [220.5, '£1.75']]],
    [435.2, [[314.5, 'Turbot'], [392.8, 'U9'], [451.9, '£10.00'], [488, '£16.55'], [523.7, '£12.97']]],
  ]), 'x')

  eq(find(prices, 'Cod', 'A1').subgrade, 'Large', 'the legacy A-ladder is untouched')
  eq(find(prices, 'Haddock', 'A4').subgrade, 'Chipper',
    'and the Unsold fix still holds — the word is not welded onto the name')
  eq(find(prices, 'Haddock', 'A4').unsold, true, 'the non-sale is still recorded')
  eq(find(prices, 'Haddock', 'A4').low, null, 'and no price is invented for it')
  eq(find(prices, 'Turbot', 'U9').grade, 'U9', 'a bare U9 keeps its upper case')
}

/* ---- THE GUIDE NAME IS ONLY EVER TAKEN OFF A NEW-LADDER ROW ----------- *
 * `Lythe/Pollack A3` has a slash too. Deriving a guide name from the label
 * alone gave it a subgrade of "Pollack" — noise, and a change to four years
 * of rows nobody asked for. */
{
  eq(pdGuideName('Hadd/Mini Metro'), 'Mini Metro', 'the guide name is the tail of the label')
  eq(pdGuideName('Catfish Scottish'), null, 'no slash, no guide name')
  eq(pdSpecies('Lythe/Pollack').subgrade, null,
    'and the canon layer still gives an old label no subgrade of its own')
  eq(pdSpecies('Lythe/Pollack').species, 'Pollack', 'while still resolving the fish')
}

/* ---- THE BOARD'S OWN SPELLING OF MACKEREL ----------------------------- */
{
  eq(pdSpecies('Atlantic Mackeral').species, 'Mackerel', 'their spelling resolves')
  eq(pdSpecies('Atlantic Mackerel').species, 'Mackerel', 'and so does the dictionary one')
  ok(pdSpecies('Atlantic Mackeral').known, 'and it counts as a known fish, so it can be carried')
}

/* ---- `known` IS WHAT MAKES THE CARRY SAFE ----------------------------- */
{
  ok(pdSpecies('Cod/Sprag').known, 'a fish is known')
  ok(!pdSpecies('Boxes').known, 'a volumes label is not, so it can never be carried onto a price')
  eq(pdSpecies('Boxes').species, 'Boxes', 'and it is still returned verbatim rather than dropped')
}

console.log(`market grades: ${n} checks passed`)
