/* FOUR YEARS OF BOARD PRICES, JOINED ONTO THE NEW GRADE CODES.
 *
 * Peterhead changed ladders on 21-10-2026 and the record is 41,696 PD rows
 * with FORTY-FOUR on the new side, so this is not a tidy-up — without the
 * bridge every Peterhead chart, day-on-day move and four-week average
 * compares a key that exists on one side of the changeover and not the other.
 *
 * David settled the mapping species by species. The checks below quote his
 * answers rather than paraphrasing them, because the next person reading this
 * cannot re-derive which old grade was which from anything the record holds.
 *
 * THE FIXTURE IS THE WHOLE RECORD, not a sample: every grade key the board
 * has ever carried, censused on the day it changed. So a key the bridge has
 * never been shown fails here instead of silently dropping out of a chart.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  LEGACY_BRIDGE, UNBRIDGED, CODE_ALIAS, BOARD_ONLY_CODES,
  seriesKey, seriesFit, codesOf, codesForLegacy, legacyForCode,
  codesWithNoHistory, unbridgedReason, isLegacyGrade, legacyKeyOf, fitAcross,
  isRoundSuffix, boardGrade,
} from './src/lib/market/legacyGrades.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const census = JSON.parse(readFileSync('./scripts/fixtures/pd-grade-census.json', 'utf8'))
const pd = (species, grade, subgrade) => ({ source: 'PD', species, grade, subgrade })
const key = (species, grade, subgrade) => seriesKey(pd(species, grade, subgrade))
const fit = (species, grade, subgrade) => seriesFit(pd(species, grade, subgrade))

/* ---- DAVID'S OWN WORDS ON HADDOCK ------------------------------------- *
 * "A3 haddock is now 2a for example. A2 is 1d. A1 is a blend of 1a, 1b &
 *  1c. A4 chipper is 2b. A4 metro is 3, A4 mini is 4"                     */
eq(codesForLegacy('Haddock', 'A3 Seed'), ['2a'], 'A3 Seed is now 2a')
eq(codesForLegacy('Haddock', 'A2 Selected'), ['1d'], 'A2 is 1d')
eq(codesForLegacy('Haddock', 'A1 Lge/Med'), ['1a', '1b', '1c'], 'A1 is a blend of 1a, 1b and 1c')
eq(codesForLegacy('Haddock', 'A4 Chipper'), ['2b'], 'A4 Chipper is 2b')
eq(codesForLegacy('Haddock', 'A4 Metro'), ['3'], 'A4 Metro is 3')

/* ---- BOTH LADDERS LAND ON ONE KEY ------------------------------------- *
 * This is the whole point: the old row and the new row meet on the same
 * string, so a four-year series does not stop on 19 October. */
eq(key('Haddock', 'A3', 'Seed'), key('Haddock', '2a', 'Seed'),
  'the Seed line is one series across the changeover')
eq(key('Haddock', 'A3', 'Seed'), '2a', 'keyed on the new code, which is what the board prints now')
eq(key('Cod', 'A2', 'Sprags'), key('Cod', '2', 'Sprag'), 'and so is the cod Sprag line')

/* A COLLAPSED LINE KEEPS ITS OWN KEY. The old A1 is ONE figure covering
   three grades, so all four rows meet on the group — which says in the key
   itself that the figure before 21-10 is a blend. */
for (const c of ['1a', '1b', '1c']) {
  eq(key('Haddock', c, null), '1a+1b+1c', `new haddock ${c} rolls onto the group`)
  eq(key('Haddock', 'A1', 'Lge/Med'), key('Haddock', c, null), `and the old A1 meets it at ${c}`)
}
eq(fit('Haddock', 'A1', 'Lge/Med'), 'group', 'and it is reported as a blend, never as a grade')
eq(fit('Haddock', 'A3', 'Seed'), 'exact', 'where a line maps one for one, it says so')

/* ---- THE FOUR ANSWERS HE GAVE, ONE CHECK EACH ------------------------- */

/* COD: "A1 = 1a+1b+1c, A5 = 5a+5b" — the old board had nothing above A1 or
   below A5, so the big cod and Robbie had to sell under those. */
eq(codesForLegacy('Cod', 'A1 Large'), ['1a', '1b', '1c'], 'cod A1 covered 2 Fish, 3 Fish and Large')
eq(codesForLegacy('Cod', 'A5 Small'), ['5a', '5b'], 'and A5 covered Baby and Robbie')
eq(['A2 Sprags', 'A3 Medium', 'A4 Selected'].map(k => codesForLegacy('Cod', k)),
  [['2'], ['3'], ['4']], 'the middle of the cod ladder is one for one')

/* SAITHE AND MONKS gained their detail at the BOTTOM, not the top, so it is
   the bottom grade that absorbs — the mirror image of haddock. */
eq(codesForLegacy('Saithe', 'A4'), ['4a', '4b', '4c'], 'Coley A4 covered Sma, X Sma and XX Sma')
eq(codesForLegacy('Monkfish', 'A5'), ['5a', '5b'], 'Monks A5 covered Frogs and X Small')
eq(codesForLegacy('Saithe', 'A1'), ['1'], 'and the top of both is one for one')
eq(codesForLegacy('Monkfish', 'A1'), ['1'], 'monks too')

/* HAKE, LEMONS and PLAICE gained theirs at the TOP, like haddock. */
eq(codesForLegacy('Hake', 'A1'), ['1a', '1b', '1c'], 'hake A1 covered X Lrg, Large and Med')
eq(codesForLegacy('Lemon', 'A1'), ['1a', '1b'], 'lemons A1 covered X Large and Large')
eq(codesForLegacy('Plaice', 'A1'), ['1a', '1b'], 'plaice A1 the same')
eq(codesForLegacy('Lemon', 'A3'), ['3a', '3b'], 'and lemons split at the bottom as well')
eq(['A2', 'A3', 'A4', 'A5'].map(k => codesForLegacy('Hake', k)),
  [['2'], ['3'], ['4'], ['5']], 'the rest of the hake ladder maps straight down')

/* THE U9 SPECIES: one line on the old board, two on the new. */
for (const s of ['Brill', 'Witch', 'Halibut', 'Turbot', 'Tusk']) {
  eq(codesForLegacy(s, 'U9'), ['U9a', 'U9b'], `${s} U9 covered both sizes`)
  eq(fit(s, 'U9', null), 'group', `and ${s} is reported as a blend`)
}
eq(codesForLegacy('Catfish', 'U9 Scottish'), ['U9a', 'U9b'],
  'catfish carries a subgrade on the old board and still joins')

/* ---- MEGRIM: THE PREMISE WAS WRONG AND THE TABLE CORRECTED IT --------- *
 * The question put to David grouped megrim with the top-split species, on
 * the strength of the board printing "1a Large" on 21-10. The crew grading
 * table says megrim runs 1, 2, 3, 4a, 4b — its extra detail is at the
 * BOTTOM, and there is no 1b at all. An answer must not be applied to a
 * premise that turned out false, so megrim is bridged the way the table
 * reads, and the one code the two documents disagree on is aliased rather
 * than hidden. */
eq(codesOf('Megrim'), ['1', '2', '3', '4a', '4b'], 'the grading table gives megrim five codes')
eq(codesForLegacy('Megrim', 'A4'), ['4a', '4b'], 'so it is megrim A4 that absorbs, not A1')
eq(codesForLegacy('Megrim', 'A1'), ['1'], 'and A1 is one for one')
eq(CODE_ALIAS.Megrim['1a'], '1', 'the board prints 1a where the table prints 1')
eq(key('Megrim', '1a', 'Large'), key('Megrim', 'A1', null),
  'so the board row still joins four years of top-grade megrim')

/* ---- WHAT IS NOT JOINED IS NAMED ------------------------------------- *
 * A wrong join looks exactly like a real price move, so a gap that says so
 * is worth more than a series stitched onto the nearest grade. */
eq(key('Haddock', 'A4', null), null, 'a bare A4 could be any of three lines')
ok(/82 of those days/.test(unbridgedReason('Haddock', 'A4', null)),
  'and the reason is measured, not asserted — it shares a day with a named A4')

/* ---- ROUND IS A SUFFIX, AND THE SAME CODE CAN CARRY BOTH ------------- *
 * David, Oct 2026: *"a4 round is now 4 round, if a boat lands metros (3)
 * round it would be 3 round."* So haddock 4 is Mini Metro gutted AND round,
 * at two very different prices — £1.93 against £0.50-0.90 — and keyed on the
 * code alone the board would have averaged them into one line the first time
 * a round one sold, with nothing saying so. */
eq(key('Haddock', 'A4', 'Round'), '4 Round', 'old A4 Round joins the round-suffixed key')
eq(key('Haddock', '4', 'Round'), '4 Round', 'and so does a round line on the new board')
eq(key('Haddock', '4', 'Mini Metro'), '4', 'while gutted Mini Metro keeps the bare code')
ok(key('Haddock', '4', 'Round') !== key('Haddock', '4', 'Mini Metro'),
  'so the two never meet — they are different fish at the same size')
eq(fit('Haddock', 'A4', 'Round'), 'exact', 'and the join is one for one')
eq(unbridgedReason('Haddock', 'A4', 'Round'), null, 'nothing of it is left unjoined')
/* A ROUND LINE HIGHER UP THE LADDER is something the board has never priced —
   only the bottom grades are landed round, and the old board carried Round on
   A4 and nowhere else. */
eq(fit('Haddock', '2b', 'Round'), 'newOnly', 'a round Chipper would be new to the board')
eq(key('Haddock', '2b', 'Round'), '2b Round', 'and keyed apart from gutted Chipper')

/* WHITING IS THE EXCEPTION, which is why this takes the species. Its crew
   table NAMES the bottom two bands Round and S Round, with weights — so a
   "Round" there is the band's own name and must NOT be read as a suffix, or
   the line would key itself away from its own four years. */
ok(!isRoundSuffix('Whiting', '3', 'Round'), 'whiting 3 is named Round; it is not a suffix')
ok(!isRoundSuffix('Whiting', '4', 'S Round'), 'nor is S Round on whiting 4')
ok(isRoundSuffix('Haddock', '4', 'Round'), 'but on haddock it is')
eq(boardGrade('Whiting', '3', 'Round'), '3', 'so whiting keeps its bare code')
eq(boardGrade('Haddock', '4', 'Round'), '4 Round', 'and haddock takes the suffix')
eq(key('Whiting', '3', 'Round'), key('Whiting', 'A4', null),
  'and whiting 3 still joins the four years of A4 behind it')

/* ---- WHITING GOES ACROSS ONE FOR ONE --------------------------------- *
 * It read as unjoinable until David said what Round is: ungutted, the same
 * as haddock Round. The grading table then settles it, because whiting's five
 * bands run straight down with no gap — so ROUND and S ROUND are SIZE bands
 * at the foot of the ladder, not a presentation cutting across it. */
eq(['A1', 'A2', 'A3', 'A4', 'A4 Round'].map((k) => codesForLegacy('Whiting', k)),
  [['1a'], ['1b'], ['2'], ['3'], ['4']], 'five old whiting lines onto five new')
eq(key('Whiting', 'A4', 'Round'), key('Whiting', '4', 'S Round'),
  'and the two Round names meet at the foot of the ladder')
eq(fit('Whiting', 'A4', 'Round'), 'exact', 'one for one, so nothing is blended')
eq(codesWithNoHistory('Whiting'), [], 'every whiting code now has four years behind it')
eq(unbridgedReason('Whiting', 'A2', null), null, 'and nothing of whiting is left unjoined')

/* THE B-LADDER IS LEGACY, AND CALLING IT NEW WAS A REAL FAULT.
   Matched on A only, megrim B4 — 167 rows from 2022 — fell through as though
   it were a grading-table code, so a species that HAS a bridge described a
   2022 grade as one the old board never printed. */
ok(isLegacyGrade('B4'), 'a B-grade is an old-board grade')
eq(fit('Megrim', 'B4', null), 'unbridged', 'megrim B4 is unjoined, NOT newOnly')
ok(/no B code at all/.test(unbridgedReason('Megrim', 'B4', null)), 'and the reason says why')

/* ---- A CODE THE OLD BOARD NEVER PRINTED SAYS SO ---------------------- *
 * Haddock Mini Metro is the one that matters. Peterhead printed ONE Metro
 * row and the boat graded two off it, so code 4 has no board history at all
 * before 21-10 — which is a short series, not a broken one. */
eq(codesWithNoHistory('Haddock'), ['4'], 'Mini Metro is the only haddock code with no past')
eq(fit('Haddock', '4', 'Mini Metro'), 'newOnly', 'and it is reported as new rather than joined')
eq(key('Haddock', '4', 'Mini Metro'), '4', 'keyed on itself, so its series simply starts late')
eq(codesWithNoHistory('Skate'), ['1', '2', '4'], 'the board only ever priced A3 skate')
/* AND A CODE THE TABLE DOES NOT LIST IS NOT "NEW", it is unknown. The
   Hadd/Round line is the one we know is coming, and calling it new would
   announce 754 rows of history as a grade the board had never priced. */
eq(fit('Haddock', '7', 'Round'), 'unbridged',
  'a haddock code off the grading table is unknown, not new')
eq(fit('Haddock', '4', 'Mini Metro'), 'newOnly',
  'while a code the table DOES list, with no old line, is genuinely new')
for (const s of ['Cod', 'Hake', 'Lemon', 'Plaice', 'Saithe', 'Monkfish', 'Ling', 'Pollack', 'Megrim'])
  eq(codesWithNoHistory(s), [], `every ${s} code has four years behind it`)

/* ---- A WARNING ONLY WHERE THE COMPARISON ACTUALLY CROSSES ------------ *
 * `seriesFit` describes the LINE; `fitAcross` describes the COMPARISON, and
 * conflating them put "these compare against the old board" on a September
 * board whose every row was the old board. A warning that fires on the
 * ordinary case stops being read — the rule this repo keeps relearning. */
{
  const old = (g, sg, d) => ({ source: 'PD', species: 'Haddock', grade: g, subgrade: sg, price_date: d })
  const neu = (g, d) => ({ source: 'PD', species: 'Haddock', grade: g, price_date: d })
  const legacyOnly = [old('A1', 'Lge/Med', '2026-09-01'), old('A1', 'Lge/Med', '2026-09-07')]

  eq(seriesFit(old('A1', 'Lge/Med', '2026-09-07')), 'group',
    'the A1 LINE is a blend of three codes, always')
  eq(fitAcross(old('A1', 'Lge/Med', '2026-09-07'), legacyOnly), 'exact',
    'but comparing it with yesterday crosses nothing, so nothing is said')
  eq(fitAcross(neu('1b', '2026-10-21'), [...legacyOnly, neu('1b', '2026-10-21')]), 'group',
    'a new code measured against old-ladder history does cross, and says so')
  eq(fitAcross(neu('1b', '2026-10-21'), [neu('1b', '2026-10-21')]), 'exact',
    'and a species that has only ever been on codes has crossed nothing')
  /* The history must be EARLIER. An old row filed after the changeover — a
     late correction to a September board — is not something a 21 October
     figure was compared against. */
  eq(fitAcross(neu('1b', '2026-10-21'), [old('A1', 'Lge/Med', '2026-10-22')]), 'exact',
    'old rows dated after the line are not history for it')
  eq(fitAcross(null, []), 'exact', 'and no row raises nothing')
  eq(fitAcross(neu('4', '2026-10-21'), legacyOnly), 'newOnly',
    'Mini Metro still reports that the board never priced it before')
}

/* ---- DENMARK IS NOT TOUCHED ------------------------------------------ *
 * U9 is on BOTH boards, so a bridge that ignored the source would read
 * Danish witch as Peterhead witch and average two markets into one line. */
eq(seriesKey({ source: 'DK', species: 'Witch', grade: 'U9' }), 'U9', 'a Danish U9 stays U9')
eq(seriesKey({ source: 'DK', species: 'Cod', grade: 'A1' }), 'A1', 'and a Danish A1 stays A1')
ok(seriesKey({ source: 'DK', species: 'Cod', grade: 'A1' }) !== key('Cod', 'A1', 'Large'),
  'so the two markets can never meet on one key')
eq(seriesFit({ source: 'DK', species: 'Cod', grade: 'A1' }), 'exact', 'and DK is never called a blend')

/* ---- EVERY KEY THE RECORD HOLDS IS ACCOUNTED FOR --------------------- *
 * The check that makes the rest safe. A key nobody has decided about must
 * fail here rather than vanish out of a chart.  */
{
  const unknown = [], noReason = []
  let rows = 0, joined = 0, unjoined = 0
  for (const r of census.legacy) {
    rows += r.n
    const k = legacyKeyOf(r.grade, r.subgrade)
    const codes = codesForLegacy(r.species, k)
    const reason = UNBRIDGED[`${r.species}|${k}`]
    if (codes) { joined += r.n; if (reason) unknown.push(`${r.species} ${k} is both joined and unbridged`) }
    else if (reason) unjoined += r.n
    else unknown.push(`${r.species} ${k} (${r.n} rows)`)
    if (!codes && !reason) noReason.push(`${r.species} ${k}`)
  }
  eq(unknown, [], 'every legacy key on the record is either joined or has a reason it is not')
  eq(noReason, [], 'and nothing is dropped without one')
  eq(census.legacy.length, 58, 'fifty-eight grade keys in four years of Peterhead boards')
  eq(rows, 39774, 'carrying 39,774 rows between them')
  eq(unjoined, 313, '313 rows are not joined — a bare haddock A4 and megrim B4')
  eq(joined, rows - unjoined, 'and the rest are')
  ok(unjoined / rows < 0.01, 'which is 0.8% of the graded Peterhead record, down from 10.2%')
}

/* EVERY CODE THE BOARD HAS PRINTED IS KNOWN TO THE GRADING TABLE, or is an
   explicit alias. This is what makes the megrim alias safe: if Don's sheet
   ever carries a real megrim 1b, it fails here instead of joining onto the
   wrong four years. */
{
  const strangers = []
  for (const r of census.codes) {
    const codes = codesOf(r.species)
    if (!codes) { strangers.push(`${r.species} has no code list at all`); continue }
    const aliased = CODE_ALIAS[r.species] && CODE_ALIAS[r.species][r.grade]
    if (!codes.includes(r.grade) && !aliased) strangers.push(`${r.species} ${r.grade}`)
  }
  eq(strangers, [], 'no code on the board is unknown to the grading table')
  ok(BOARD_ONLY_CODES.Squid.length === 6,
    'squid is graded by LENGTH so the table publishes no bands, but the board prints the sizes')
  eq(codesOf('Halibut'), ['U9a', 'U9b'], 'halibut has board codes and no published band')
}

/* ---- THE BRIDGE IS NOT A SECOND COPY OF THE GRADING TABLE ------------ *
 * It imports PD_GRADES rather than keeping its own list of codes, so a code
 * can never be bridged to one the table does not have. */
{
  const bad = []
  for (const [species, map] of Object.entries(LEGACY_BRIDGE)) {
    const codes = codesOf(species) || []
    for (const [k, cs] of Object.entries(map))
      /* A ROUND SUFFIX IS VALID WHERE ITS SIZE CODE IS. The check stays
         strict on the code itself — "9 Round" would still fail. */
      for (const c of cs) if (!codes.includes(c.replace(/ Round$/, ''))) bad.push(`${species} ${k} -> ${c}`)
  }
  eq(bad, [], 'every code the bridge names exists on the grading table')
}

/* A code is claimed by at most ONE legacy line, or a row would join two
   series at once and be counted twice. */
{
  const dup = []
  for (const [species, map] of Object.entries(LEGACY_BRIDGE)) {
    const seen = new Map()
    for (const [k, cs] of Object.entries(map)) for (const c of cs) {
      if (seen.has(c)) dup.push(`${species} ${c}: ${seen.get(c)} and ${k}`)
      seen.set(c, k)
    }
  }
  eq(dup, [], 'no code is claimed by two legacy lines')
}

/* ---- BLANK IS NOT A GRADE -------------------------------------------- */
eq(key('Mackerel', '', null), null, 'the old board never graded mackerel, and nought is not a grade')
eq(seriesKey(null), null, 'and no row is no key')
eq(fit('Mackerel', '', null), 'unbridged', 'an ungraded row is not joined to anything')

console.log(`legacy grades: ${n} checks passed`)
