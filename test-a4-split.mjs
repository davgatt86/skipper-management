/* THE SIZE-4 HADDOCK SPLIT, against the real note of 28-10-2026.
 *
 * David: *"fish sold as A4+ not coming through the haddock split part"*, over a
 * page reading *"Split by totals done — Mini 144 / Metro 52 / Chipper 25 boxes
 * allocated by price. ⚠ your totals (221) differ from the 24 A4 boxes landed by
 * +197 — check the entry."*
 *
 * Three faults in that one sentence, and the first hid the other two:
 *
 *   1. `grade === 'A4'` saw 24 of the 147 size-4 boxes the note carries. 123
 *      sold as A+4 and were invisible — and the filter was written out THREE
 *      times, on the page and inside each split function.
 *   2. The cuts were absolute box counts, so with more boxes entered than the
 *      note carried every row fell under the Mini cut and the whole landing
 *      came out ONE band.
 *   3. The message echoed the ENTRY, so it reported a three-way split that had
 *      not happened.
 *
 * The fixture is the real note's own figures, so these are the prices and box
 * counts the market actually printed.
 */
import assert from 'node:assert'
import { splitA4ByTotals, autoSplitA4Haddock, a4Mark, a4FamilyRows, gradeSortKey }
  from './src/lib/salesAgg.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

/* The size-4 haddock of AUDACIOUS BF83, 28-10-2026, read off the note. */
const H = (id, grade, boxes, kg, val, buyer) => ({
  id, species_canon: 'Haddock', grade, boxes, total_weight: kg,
  total_value: val, price_per_kg: Math.round((val / kg) * 100) / 100, buyer,
})
const NOTE = [
  H('a', 'A4', 8, 320, 652.80, 'Garfish'),
  H('b', 'A4', 4, 160, 345.60, '1st Choice Fish'),
  H('c', 'A4', 10, 400, 880.00, 'Garfish'),
  H('d', 'A4', 2, 80, 176.80, 'Garfish'),
  H('e', 'A+4', 59, 2360, 5640.40, 'K&A Pirie'),
  H('f', 'A+4', 15, 600, 1452.00, 'John H Milne (A Firm)'),
  H('g', 'A+4', 10, 400, 996.00, 'Garfish'),
  H('h', 'A+4', 1, 27, 67.23, 'Garfish'),
  H('i', 'A+4', 38, 1520, 4043.20, 'GT Sustainable Seafoods'),
  /* Not size 4 — must never be drawn into the split. */
  H('x', 'A3', 18, 720, 2248.80, 'Garfish'),
  H('y', 'A+3', 31, 1214, 4549.80, 'Garfish'),
  { id: 'z', species_canon: 'Cod', grade: 'A4', boxes: 9, total_weight: 360, total_value: 900, price_per_kg: 2.5, buyer: 'Garfish' },
]
const boxesIn = (rows) => rows.reduce((s, r) => s + r.boxes, 0)

/* ---- THE FAMILY IS SIZE 4, WHATEVER MARK THE OFFICE PRINTED ---------- */
eq(a4Mark('A4'), '', 'a plain A4 carries no mark')
eq(a4Mark('A+4'), '+', 'A+4 is the plus mark')
eq(a4Mark('A-4'), '-', 'and A-4 the minus, which arrived on this very note')
eq(a4Mark('A3'), null, 'size 3 is not in the family')
eq(a4Mark('A+3'), null, 'nor is A+3')
eq(a4Mark('2b'), null, 'and a grading-table code is not an A-ladder grade')
eq(a4Mark(''), null, 'a blank grade is not size 4')
eq(a4Mark(null), null, 'and neither is nothing at all')

{
  const fam = a4FamilyRows(NOTE)
  eq(fam.length, 9, 'nine size-4 haddock rows on the real note')
  eq(boxesIn(fam), 147, '147 boxes, where the page counted 24')
  ok(!fam.some(r => r.grade === 'A3' || r.grade === 'A+3'), 'no size-3 row is pulled in')
  ok(!fam.some(r => (r.species_canon) === 'Cod'), 'and A4 COD is not haddock')
}

/* ---- WHAT HE SAW: the entry against what the note carries ------------- */
{
  const res = splitA4ByTotals(NOTE, { mini: 144, metro: 52, chipper: 25 })
  eq(res.actual, 147, 'the split now measures 147 boxes, not 24')
  eq(res.entered, 221, 'against the 221 he graded')
  ok(res.flag, 'and still says the two disagree — that is a real question')

  /* THE ALLOCATION NO LONGER COLLAPSES. Absolute cuts put all 24 boxes in Mini
     Metro; the ratio he gave is 144:52:25, so all three bands get fish. */
  ok(res.assigned['Mini Metro'] > 0, 'Mini Metro has fish')
  ok(res.assigned.Metro > 0, 'so does Metro')
  ok(res.assigned.Chipper > 0, 'and so does Chipper')
  eq(res.assigned['Mini Metro'] + res.assigned.Metro + res.assigned.Chipper, 147,
    'every landed box is labelled exactly once')
  /* AND THE MARKS ARE RANKED SEPARATELY. Pooled, every A4 row (£2.04-£2.21) is
     cheaper than every A+4 row (£2.39-£2.66), so one ladder would have called
     all 24 A4 boxes Mini Metro for being the A-quality ones. */
  eq(res.marks.map(m => m.mark).sort(), ['A+4', 'A4'], 'both marks are reported')
  const a4 = res.marks.find(m => m.mark === 'A4')
  ok(a4.assigned.Chipper > 0, 'the dearest A4 boxes are Chipper in their own right')
  const plus = res.marks.find(m => m.mark === 'A+4')
  ok(plus.assigned['Mini Metro'] > 0, 'and the cheapest A+4 boxes are Mini Metro')
  eq(a4.boxes, 24, 'A4 is 24 boxes')
  eq(plus.boxes, 123, 'A+4 is 123')
}

/* ---- IT IS A GENERALISATION, NOT A DIFFERENT ANSWER ------------------- *
 * Where the entered totals DO match the landed boxes, apportioning by ratio is
 * arithmetically the same as the absolute cut that shipped before. Asserted on
 * one mark so the comparison is like for like. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  // cheapest first: a 8 (2.04), b 4 (2.16), c 10 (2.20), d 2 (2.21) = 24 boxes
  const res = splitA4ByTotals(only, { mini: 8, metro: 14, chipper: 2 })
  eq(res.entered, 24, 'entered equals landed')
  eq(res.diff, 0, 'so there is nothing to flag')
  eq(res.flag, false, 'and it does not flag')
  const sub = (id) => res.updates.find(u => u.id === id).sub_grade
  eq(sub('a'), 'Mini Metro', 'the cheapest 8 boxes are Mini Metro')
  eq(sub('b'), 'Metro', 'the middle is Metro')
  eq(sub('c'), 'Metro', 'and still Metro')
  eq(sub('d'), 'Chipper', 'the dearest 2 are Chipper')
  eq(res.assigned, { 'Mini Metro': 8, Metro: 14, Chipper: 2 },
    'and what was assigned is exactly what was entered')
}

/* ---- THE REPORT IS THE OUTCOME, NOT THE INTENTION -------------------- *
 * The old page read the entry back. Here the entry is 500 boxes of Chipper on
 * a note with 24 — the assigned figures must describe the rows, not the box. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  const res = splitA4ByTotals(only, { mini: 0, metro: 0, chipper: 500 })
  eq(res.assigned.Chipper, 24, 'all 24 landed boxes are Chipper')
  eq(res.assigned['Mini Metro'], 0, 'and nothing is claimed for Mini Metro')
  ok(res.assigned.Chipper !== res.entered, 'the report is not an echo of the entry')
}

/* ---- NO TOTALS IS A QUESTION, NOT A SPLIT INTO NOTHING --------------- *
 * With nothing entered the ratio is undefined. Dividing by it would have put
 * every box in Metro and reported a completed split. */
{
  const res = splitA4ByTotals(NOTE, { mini: '', metro: '', chipper: '' })
  ok(res.error, 'an empty entry is refused')
  ok(!res.updates, 'and nothing is labelled')
  ok(/Mini Metro/.test(res.error), 'the message says what to enter')
}
/* A LANDING WITH NO SIZE-4 HADDOCK says so, and names every grade it looked
   for — "No Haddock A4 rows" read as a fault when A+4 was sitting right there. */
{
  const res = splitA4ByTotals(NOTE.filter(r => r.grade === 'A3'), { mini: 1, metro: 1, chipper: 1 })
  ok(res.error, 'nothing to split is reported')
  ok(/A\+4/.test(res.error) && /A-4/.test(res.error), 'and the message names the whole family')
}

/* ---- THE ONE TIE THE CUTS CAN PRODUCE -------------------------------- *
 * Proportional cuts cannot cross, so the order of the Mini and Chipper tests
 * is not load-bearing (mutation-checked: swapping them changes no answer).
 * They MEET exactly when no Metro was graded, and a row whose midpoint lands
 * on that line could go either way. It goes to Mini Metro — calling a box
 * Chipper when it was Mini overstates the dear grade, and this record is what
 * later trips get priced off. Pinned so the choice stays deliberate. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  // boxes cheapest first: a 8, b 4, c 10, d 2 = 24. Cuts meet at 10; row b's
  // midpoint is exactly 10.
  const res = splitA4ByTotals(only, { mini: 10, metro: 0, chipper: 14 })
  eq(res.entered, 24, 'the entry matches the landing')
  eq(res.updates.find(u => u.id === 'b').sub_grade, 'Mini Metro',
    'a box sitting exactly on the line is the cheaper grade, not the dearer')
  eq(res.assigned.Metro, 0, 'and no Metro is invented where none was graded')
  eq(res.assigned['Mini Metro'] + res.assigned.Chipper, 24, 'every box still labelled')
}

/* ---- THE BAND DETECTOR IS PER MARK FOR THE SAME REASON --------------- *
 * Pooled, the largest price gap on this note is the A/A+ step itself (£2.21 to
 * £2.39), so the detector would have found the QUALITY boundary and called it
 * a size band. */
{
  const res = autoSplitA4Haddock(NOTE)
  ok(!res.error, 'the real note has enough spread')
  eq(Object.keys(res.bands).sort(), ['A+4', 'A4'], 'a band set per mark')
  eq(res.updates.length, 9, 'every size-4 row is labelled')
  /* The A4 cuts come off A4 prices alone — all four below the cheapest A+4. */
  ok(res.bands.A4.metroMax <= 2.21, 'the A4 bands sit inside the A4 price range')
  ok(res.bands['A+4'].miniMax >= 2.39, 'and the A+4 bands inside A+4’s')
  const subOf = (id) => res.updates.find(u => u.id === id).sub_grade
  ok(subOf('d') === 'Chipper', 'the dearest A4 box is Chipper, not Mini Metro')
}
/* A MARK WITH TOO LITTLE SPREAD IS NAMED, never dropped quietly — a mark left
   unsplit while the other is split would read as fish that never landed. */
{
  const rows = [
    H('p', 'A4', 5, 200, 420, 'One'),              // one price only
    ...NOTE.filter(r => r.grade === 'A+4'),
  ]
  const res = autoSplitA4Haddock(rows)
  ok(!res.error, 'the A+4 mark still splits')
  ok(res.thin.some(t => /A4/.test(t)), 'and the thin mark is named')
  ok(!res.updates.some(u => u.id === 'p'), 'its row is left for the skipper')
}

/* ---- THE MINUS MARK SORTS WHERE IT BELONGS --------------------------- *
 * `A(\+)?(\d+)` failed on `A-2`, so it fell to the unrecognised bucket and sat
 * below every real grade at the foot of the list. */
{
  const order = ['A2', 'A-2', 'A+1', 'A+2', 'A1', 'A-1']
    .sort((a, b) => gradeSortKey(a) < gradeSortKey(b) ? -1 : 1)
  eq(order, ['A+1', 'A1', 'A-1', 'A+2', 'A2', 'A-2'],
    'each size runs A+ then plain then A-')
  ok(gradeSortKey('A-2') < gradeSortKey('Nephrops'),
    'and a real grade still sorts above an unrecognised label')
}

console.log(`a4 split: ${n} checks passed`)
