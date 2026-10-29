/* THE HADDOCK SUB-GRADE SPLIT, against the real note of 28-10-2026.
 *
 * It began as the size-4 split. David, Oct 2026: *"fish sold as A4+ not coming
 * through the haddock split part"*, over a page reading *"Split by totals done
 * — Mini 144 / Metro 52 / Chipper 25 boxes allocated by price. ⚠ your totals
 * (221) differ from the 24 A4 boxes landed by +197 — check the entry."*
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
 * THEN THE LADDER ITSELF MOVED. David, Oct 2026: *"Good seed on Don Company
 * sales notes from 20/10/26 onwards is A1. seed and chippers are A2 (create a
 * new split for these), A3 is metro, A4 is mini. do not change sales notes
 * from before 20/10/26 as old split was accurate for older sales note."*
 *
 * So the split moved from A4 to A2 on that date, three bands became two, and
 * every note before it must read exactly as it always did.
 *
 * The fixture is the real note's own figures throughout, so these are the
 * prices and box counts the market actually printed.
 */
import assert from 'node:assert'
import {
  splitHaddockByTotals, autoSplitHaddock, familyRows, sizeMark,
  haddockSpec, gradeSortKey, SPEC_A2, SPEC_A4, LADDER_CHANGEOVER,
} from './src/lib/salesAgg.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const H = (id, grade, boxes, kg, val, buyer) => ({
  id, species_canon: 'Haddock', grade, boxes, total_weight: kg,
  total_value: val, price_per_kg: Math.round((val / kg) * 100) / 100, buyer,
})
/* The haddock of AUDACIOUS BF83, 28-10-2026, read off the note. */
const NOTE = [
  /* size 4 — Mini Metro under the new ladder, the whole old split under the old */
  H('a', 'A4', 8, 320, 652.80, 'Garfish'),
  H('b', 'A4', 4, 160, 345.60, '1st Choice Fish'),
  H('c', 'A4', 10, 400, 880.00, 'Garfish'),
  H('d', 'A4', 2, 80, 176.80, 'Garfish'),
  H('e', 'A+4', 59, 2360, 5640.40, 'K&A Pirie'),
  H('f', 'A+4', 15, 600, 1452.00, 'John H Milne (A Firm)'),
  H('g', 'A+4', 10, 400, 996.00, 'Garfish'),
  H('h', 'A+4', 1, 27, 67.23, 'Garfish'),
  H('i', 'A+4', 38, 1520, 4043.20, 'GT Sustainable Seafoods'),
  /* size 2 — Seed and Chipper under the new ladder */
  H('j', 'A2', 14, 560, 2038.40, 'Coupers Seafoods Ltd'),
  H('k', 'A2', 7, 280, 1066.80, 'Coupers Seafoods Ltd'),
  H('l', 'A2', 8, 320, 1360.00, 'Coupers Seafoods Ltd'),
  H('m', 'A2', 1, 26, 110.50, 'Coupers Seafoods Ltd'),
  H('o', 'A2', 5, 200, 884.00, 'Coupers Seafoods Ltd'),
  H('p', 'A2', 1, 40, 178.40, 'IASG Ltd'),
  H('q', 'A2', 8, 320, 1443.20, 'Coupers Seafoods Ltd'),
  H('r', 'A+2', 5, 200, 768.00, 'John H Milne (A Firm)'),
  H('s', 'A+2', 1, 16, 61.44, 'John H Milne (A Firm)'),
  H('t', 'A+2', 7, 280, 1254.40, 'Skateraw Fisheries'),
  H('u', 'A+2', 10, 400, 1820.00, 'Eat Mair Fish Ltd'),
  /* size 3 is Metro and is never split — one grade, nothing to divide */
  H('x', 'A3', 18, 720, 2248.80, 'Garfish'),
  H('y', 'A+3', 31, 1214, 4549.80, 'Garfish'),
  { id: 'z', species_canon: 'Cod', grade: 'A4', boxes: 9, total_weight: 360, total_value: 900, price_per_kg: 2.5, buyer: 'Garfish' },
]
const boxesIn = (rows) => rows.reduce((s, r) => s + r.boxes, 0)
const subIn = (res, id) => res.updates.find(u => u.id === id).sub_grade

/* ====================================================================== *
 * WHICH SPLIT A NOTE GETS — the date decides and the agent gates it
 * ====================================================================== */
eq(LADDER_CHANGEOVER, '2026-10-20', 'the ladder changed on 20-10-2026, on David’s word')
eq(haddockSpec('Don Fishing · Peterhead', '2026-10-28'), SPEC_A2,
  'a Don note after the changeover splits size 2')
eq(haddockSpec('Don Fishing · Peterhead', '2026-10-20'), SPEC_A2,
  'the 20th itself is the new ladder — "from 20/10/26 onwards"')
eq(haddockSpec('Don Fishing · Peterhead', '2026-10-19'), SPEC_A4,
  'and the 19th is still the old one. The boundary is pinned both sides.')
eq(haddockSpec('Don Fishing · Peterhead', '2023-11-28'), SPEC_A4,
  'the oldest Don note in the record keeps the old split')
/* A BARE `Don Fishing` IS STILL A DON NOTE, and this is the case that decides
   the gate. 161 size-4 haddock rows sit on that market because the PORT is not
   being read off those notes — gating on Peterhead alone would have left a
   post-changeover note on the old three-way split, silently labelling 147
   boxes of Mini Metro as three different fish. */
eq(haddockSpec('Don Fishing', '2026-10-22'), SPEC_A2,
  'a Don note with no port read off it is still a Don note')
/* IT IS DON'S CHANGE. 645 size-4 haddock rows in this record came off P&J
   notes and nothing says that firm has re-cut anything — sweeping them in
   would relabel another agent's fish on an assumption. */
eq(haddockSpec('P&J Johnstone · Peterhead', '2026-10-28'), SPEC_A4,
  'P&J keeps the old ladder whatever the date')
eq(haddockSpec('Hanstholm', '2026-10-28'), SPEC_A4,
  'and Hanstholm’s A2 is a Danish sort, nothing to do with Peterhead grading')
eq(haddockSpec('Shetland Auction', '2026-10-28'), SPEC_A4, 'nor is Shetland Don’s')
eq(haddockSpec('John S Duncan · Scrabster', '2026-10-28'), SPEC_A4,
  'and a firm whose name merely looks similar is not matched')
/* NO DATE MEANS OLD, which is the direction David asked for: a note that
   cannot be shown to be on or after 20-10 has not been shown to need changing.
   An undated note is its own fault to fix — the Shetland tally filed one. */
eq(haddockSpec('Don Fishing · Peterhead', null), SPEC_A4, 'an undated note reads as old')
eq(haddockSpec('Don Fishing · Peterhead', ''), SPEC_A4, 'and so does a blank date')
eq(haddockSpec(null, '2026-10-28'), SPEC_A4, 'a note with no market reads as old too')
eq(haddockSpec('Don Fishing · Peterhead', '2026-10-28T00:00:00Z'), SPEC_A2,
  'a timestamp is read as its date rather than failing the comparison')

/* THE BANDS RUN CHEAPEST FIRST, which is what makes a price ranking a size
   ranking, and the two specs point OPPOSITE WAYS on the same word. Inside
   size 4 Chipper (2b) is the biggest fish of three; inside size 2 it is the
   smaller of two. Measured on the board — Seed beat Chipper on all six days
   since the ladder changed. Copying the old orientation would have put every
   label the wrong way round. */
eq(SPEC_A4.bands, ['Mini Metro', 'Metro', 'Chipper'], 'size 4: Mini cheapest, Chipper dearest')
eq(SPEC_A2.bands, ['Chipper', 'Seed'], 'size 2: Chipper cheapest, Seed dearest')
eq(SPEC_A4.digit, '4', 'and each spec names its own size digit')
eq(SPEC_A2.digit, '2', '')

/* ====================================================================== *
 * THE FAMILY IS ONE SIZE DIGIT, WHATEVER MARK THE OFFICE PRINTED
 * ====================================================================== */
eq(sizeMark('A4', '4'), '', 'a plain A4 carries no mark')
eq(sizeMark('A+4', '4'), '+', 'A+4 is the plus mark')
eq(sizeMark('A-4', '4'), '-', 'and A-4 the minus, which arrived on this very note')
eq(sizeMark('A3', '4'), null, 'size 3 is not in the size-4 family')
eq(sizeMark('A2', '4'), null, 'nor is size 2')
eq(sizeMark('A+2', '2'), '+', 'and A+2 is in the size-2 family')
eq(sizeMark('A-2', '2'), '-', 'as is A-2, although none has landed yet')
eq(sizeMark('2b', '2'), null, 'a grading-table code is not an A-ladder grade')
eq(sizeMark('', '4'), null, 'a blank grade is in no family')
eq(sizeMark(null, '4'), null, 'and neither is nothing at all')

{
  const fam = familyRows(NOTE, '4')
  eq(fam.length, 9, 'nine size-4 haddock rows on the real note')
  eq(boxesIn(fam), 147, '147 boxes, where the page counted 24')
  ok(!fam.some(r => r.grade === 'A3' || r.grade === 'A2'), 'no other size is pulled in')
  ok(!fam.some(r => r.species_canon === 'Cod'), 'and A4 COD is not haddock')
}
{
  const fam = familyRows(NOTE, '2')
  eq(fam.length, 11, 'eleven size-2 haddock rows')
  eq(boxesIn(fam), 67, '67 boxes — what the note put in A2 on 28-10')
  eq(boxesIn(fam.filter(r => r.grade === 'A2')), 44, '44 of them plain A2')
  eq(boxesIn(fam.filter(r => r.grade === 'A+2')), 23, 'and 23 A+2')
}

/* ====================================================================== *
 * THE NEW SPLIT: SEED AND CHIPPER
 * ====================================================================== */
/* THE ORIENTATION IS THE WHOLE POINT. Seed is the DEARER band. Getting this
   backwards is the one mistake that would label every box wrong while looking
   perfectly tidy, so it is asserted on the real note's own prices. */
{
  const res = splitHaddockByTotals(NOTE, { Seed: 22, Chipper: 25 }, SPEC_A2)
  eq(res.actual, 67, 'the note carries 67 size-2 boxes')
  eq(res.entered, 47, 'against the 47 the boat graded as Seed and Chipper')
  ok(res.flag, 'which disagree, and that is reported rather than resolved')
  eq(res.assigned.Seed + res.assigned.Chipper, 67, 'every landed box labelled exactly once')
  ok(res.assigned.Seed > 0 && res.assigned.Chipper > 0, 'both bands get fish')

  /* Within plain A2, cheapest first: j 14 (£3.64) … q 8 (£4.51). */
  eq(subIn(res, 'j'), 'Chipper', 'the cheapest A2 boxes are CHIPPER, the smaller fish')
  eq(subIn(res, 'q'), 'Seed', 'and the dearest are SEED')
  /* Within A+2, cheapest first: r/s (£3.84) … u (£4.55). */
  eq(subIn(res, 's'), 'Chipper', 'the same way round inside A+2')
  eq(subIn(res, 'u'), 'Seed', 'dearest A+2 is Seed')
  /* Nothing of another size is touched. */
  ok(!res.updates.some(u => 'abcdefghixyz'.includes(u.id)),
    'no size-4 or size-3 row is labelled by the size-2 split')
}
/* A MARK IS RANKED IN ITS OWN RIGHT, so the cheapest A+2 is Chipper even
   though it is dearer than some plain A2 that came out Seed. Pooled, the
   A/A+ step would be read as a size boundary. */
{
  const res = splitHaddockByTotals(NOTE, { Seed: 1, Chipper: 1 }, SPEC_A2)
  eq(res.marks.map(m => m.mark).sort(), ['A+2', 'A2'], 'both marks reported')
  const plain = res.marks.find(m => m.mark === 'A2')
  const plus = res.marks.find(m => m.mark === 'A+2')
  eq(plain.boxes, 44, 'A2 is 44 boxes')
  eq(plus.boxes, 23, 'A+2 is 23')
  ok(plain.assigned.Seed > 0 && plus.assigned.Chipper > 0,
    'each mark fills both its own bands rather than being sorted by quality')
}
/* TWO BANDS NEED ONLY TWO PRICE LEVELS, where three needed three. */
{
  const res = autoSplitHaddock(NOTE, SPEC_A2)
  ok(!res.error, 'the real note splits size 2 on price')
  eq(Object.keys(res.bands).sort(), ['A+2', 'A2'], 'a band set per mark')
  eq(res.updates.length, 11, 'every size-2 row is labelled')
  eq(subIn(res, 'j'), 'Chipper', 'the cheapest A2 row is Chipper')
  eq(subIn(res, 'q'), 'Seed', 'and the dearest is Seed')
  eq(res.bands.A2.length, 1, 'two bands means one cut')
  eq(res.bands.A2[0].band, 'Chipper', 'and the stated ceiling is Chipper’s')
}
/* THE TIE GOES TO THE CHEAPER BAND. Calling a box Seed when it was Chipper
   overstates the dear grade, and this record is what later trips get priced
   off. The cuts meet exactly where a band was graded as nothing. */
{
  const only = NOTE.filter(r => r.grade === 'A2')
  // cheapest first: j 14, k 7, l 8, m 1, o 5, p 1, q 8 = 44 boxes.
  // Chipper 21 of 44 puts the cut at 21; row l's midpoint is exactly 21+4=25,
  // so take Chipper 25/44 -> cut 25, where l's midpoint sits on the line.
  const res = splitHaddockByTotals(only, { Seed: 19, Chipper: 25 }, SPEC_A2)
  eq(res.entered, 44, 'the entry matches the landing')
  eq(res.diff, 0, 'so nothing is flagged')
  eq(subIn(res, 'l'), 'Chipper', 'a box sitting exactly on the line is the cheaper grade')
  eq(res.assigned.Chipper + res.assigned.Seed, 44, 'every box still labelled')
}
/* AN EMPTY ENTRY IS REFUSED, and the message names this spec's bands rather
   than the old three. */
{
  const res = splitHaddockByTotals(NOTE, { Seed: '', Chipper: '' }, SPEC_A2)
  ok(res.error, 'an empty entry is refused')
  ok(!res.updates, 'and nothing is labelled')
  ok(/Chipper/.test(res.error) && /Seed/.test(res.error), 'the message says what to enter')
  ok(!/Mini Metro/.test(res.error), 'and does not ask for a band this ladder has not got')
}
/* A LANDING WITH NO SIZE-2 HADDOCK says so, naming the family it looked for. */
{
  const res = splitHaddockByTotals(NOTE.filter(r => r.grade === 'A3'), { Seed: 1 }, SPEC_A2)
  ok(res.error, 'nothing to split is reported')
  ok(/A\+2/.test(res.error) && /A-2/.test(res.error), 'and the message names the whole family')
  ok(!/A4/.test(res.error), 'without mentioning a size it was not asked about')
}

/* ====================================================================== *
 * THE OLD SPLIT IS UNTOUCHED — "do not change sales notes from before 20/10"
 * ====================================================================== */
{
  const res = splitHaddockByTotals(NOTE, { 'Mini Metro': 144, Metro: 52, Chipper: 25 }, SPEC_A4)
  eq(res.actual, 147, 'the split still measures 147 size-4 boxes, not 24')
  eq(res.entered, 221, 'against the 221 he graded')
  ok(res.flag, 'and still says the two disagree')
  ok(res.assigned['Mini Metro'] > 0, 'Mini Metro has fish')
  ok(res.assigned.Metro > 0, 'so does Metro')
  ok(res.assigned.Chipper > 0, 'and so does Chipper')
  eq(res.assigned['Mini Metro'] + res.assigned.Metro + res.assigned.Chipper, 147,
    'every landed box is labelled exactly once')
  eq(res.marks.map(m => m.mark).sort(), ['A+4', 'A4'], 'both marks are reported')
  const a4 = res.marks.find(m => m.mark === 'A4')
  ok(a4.assigned.Chipper > 0, 'the dearest A4 boxes are Chipper in their own right')
  const plus = res.marks.find(m => m.mark === 'A+4')
  ok(plus.assigned['Mini Metro'] > 0, 'and the cheapest A+4 boxes are Mini Metro')
  eq(a4.boxes, 24, 'A4 is 24 boxes')
  eq(plus.boxes, 123, 'A+4 is 123')
}
/* IT IS A GENERALISATION, NOT A DIFFERENT ANSWER — where the entered totals DO
   match the landed boxes, apportioning by ratio is arithmetically the same as
   the absolute cut that shipped before. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  // cheapest first: a 8 (2.04), b 4 (2.16), c 10 (2.20), d 2 (2.21) = 24 boxes
  const res = splitHaddockByTotals(only, { 'Mini Metro': 8, Metro: 14, Chipper: 2 }, SPEC_A4)
  eq(res.entered, 24, 'entered equals landed')
  eq(res.diff, 0, 'so there is nothing to flag')
  eq(res.flag, false, 'and it does not flag')
  eq(subIn(res, 'a'), 'Mini Metro', 'the cheapest 8 boxes are Mini Metro')
  eq(subIn(res, 'b'), 'Metro', 'the middle is Metro')
  eq(subIn(res, 'c'), 'Metro', 'and still Metro')
  eq(subIn(res, 'd'), 'Chipper', 'the dearest 2 are Chipper')
  eq(res.assigned, { 'Mini Metro': 8, Metro: 14, Chipper: 2 },
    'and what was assigned is exactly what was entered')
}
/* THE REPORT IS THE OUTCOME, NOT THE INTENTION. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  const res = splitHaddockByTotals(only, { 'Mini Metro': 0, Metro: 0, Chipper: 500 }, SPEC_A4)
  eq(res.assigned.Chipper, 24, 'all 24 landed boxes are Chipper')
  eq(res.assigned['Mini Metro'], 0, 'and nothing is claimed for Mini Metro')
  ok(res.assigned.Chipper !== res.entered, 'the report is not an echo of the entry')
}
/* THE TIE IN THE THREE-BAND CASE, unchanged: it goes to Mini Metro. */
{
  const only = NOTE.filter(r => r.grade === 'A4' && r.species_canon === 'Haddock')
  const res = splitHaddockByTotals(only, { 'Mini Metro': 10, Metro: 0, Chipper: 14 }, SPEC_A4)
  eq(res.entered, 24, 'the entry matches the landing')
  eq(subIn(res, 'b'), 'Mini Metro',
    'a box sitting exactly on the line is the cheaper grade, not the dearer')
  eq(res.assigned.Metro, 0, 'and no Metro is invented where none was graded')
  eq(res.assigned['Mini Metro'] + res.assigned.Chipper, 24, 'every box still labelled')
}
/* THE BAND DETECTOR IS PER MARK — pooled, the largest price gap on this note is
   the A/A+ step itself (£2.21 to £2.39), so it would have found the QUALITY
   boundary and called it a size band. */
{
  const res = autoSplitHaddock(NOTE, SPEC_A4)
  ok(!res.error, 'the real note has enough spread')
  eq(Object.keys(res.bands).sort(), ['A+4', 'A4'], 'a band set per mark')
  eq(res.updates.length, 9, 'every size-4 row is labelled')
  eq(res.bands.A4.length, 2, 'three bands means two cuts')
  ok(res.bands.A4[1].max <= 2.21, 'the A4 bands sit inside the A4 price range')
  ok(res.bands['A+4'][0].max >= 2.39, 'and the A+4 bands inside A+4’s')
  eq(subIn(res, 'd'), 'Chipper', 'the dearest A4 box is Chipper, not Mini Metro')
}
/* A MARK WITH TOO LITTLE SPREAD IS NAMED, never dropped quietly. */
{
  const rows = [
    H('n1', 'A4', 5, 200, 420, 'One'),              // one price only
    ...NOTE.filter(r => r.grade === 'A+4'),
  ]
  const res = autoSplitHaddock(rows, SPEC_A4)
  ok(!res.error, 'the A+4 mark still splits')
  ok(res.thin.some(t => /A4/.test(t)), 'and the thin mark is named')
  ok(!res.updates.some(u => u.id === 'n1'), 'its row is left for the skipper')
}
/* AND THE DEFAULT IS THE OLD SPLIT, so any caller that has not been told about
   the changeover behaves as it always did. */
{
  const res = splitHaddockByTotals(NOTE, { 'Mini Metro': 8, Metro: 14, Chipper: 2 })
  eq(res.actual, 147, 'no spec means size 4')
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

console.log(`haddock split: ${n} checks passed`)
