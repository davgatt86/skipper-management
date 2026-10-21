/* PETERHEAD AGAINST DENMARK, ON THE REAL BOARDS OF 21-10-2026.
 *
 * The comparison on Daily Prices matched grades on the A-NUMBER. That broke
 * outright when Peterhead moved onto grade codes — `A(\d)` finds nothing in
 * `2a`, so every species collapsed to one "All sizes" row and haddock, whose
 * tiers were spelled `A3 Seed`, dropped off the table altogether.
 *
 * It was also never the same fish. Denmark numbers cod and hake from 0, so
 * their A1 cod is 7-12 kg where Peterhead's old A1 was 10 kg and up. Both
 * markets publish their bands, so the pairing is measurable — and that is
 * what `gradeBridge.js` holds.
 *
 * The fixture is both real boards of the changeover day, so these checks are
 * against figures the markets actually printed.
 */
import assert from 'node:assert'
import { buildBoard } from './src/lib/market/marketAgg.js'
import { compareBoards, compareSpecies, canonSp } from './src/lib/market/compareBoards.js'
import { loadFixture } from './scripts/compare-boards-preview.mjs'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const rows = loadFixture()
const cmp = compareBoards(buildBoard(rows, 'PD'), buildBoard(rows, 'DK'))
const all = cmp.groups.flatMap((g) => g.rows.map((r) => ({ ...r, species: g.species })))
const find = (sp, grade) => all.find((r) => r.species === sp && r.grade === grade)

/* ---- IT PRODUCES A COMPARISON AT ALL, WHICH IS THE POINT -------------- *
 * Keyed on the A-number the new board gives nothing: no haddock row and one
 * blended line per species. */
eq(cmp.date, '2026-10-21', 'both boards are the changeover day')
eq(cmp.dkDate, '2026-10-21', 'and Denmark priced the same day')
ok(cmp.groups.length >= 9, `${cmp.groups.length} species lined up, where the A-number gave 0 graded`)
ok(all.length >= 28, `${all.length} grade rows`)
ok(all.every((r) => r.pd != null && r.dk != null), 'no row is half a comparison')
/* HADDOCK IS THE REGRESSION. Its tiers were hand-written as `A3 Seed` and
   friends, so it vanished from the table the day the board changed. */
ok(cmp.groups.some((g) => g.species === 'Haddock'), 'haddock is back on the table')

/* ---- THE SAME KILOS, NOT THE SAME GRADE NUMBER ------------------------ *
 * Peterhead Sprag is 4-7 kg and Denmark's A2 cod is 4-7 kg. The old code
 * matched PD A2 against DK A2, which is the same number and NOT the same
 * fish — Denmark's A2 cod sits a rung lower because they number from 0. */
{
  const r = find('Cod', '2 Sprag')
  eq(r.band, '4-7 kg', 'cod Sprag is 4-7 kg on the Peterhead table')
  eq(r.dkGrade, 'A2', 'and Denmark cut their A2 at exactly those kilos')
  eq(r.fit, 'exact', 'so the two prices are for the same fish')
  eq([r.pd, r.dk], [10.24, 8.4], 'the figures are the boards own')
}
{
  /* DENMARK'S A1 COD IS NOT PETERHEAD'S A1. It is 7-12 kg, which covers two
     Peterhead grades — so the comparison is against both, and says so. */
  const r = find('Cod', '1b 3 Fish + 1c Large')
  eq(r.dkGrade, 'A1', 'Denmark A1 cod covers 7-12 kg')
  eq(r.band, '7-12 kg', 'which is Peterhead 1b and 1c together')
  eq(r.fit, 'blend', 'so it is reported as a blend, not as either grade')
  eq(r.pd, (9.83 + 10.7) / 2, 'and the Peterhead figure is the mean of the two lines')
}

/* ---- A BLEND IS NEVER QUOTED AS A GRADE'S OWN PRICE ------------------- *
 * Lemon is the case that would mislead. Denmark's A1 lemon is 0.6 kg and up;
 * Peterhead cuts that into 1a (0.9+) and 1b (0.6-0.9), and only 1b sold. So
 * Denmark reading 32% dearer is partly bigger fish, not purely a better
 * price, and the row has to say so. */
{
  const r = find('Lemon', '1b Large')
  eq(r.fit, 'blend', 'Denmark A1 lemon covers a Peterhead grade that did not sell')
  ok(r.dk > r.pd, 'and reads dearer')
}
/* Where nothing is averaged on either side it is exact and may be quoted. */
for (const [sp, g] of [['Saithe', '1 Large'], ['Ling', '2 Medium'], ['Hake', '3 Small']])
  eq(find(sp, g).fit, 'exact', `${sp} ${g} is the same band on both boards`)

/* ---- BIGGEST FISH FIRST, ON THE KILOS AND NOT THE TEXT ---------------- *
 * Sorted on the band label, hake came out Selected, Pencil, Small — because
 * "1.2-2.5" sorts above "0.28-0.6" above "0.6-1.2" as a string. */
for (const g of cmp.groups) {
  const froms = g.rows.map((r) => r.from)
  eq(froms, [...froms].sort((a, b) => b - a), `${g.species} runs biggest fish first`)
}
eq(cmp.groups.find((g) => g.species === 'Hake').rows.map((r) => r.grade),
  ['2 Selected', '3 Small', '4 Pencil'], 'hake runs down the ladder, not down the alphabet')

/* ---- TODAY'S LINES ARE COMPARED, NOT THE HISTORY GROUP ---------------- *
 * `histKey` groups lemon 3a with 3b because ONE old Peterhead row covered
 * both. That is right for a four-year series and wrong here: both boards are
 * being read on the same day, so the line the board printed is the line to
 * compare. Keyed on the group, lemon Small would be labelled "3a+3b" on the
 * strength of a grade the board no longer prints. */
{
  const r = find('Lemon', '3a Small')
  ok(r, 'lemon Small is compared under its own printed name')
  eq(r.fit, 'exact', 'and against the Danish size of the same band')
  ok(!all.some((r2) => /\+/.test(r2.grade) && r2.species === 'Lemon' && r2.grade.includes('3b')),
    'the grade the board stopped printing is not resurrected here')
}

/* ---- A SPECIES THAT CANNOT BE LINED UP IS NAMED, WITH A REASON -------- *
 * Dropped silently it reads as a species neither market landed, and they are
 * different facts. */
{
  const names = cmp.skipped.map((s) => s.species).sort()
  ok(names.includes('Megrim'), 'megrim is named — Hanstholm publishes no megrim sorts')
  ok(names.includes('Squid'), 'and squid, which Peterhead grades by length')
  ok(cmp.skipped.every((s) => s.species), 'every skipped entry names its species')
  ok(/no megrim sorts/i.test(cmp.skipped.find((s) => s.species === 'Megrim').note),
    'with the reason in words rather than a blank')
  ok(/LENGTH|cm/i.test(cmp.skipped.find((s) => s.species === 'Squid').note),
    'and squid says why size cannot be compared')
  ok(!cmp.groups.some((g) => names.includes(g.species)),
    'nothing is both compared and skipped')
}

/* ---- THE TWO BOARDS NAME SPECIES DIFFERENTLY ------------------------- */
eq(canonSp('Catfishes'), 'catfish', 'Denmark writes Catfishes')
eq(canonSp('Coley'), 'saithe', 'and Coley for saithe')
eq(canonSp('Lythe'), 'pollack', 'and Lythe for pollack')

/* ---- A SPECIES ON ONE BOARD ONLY IS NOT COMPARED --------------------- *
 * Denmark priced crab, lobster, nephrops, redfish, dab, dogfish, forkbeard
 * and blue ling that day and Peterhead none of them. */
{
  const dkOnly = ['Crab', 'Lobster', 'Nephrops', 'Redfish', 'Dab', 'Blue Ling']
  for (const s of dkOnly)
    ok(!cmp.groups.some((g) => g.species === s) && !cmp.skipped.some((k) => k.species === s),
      `${s} is on the Danish board only and is left out of both lists`)
}

/* ---- NOTHING IS INVENTED WHERE A PRICE IS MISSING -------------------- */
{
  const noDk = rows.filter((r) => r.source === 'PD').map((r) => ({ ...r, ave: null }))
  const empty = compareBoards(buildBoard(noDk, 'PD'), buildBoard(rows, 'DK'))
  eq(empty.groups.flatMap((g) => g.rows).length, 0, 'a board with no prices compares nothing')
}
eq(compareSpecies([], [], 'cod').rows, [], 'and two empty boards give no rows')

console.log(`compare boards: ${n} checks passed`)
