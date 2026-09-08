import assert from 'node:assert'
import { createRequire } from 'node:module'
import {
  BOARD_NAME, boardNameFor, fromBoardName, PINNED, FALLBACK_EXTRAS,
  dashboardSpecies, speciesBasis,
} from './src/lib/market/boardNames.js'

const PC = createRequire(import.meta.url)('./src/lib/parse-core.cjs')

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* ---- THE BOARD AND THE NOTES DO NOT AGREE ON EVERY NAME ----------------
 * Measured over sixty days of the board against every species landed in 2026:
 * 23 match exactly, including every one that matters. Two do not, and one of
 * them is Audacious's fifth species by value — on a naive join her own boat
 * would have shown a blank price in the first week.
 */
{
  eq(boardNameFor('Lythe'), 'Pollack', 'the board calls lythe pollack')
  eq(boardNameFor('Lemon Sole'), 'Lemon', 'and lemon sole lemon')
  eq(fromBoardName('Pollack'), 'Lythe', 'and back the other way')
  eq(fromBoardName('Lemon'), 'Lemon Sole', 'both ways round')

  /* THE ONES THAT MATTER MATCH, so they must pass straight through untouched
     rather than being mapped to something. */
  for (const s of ['Cod', 'Haddock', 'Saithe', 'Ling', 'Whiting', 'Monkfish',
                   'Hake', 'Megrim', 'Witch', 'Squid', 'Blue Ling', 'Catfish']) {
    eq(boardNameFor(s), s, `${s} is the same on both`)
  }
  eq(Object.keys(BOARD_NAME).length, 2, 'and only two names actually differ')

  /* LYTHE STAYS THE APP'S NAME. The board's word is translated where the board
     is read; the app is not renamed, because LYTHE is also a grade label the
     estimator matches exactly and a species on the market clocks. */
  eq(PC.canonSpecies('POLLACK'), 'Lythe', 'a note saying pollack lands as lythe')
  eq(PC.canonSpecies('Lythe'), 'Lythe', 'and lythe stays lythe')
}

/* ---- THE THREE EVERY BOAT WATCHES -------------------------------------- */
{
  eq(PINNED, ['Cod', 'Haddock', 'Saithe'], "David's three, pinned for everyone")
  /* MEASURED, NOT CHOSEN: across the seven real fleets the species after the
     pinned three are whiting, ling and hake. */
  eq(FALLBACK_EXTRAS, ['Whiting', 'Ling', 'Hake'], 'and the fallback is what most boats land')
}

/* ---- A BOAT'S OWN TOP SIX ---------------------------------------------- */
{
  /* Audacious's real 2026 figures, in the order the database returns them. */
  const aud = [
    { species: 'Haddock', value: 3_000_000, weight: 1_200_000 },
    { species: 'Saithe', value: 1_400_000, weight: 900_000 },
    { species: 'Cod', value: 1_300_000, weight: 250_000 },
    { species: 'Monkfish', value: 700_000, weight: 120_000 },
    { species: 'Lythe', value: 300_000, weight: 60_000 },
    { species: 'Ling', value: 250_000, weight: 180_000 },
    { species: 'Whiting', value: 200_000, weight: 170_000 },
  ]
  eq(dashboardSpecies(aud, { basis: 'value' }),
     ['Cod', 'Haddock', 'Saithe', 'Monkfish', 'Lythe', 'Ling'],
     'by value: the pinned three, then her own biggest')
  eq(dashboardSpecies(aud, { basis: 'volume' }),
     ['Cod', 'Haddock', 'Saithe', 'Ling', 'Whiting', 'Monkfish'],
     'and by volume the extras change — which is what the toggle is for')

  /* THE PINNED THREE ARE NEVER DUPLICATED, and this is the ordinary case: six
     of the seven real fleets already have all three in their own top six. */
  const out = dashboardSpecies(aud)
  eq(new Set(out).size, out.length, 'no species appears twice')
  eq(out.length, 6, 'and six is six')
}

/* ---- BERYL IS THE FLEET THE PINNING DOES NOT FIT ----------------------
 * She is squid and blue ling; cod is not in her top six by volume at all. The
 * three are still pinned because they are the market everyone watches, and her
 * own three slots do the real work.
 */
{
  const beryl = [
    { species: 'Squid', value: 900_000, weight: 300_000 },
    { species: 'Blue Ling', value: 800_000, weight: 400_000 },
    { species: 'Monkfish', value: 400_000, weight: 90_000 },
  ]
  eq(dashboardSpecies(beryl, { basis: 'value' }),
     ['Cod', 'Haddock', 'Saithe', 'Squid', 'Blue Ling', 'Monkfish'],
     'the three are pinned even for a boat that barely lands them')
  const basis = speciesBasis(beryl, { basis: 'value' })
  eq(basis.filter((b) => b.from === 'own').map((b) => b.species),
     ['Squid', 'Blue Ling', 'Monkfish'], 'and her own three are marked as hers')
}

/* ---- A BOAT WITH NOTHING YET ------------------------------------------
 * She gets something true of most boats rather than a short panel, and the
 * page can say which is which — HER OWN TOP SPECIES AND A GENERAL GUESS MUST
 * NOT READ ALIKE.
 */
{
  eq(dashboardSpecies([], { basis: 'value' }),
     ['Cod', 'Haddock', 'Saithe', 'Whiting', 'Ling', 'Hake'],
     'a boat with no notes gets the measured fallback')
  const basis = speciesBasis([])
  eq(basis.filter((b) => b.from === 'pinned').length, 3, 'three pinned')
  eq(basis.filter((b) => b.from === 'typical').length, 3, 'and three marked as typical, not hers')
  eq(basis.filter((b) => b.from === 'own').length, 0, 'none claimed as her own')

  /* A boat part way there gets her own first and the fallback only for the
     room she cannot fill. */
  const few = [{ species: 'Squid', value: 5000, weight: 900 }]
  const mixed = speciesBasis(few)
  eq(mixed.find((b) => b.species === 'Squid').from, 'own', "her one species is hers")
  ok(mixed.some((b) => b.from === 'typical'), 'and the rest is filled and marked as typical')
}

/* ---- NOTHING IS INVENTED FROM NOTHING ---------------------------------- */
{
  /* A species landed with no value must not be ranked ahead of one with some,
     and a zero is not a landing. */
  eq(dashboardSpecies([{ species: 'Turbot', value: 0, weight: 0 }], { basis: 'value' }),
     ['Cod', 'Haddock', 'Saithe', 'Whiting', 'Ling', 'Hake'],
     'a species with nothing against it does not take a slot')
  eq(dashboardSpecies(null), ['Cod', 'Haddock', 'Saithe', 'Whiting', 'Ling', 'Hake'],
     'and no data at all still gives six')
  eq(dashboardSpecies([{ species: '', value: 100, weight: 100 }]).length, 6,
     'a blank name never becomes a species')
}

/* ---- SIZE IS A SETTING, and the panel stays readable ------------------- */
{
  eq(dashboardSpecies([], { size: 3 }), ['Cod', 'Haddock', 'Saithe'], 'three is the three')
  eq(dashboardSpecies([], { size: 6 }).length, 6, 'six is the default')
}

console.log('species: ' + n + ' checks passed')
