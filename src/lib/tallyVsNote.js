/* --------------------------------------------------------------------------
 * THE TALLY AGAINST THE SALES NOTE — what the boat graded vs what sold
 *
 * David, Oct 2026: *"i think the good seed was sold as A2 due to it not being
 * graded perfectly onboard that trip by the crew. therefore it was sold as the
 * same grade as seed on the eAuction. maybe the splitter should allow for that.
 * user could upload a tally to check against sales note?"*
 *
 * So the two documents answer two different questions and the gap between them
 * is the interesting part:
 *
 *     the TALLY   what the crew graded, in the grading table's own codes
 *     the NOTE    what the market SOLD it as, by A-number
 *
 * Normally they correspond by the leading digit (see THE LADDER MOVED FROM A4
 * TO A2). Where the grading is loose the market sells a rung DOWN, and that is
 * not an error in either document — it is the auction's reading of the fish.
 *
 * THE COMPARISON IS OF SHARES, NOT BOXES, and that is forced by the documents
 * rather than chosen. Measured on trip 72 against the note of 28-10-2026:
 *
 *     tally (wheelhouse)   305 haddock boxes   ·  1,094 all species
 *     scales               279                 ·  1,037
 *     note                 280                 ·  1,042
 *
 * The tally is the running count kept at sea before anything is weighed, so it
 * sits about 5% above the landed figure and ~9% above on haddock. Comparing box
 * for box would report a 25-box discrepancy on every trip and the real signal
 * would be lost inside it. The boxes are still shown — the DIFFERENCE in them
 * is just never called an error.
 * ------------------------------------------------------------------------ */

/* Tally name -> the species name a sales note uses. MEASURED against the real
 * pair (trip 72 tally beside the 28-10 note) rather than assumed: every one of
 * these is corroborated by its own box count landing within a few per cent.
 *
 * `OTHER` is deliberately absent. It is the tally's catch-all — 7 boxes on trip
 * 72 against the note's brill, halibut, john dory, turbot and tusk — so it
 * cannot be matched to one species and is REPORTED as unmatchable rather than
 * pinned on whichever fish looks closest. */
export const TALLY_SPECIES = {
  HADDOCK: 'Haddock', COD: 'Cod', BLACK: 'Saithe', MONKS: 'Monkfish',
  LING: 'Ling', HAKE: 'Hake', MEGS: 'Megrim', WHITING: 'Whiting',
  SQUID: 'Squid', LEMONS: 'Lemon Sole', LYTHE: 'Lythe', PLAICE: 'Plaice',
  WITCH: 'Witch', CAT: 'Catfish', TUSK: 'Tusk', HALIBUT: 'Halibut',
  TURBOT: 'Turbot', BRILL: 'Brill', SKATE: 'Skate',
}

/* A split band's grading code, so the splitter's totals can come off the tally
 * instead of being typed. ONE map rather than a `codes` array running parallel
 * to `bands` — a parallel array is a second copy waiting to fall out of step. */
export const BAND_CODE = {
  'Mini Metro': '4', Metro: '3', Chipper: '2b', Seed: '2a', 'Good Seed': '1d',
}

const num = (v) => Number(v) || 0

/* --------------------------------------------------------------------------
 * `Good Seed (1d)` -> { name: 'Good Seed', code: '1d', digit: '1' }
 *
 * The tally writes the code in brackets after the trade name, and the code is
 * the half that joins to anything — the sheet's own foot says the names "ARE
 * NOT DEFINITIVE AND MAY BE INTERPRETED DIFFERENTLY, PROVIDED AS A GUIDE
 * ONLY". A grade with no bracketed code yields no digit rather than a guess.
 * ------------------------------------------------------------------------ */
export function tallyCode(grade) {
  const s = String(grade == null ? '' : grade).trim()
  const m = s.match(/^(.*?)\s*\(([0-9]+[a-z]?)\)$/i)
  if (!m) return { name: s, code: null, digit: null }
  const code = m[2].toLowerCase()
  return { name: m[1].trim(), code, digit: code[0] }
}

/** One species' tally lines, folded onto their grading codes. */
export function tallyLadder(tallyLines, species = 'HADDOCK') {
  const out = new Map()
  for (const l of tallyLines || []) {
    if (String(l.species || '').toUpperCase() !== species) continue
    const { name, code, digit } = tallyCode(l.grade)
    const k = code || `?${name}`
    const cur = out.get(k) || { code, digit, name, boxes: 0 }
    cur.boxes += num(l.boxes)
    out.set(k, cur)
  }
  return [...out.values()].sort((a, b) =>
    String(a.code || 'z').localeCompare(String(b.code || 'z')))
}

/** A note's rows for one species, folded onto the A-number's size digit. */
export function noteLadder(noteRows, species = 'Haddock') {
  const out = new Map()
  for (const r of noteRows || []) {
    if ((r.species_canon || r.species) !== species) continue
    const m = String(r.grade || '').trim().match(/^A[+-]?([0-9])$/i)
    if (!m) continue
    const d = m[1]
    out.set(d, (out.get(d) || 0) + num(r.boxes))
  }
  return out
}

const share = (v, total) => (total ? Math.round((v / total) * 1000) / 10 : null)

/* --------------------------------------------------------------------------
 * The ladder, side by side, per size digit.
 *
 * Returns one row per digit present on either document, carrying the codes the
 * crew graded into it, both box counts and both SHARES. `gap` is the note's
 * share less the tally's — positive means the market sold more under that
 * A-number than the crew graded into it.
 * ------------------------------------------------------------------------ */
export function compareLadder(tallyLines, noteRows, { species = 'HADDOCK' } = {}) {
  const noteName = TALLY_SPECIES[species] || species
  const rungs = tallyLadder(tallyLines, species)
  const note = noteLadder(noteRows, noteName)
  const tallyTotal = rungs.reduce((s, r) => s + r.boxes, 0)
  const noteTotal = [...note.values()].reduce((s, v) => s + v, 0)

  const digits = [...new Set([
    ...rungs.map(r => r.digit).filter(Boolean),
    ...note.keys(),
  ])].sort()

  const rows = digits.map(d => {
    const mine = rungs.filter(r => r.digit === d)
    const tb = mine.reduce((s, r) => s + r.boxes, 0)
    const nb = note.get(d) || 0
    const ts = share(tb, tallyTotal), ns = share(nb, noteTotal)
    return {
      digit: d,
      codes: mine.map(r => ({ code: r.code, name: r.name, boxes: r.boxes, share: share(r.boxes, tallyTotal) })),
      tallyBoxes: tb, noteBoxes: nb,
      tallyShare: ts, noteShare: ns,
      gap: ts == null || ns == null ? null : Math.round((ns - ts) * 10) / 10,
    }
  })
  /* A grade the crew graded with no bracketed code cannot be placed on the
     ladder. Named rather than dropped — a rung quietly missing would make the
     shares add up to less than the fish landed. */
  const unplaced = rungs.filter(r => !r.digit)
  return { species, noteName, rows, tallyTotal, noteTotal, unplaced }
}

/* --------------------------------------------------------------------------
 * A DOWNGRADE IS OFFERED, NEVER CONCLUDED.
 *
 * It shows as one size selling SHORT and the next size down selling OVER by
 * about the same amount — and the rung that moves is the BOTTOM one of its
 * size, because that is the fish nearest the boundary and so the one loose
 * grading sends down. On trip 72 that rule names Good Seed without being told:
 *
 *     digit 1   crew 14.4%   note  6.1%   -8.3 points short
 *     digit 2   crew 17.4%   note 23.9%   +6.5 points over
 *     bottom rung of digit 1 = 1d Good Seed, 20 boxes = 6.6% of the tally
 *
 * 6.5 against 6.6 is as close as this comparison gets, and it is the skipper's
 * own account of the trip. But it stays a candidate: the app cannot tell a
 * downgrade from a wheelhouse miscount, and the figures that would settle it
 * are not in either document.
 *
 * THE FLOOR IS 3 PERCENTAGE POINTS, set from the quiet half of this very pair.
 * Digits 3 and 4 are out by -1.2 and +3.0 points purely because the tally is a
 * pre-landing count, so anything under 3 is that noise and must stay silent — a
 * check that fires on the ordinary case stops being read.
 * ------------------------------------------------------------------------ */
export const DOWNGRADE_FLOOR = 3

export function downgradeCandidates(cmp) {
  const by = new Map(cmp.rows.map(r => [r.digit, r]))
  const out = []
  for (const r of cmp.rows) {
    const next = by.get(String(Number(r.digit) + 1))
    if (!next || r.gap == null || next.gap == null) continue
    /* One short and the next over. THE FLOOR BELOW ALREADY IMPLIES BOTH, since
       the offset is the smaller of the two and so cannot reach 3 unless this
       size is at least 3 points short and the next at least 3 points over —
       mutation-checked, and replacing this line with a plain box comparison
       leaves every assertion passing. It is kept because it states the intent,
       and because it is the only guard left if the floor is ever lowered. */
    if (!(r.gap < 0 && next.gap > 0)) continue
    const offset = Math.round(Math.min(-r.gap, next.gap) * 10) / 10
    if (offset < DOWNGRADE_FLOOR) continue
    /* The bottom rung of the short size — last by code, so 1d out of 1b/1c/1d. */
    const rung = r.codes.length ? r.codes[r.codes.length - 1] : null
    if (!rung) continue
    out.push({
      fromDigit: r.digit, toDigit: next.digit,
      code: rung.code, name: rung.name, boxes: rung.boxes, rungShare: rung.share,
      offset,
      /* How well the named rung accounts for the offset. A rung far smaller
         than the gap does not explain it, and saying so is the difference
         between an answer and a shrug. */
      explains: rung.share == null ? null
        : Math.round(Math.min(rung.share, offset) / Math.max(rung.share, offset) * 100),
    })
  }
  return out.sort((a, b) => b.offset - a.offset)
}

/* --------------------------------------------------------------------------
 * The splitter's totals, off the tally rather than typed in.
 *
 * Keyed by BAND NAME because that is the one vocabulary the split functions
 * know. A band whose code the crew did not grade comes back 0 — which the
 * splitter then apportions as nothing, correctly, rather than being handed a
 * blank it would read as "no totals at all".
 * ------------------------------------------------------------------------ */
export function bandTotalsFromTally(tallyLines, spec, species = 'HADDOCK') {
  const rungs = tallyLadder(tallyLines, species)
  const byCode = new Map(rungs.map(r => [r.code, r.boxes]))
  const out = {}
  for (const b of spec.bands) out[b] = byCode.get(BAND_CODE[b]) ?? 0
  return out
}

/* --------------------------------------------------------------------------
 * A CONFIRMED DOWNGRADE ADDS A BAND AT THE DEAR END.
 *
 * If the Good Seed sold as A2 then A2 held three grades that trip, not two, and
 * Good Seed is the dearest of them (board 28-10: 1d £5.07 · 2a £4.91 ·
 * 2b £4.43). The split functions take the band list from the spec and count
 * nothing, so one more band needs no change in them at all.
 *
 * IT IS THE SKIPPER'S ACT, NOT THE CHECK'S. The comparison offers the band and
 * he confirms it, the same rule the invoice categoriser follows — the app
 * cannot tell loose grading from a miscount, and a band added on its own
 * authority would relabel real fish on a guess.
 * ------------------------------------------------------------------------ */
export function specWithBand(spec, bandName) {
  if (!bandName || spec.bands.includes(bandName)) return spec
  return {
    ...spec,
    bands: [...spec.bands, bandName],   // dearest last, as every band list is
    addedBand: bandName,
  }
}
