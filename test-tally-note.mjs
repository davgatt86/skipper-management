/* THE TALLY AGAINST THE SALES NOTE — trip 72 beside the note of 28-10-2026.
 *
 * David: *"i think the good seed was sold as A2 due to it not being graded
 * perfectly onboard that trip by the crew. therefore it was sold as the same
 * grade as seed on the eAuction. maybe the splitter should allow for that. user
 * could upload a tally to check against sales note?"*
 *
 * The fixture is both real documents' own figures, so the shares and the
 * candidate below are what the check actually says about that trip.
 */
import assert from 'node:assert'
import {
  tallyCode, tallyLadder, noteLadder, compareLadder, downgradeCandidates,
  bandTotalsFromTally, specWithBand, TALLY_SPECIES, BAND_CODE, DOWNGRADE_FLOOR,
} from './src/lib/tallyVsNote.js'
import { SPEC_A2, SPEC_A4, splitHaddockByTotals } from './src/lib/salesAgg.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

/* trip 72's wheelhouse tally, haddock as the crew graded it */
const T = [
  { species: 'HADDOCK', grade: 'Chat (1b)', boxes: 8 },
  { species: 'HADDOCK', grade: 'Pinger (1c)', boxes: 16 },
  { species: 'HADDOCK', grade: 'Good Seed (1d)', boxes: 20 },
  { species: 'HADDOCK', grade: 'Seed (2a)', boxes: 25 },
  { species: 'HADDOCK', grade: 'Chipper (2b)', boxes: 28 },
  { species: 'HADDOCK', grade: 'Metro (3)', boxes: 57 },
  { species: 'HADDOCK', grade: 'M Metro (4)', boxes: 151 },
  { species: 'COD', grade: 'Large (1b)', boxes: 1 },
  { species: 'OTHER', grade: 'Mix', boxes: 7 },
]
/* the note's haddock, folded to the box counts it actually sold per A-number */
const N = [
  { species_canon: 'Haddock', grade: 'A+1', boxes: 1 },
  { species_canon: 'Haddock', grade: 'A1', boxes: 16 },
  { species_canon: 'Haddock', grade: 'A+2', boxes: 23 },
  { species_canon: 'Haddock', grade: 'A2', boxes: 44 },
  { species_canon: 'Haddock', grade: 'A+3', boxes: 31 },
  { species_canon: 'Haddock', grade: 'A3', boxes: 18 },
  { species_canon: 'Haddock', grade: 'A+4', boxes: 123 },
  { species_canon: 'Haddock', grade: 'A4', boxes: 24 },
  { species_canon: 'Haddock', grade: 'U9', boxes: 5 },   // not on the A ladder
  { species_canon: 'Cod', grade: 'A2', boxes: 28 },      // not haddock
]

/* ---- THE CODE IS THE HALF THAT JOINS -------------------------------- *
 * The tally writes the trade name and the code; the sheet's own foot says the
 * names are "PROVIDED AS A GUIDE ONLY", so the code is what anything keys on. */
eq(tallyCode('Good Seed (1d)'), { name: 'Good Seed', code: '1d', digit: '1' }, 'name, code and digit')
eq(tallyCode('M Metro (4)'), { name: 'M Metro', code: '4', digit: '4' }, 'a bare digit is its own code')
eq(tallyCode('Sma (4a)'), { name: 'Sma', code: '4a', digit: '4' }, 'and 4a sits under digit 4')
eq(tallyCode('XL (1A)').code, '1a', 'the code is folded to lower case, as the table writes it')
eq(tallyCode('Mix'), { name: 'Mix', code: null, digit: null }, 'no bracketed code yields no digit')
eq(tallyCode('').digit, null, 'and a blank grade is on no rung')
eq(tallyCode(null).digit, null, 'nor is nothing at all')

/* ---- THE TWO LADDERS ------------------------------------------------- */
{
  const l = tallyLadder(T)
  eq(l.length, 7, 'seven haddock rungs on the tally')
  eq(l.map(r => r.code), ['1b', '1c', '1d', '2a', '2b', '3', '4'], 'in code order, biggest first')
  eq(l.reduce((s, r) => s + r.boxes, 0), 305, '305 boxes — the wheelhouse count')
  ok(!l.some(r => r.name === 'Large'), 'and COD is not drawn in')
}
{
  const l = noteLadder(N)
  eq([...l.entries()].sort(), [['1', 17], ['2', 67], ['3', 49], ['4', 147]],
    'the note folds A+n and An onto one size digit')
  ok(!l.has('9'), 'U9 is not on the A ladder')
  eq([...l.values()].reduce((s, v) => s + v, 0), 280, '280 haddock boxes sold')
}

/* ---- SHARES, NOT BOXES ---------------------------------------------- *
 * The tally is a pre-landing count — 305 against the note's 280 — so box for
 * box it would report a 25-box discrepancy on every trip and bury the signal. */
{
  const c = compareLadder(T, N)
  eq(c.tallyTotal, 305, 'the crew counted 305')
  eq(c.noteTotal, 280, 'the market sold 280')
  ok(c.tallyTotal !== c.noteTotal, 'so the totals do NOT agree, and that is not an error')
  const by = Object.fromEntries(c.rows.map(r => [r.digit, r]))
  eq(by['1'].tallyBoxes, 44, 'A1 holds Chat, Pinger and Good Seed — 44 boxes')
  eq(by['1'].noteBoxes, 17, 'against 17 sold')
  eq(by['1'].tallyShare, 14.4, '14.4% of the tally')
  eq(by['1'].noteShare, 6.1, 'but 6.1% of the note')
  eq(by['1'].gap, -8.3, 'so A1 sold 8.3 points short')
  eq(by['2'].gap, 6.5, 'and A2 sold 6.5 points over')
  eq(by['3'].gap, -1.2, 'A3 is out by only 1.2')
  eq(by['4'].gap, 3, 'and A4 by 3 — both the pre-landing count, not grading')
  eq(by['1'].codes.map(x => x.code), ['1b', '1c', '1d'], 'each row names the rungs behind it')
  eq(by['4'].codes.map(x => x.name), ['M Metro'], '')
}
/* A RUNG WITH NO CODE IS NAMED, never dropped — a missing rung would make the
   shares add to less than the fish the crew counted. */
{
  const c = compareLadder([...T, { species: 'HADDOCK', grade: 'Odds', boxes: 4 }], N)
  eq(c.unplaced.map(u => u.name), ['Odds'], 'an uncoded rung is reported')
  eq(c.tallyTotal, 309, 'and still counted in the total')
}

/* ---- THE DOWNGRADE IS OFFERED, NEVER CONCLUDED ---------------------- *
 * One size short, the next over by about as much, and the rung that moved is
 * the BOTTOM of its size — the fish nearest the boundary. That rule names Good
 * Seed without being told which rung to look at. */
{
  const cand = downgradeCandidates(compareLadder(T, N))
  eq(cand.length, 1, 'exactly one candidate on this trip')
  const c = cand[0]
  eq([c.fromDigit, c.toDigit], ['1', '2'], 'A1 short, A2 over')
  eq(c.code, '1d', 'the bottom rung of A1')
  eq(c.name, 'Good Seed', 'which is the Good Seed')
  eq(c.boxes, 20, '20 boxes of it')
  eq(c.offset, 6.5, 'against an offset of 6.5 points')
  eq(c.rungShare, 6.6, 'and the rung is 6.6% of the tally')
  eq(c.explains, 98, 'so it accounts for 98% of the gap — as close as this gets')
}
/* THE FLOOR KEEPS IT QUIET ON THE ORDINARY CASE, and it is set from the quiet
   half of this very pair: A3 and A4 are out by -1.2 and +3.0 purely because the
   tally is counted before anything is weighed. A check that fires every trip
   stops being read. */
eq(DOWNGRADE_FLOOR, 3, 'the floor is 3 percentage points')
{
  const cand = downgradeCandidates(compareLadder(T, N))
  ok(!cand.some(c => c.fromDigit === '3'), 'the A3/A4 noise raises nothing')
}
/* THE INVARIANT, asserted because the direction test alone does not
   discriminate: every candidate raised must have its FROM size at least the
   floor short and its TO size at least the floor over. That is what makes it a
   transfer of fish rather than a shortfall, and it holds whichever way the
   guard is written — the offset is the smaller of the two gaps. Checked over
   the real pair and over a shape where one size is short and the NEXT is short
   too, which is a shortfall and no transfer at all. */
{
  const shapes = [
    [T, N],
    [[{ species: 'HADDOCK', grade: 'XL (1a)', boxes: 50 },
      { species: 'HADDOCK', grade: 'Good Seed (1d)', boxes: 50 },
      { species: 'HADDOCK', grade: 'Seed (2a)', boxes: 50 },
      { species: 'HADDOCK', grade: 'Metro (3)', boxes: 50 }],
     [{ species_canon: 'Haddock', grade: 'A1', boxes: 20 },
      { species_canon: 'Haddock', grade: 'A2', boxes: 20 },
      { species_canon: 'Haddock', grade: 'A3', boxes: 160 }]],
  ]
  for (const [t, nn] of shapes) {
    const c = compareLadder(t, nn)
    const by = Object.fromEntries(c.rows.map(r => [r.digit, r]))
    for (const cand of downgradeCandidates(c)) {
      ok(by[cand.fromDigit].gap <= -DOWNGRADE_FLOOR,
        `A${cand.fromDigit} is at least the floor short`)
      ok(by[cand.toDigit].gap >= DOWNGRADE_FLOOR,
        `and A${cand.toDigit} at least the floor over — a transfer, not a shortfall`)
    }
  }
  /* In that second shape BOTH A1 and A2 sold short, so 1 -> 2 is not a
     transfer and must not be offered however short A1 is. */
  const c2 = compareLadder(shapes[1][0], shapes[1][1])
  ok(!downgradeCandidates(c2).some(x => x.fromDigit === '1' && x.toDigit === '2'),
    'two sizes both selling short is a shortfall, and no downgrade between them')
  ok(downgradeCandidates(c2).some(x => x.toDigit === '3'),
    'while the size that actually gained IS offered one')
}

/* A NOTE THAT MATCHES THE GRADING RAISES NOTHING AT ALL. */
{
  const clean = [
    { species_canon: 'Haddock', grade: 'A1', boxes: 44 },
    { species_canon: 'Haddock', grade: 'A2', boxes: 53 },
    { species_canon: 'Haddock', grade: 'A3', boxes: 57 },
    { species_canon: 'Haddock', grade: 'A4', boxes: 151 },
  ]
  const c = compareLadder(T, clean)
  eq(c.rows.every(r => r.gap === 0), true, 'every gap is nil when the shapes agree')
  eq(downgradeCandidates(c), [], 'and nothing is offered')
}
/* A RUNG FAR TOO SMALL TO EXPLAIN THE GAP SAYS SO. Reporting the candidate
   without that is the difference between an answer and a shrug. */
{
  const t = [
    { species: 'HADDOCK', grade: 'XL (1a)', boxes: 90 },
    { species: 'HADDOCK', grade: 'Good Seed (1d)', boxes: 2 },
    { species: 'HADDOCK', grade: 'Seed (2a)', boxes: 8 },
  ]
  const nn = [
    { species_canon: 'Haddock', grade: 'A1', boxes: 50 },
    { species_canon: 'Haddock', grade: 'A2', boxes: 50 },
  ]
  const cand = downgradeCandidates(compareLadder(t, nn))
  eq(cand.length, 1, 'the offset still raises a candidate')
  eq(cand[0].code, '1d', 'and still names the bottom rung')
  ok(cand[0].explains < 20, 'but 2 boxes cannot account for a 42-point gap, and it says so')
}

/* ---- THE TOTALS COME OFF THE TALLY ---------------------------------- */
eq(BAND_CODE.Seed, '2a', 'Seed is code 2a')
eq(BAND_CODE.Chipper, '2b', 'Chipper 2b')
eq(BAND_CODE['Good Seed'], '1d', 'and Good Seed 1d')
ok(SPEC_A2.bands.every(b => BAND_CODE[b]), 'every size-2 band has a code')
ok(SPEC_A4.bands.every(b => BAND_CODE[b]), 'and so does every size-4 band')
{
  eq(bandTotalsFromTally(T, SPEC_A2), { Chipper: 28, Seed: 25 }, 'the A2 bands off the tally')
  eq(bandTotalsFromTally(T, SPEC_A4), { 'Mini Metro': 151, Metro: 57, Chipper: 28 },
    'and the old A4 bands, which the crew also graded')
  /* A BAND THE CREW DID NOT GRADE IS 0, NOT BLANK. Blank reads to the splitter
     as "no totals at all", which it refuses outright. */
  eq(bandTotalsFromTally(T.filter(r => !/2a/.test(r.grade)), SPEC_A2).Seed, 0,
    'a band with no boxes graded comes back as nought')
}

/* ---- A CONFIRMED DOWNGRADE ADDS A BAND AT THE DEAR END -------------- */
{
  const s = specWithBand(SPEC_A2, 'Good Seed')
  eq(s.bands, ['Chipper', 'Seed', 'Good Seed'], 'three bands, cheapest first')
  eq(s.digit, '2', 'still the size-2 split')
  eq(s.addedBand, 'Good Seed', 'and it records that the band was added')
  eq(SPEC_A2.bands, ['Chipper', 'Seed'], 'the shipped spec is NOT mutated')
  eq(specWithBand(s, 'Good Seed'), s, 'adding it twice changes nothing')
  eq(specWithBand(SPEC_A2, null), SPEC_A2, 'and adding nothing returns the spec itself')
}
/* AND THE SPLITTER NEEDS NO CHANGE FOR IT — it counts bands rather than
   knowing three. Run on the real note's 67 size-2 boxes: adding Good Seed takes
   the graded total from 53 to 73 against the note's 67, which is the second
   piece of evidence for the downgrade. */
{
  const fam = N.filter(r => /^A[+-]?2$/.test(r.grade) && r.species_canon === 'Haddock')
    .map((r, i) => ({ ...r, id: 'x' + i, price_per_kg: 4 + i * 0.4 }))
  const two = splitHaddockByTotals(fam, bandTotalsFromTally(T, SPEC_A2), SPEC_A2)
  eq(two.entered, 53, 'as the ladder stands the crew graded 53 into A2')
  eq(two.diff, -14, '14 short of what the note sold')

  const s3 = specWithBand(SPEC_A2, 'Good Seed')
  const three = splitHaddockByTotals(fam, bandTotalsFromTally(T, s3), s3)
  eq(three.entered, 73, 'with Good Seed added it is 73')
  eq(three.diff, 6, 'only 6 over — and the tally always runs over')
  ok(Math.abs(three.diff) < Math.abs(two.diff),
    'so the extra band brings the two documents closer, which is the evidence')
  eq(Object.keys(three.assigned).sort(), ['Chipper', 'Good Seed', 'Seed'], 'all three bands filled')
  eq(three.assigned.Chipper + three.assigned.Seed + three.assigned['Good Seed'], 67,
    'and every box the note carries is labelled exactly once')
}

/* ---- THE SPECIES MAP IS MEASURED, AND `OTHER` IS NOT GUESSED -------- */
eq(TALLY_SPECIES.HADDOCK, 'Haddock', 'the tally shouts, the note does not')
eq(TALLY_SPECIES.BLACK, 'Saithe', 'BLACK is saithe')
eq(TALLY_SPECIES.MONKS, 'Monkfish', 'MONKS monkfish')
eq(TALLY_SPECIES.MEGS, 'Megrim', 'MEGS megrim')
eq(TALLY_SPECIES.LEMONS, 'Lemon Sole', 'and LEMONS lemon sole')
ok(!('OTHER' in TALLY_SPECIES),
  'OTHER is the tally’s catch-all and is left unmapped rather than pinned on one fish')

console.log(`tally vs note: ${n} checks passed`)
