/* What the note just changed — the arithmetic behind the upload panel.
 *
 *   node test-sales-change.mjs
 *
 * Run against the REAL sample note as well as fixtures, so the panel is proved
 * on a document that actually goes through the parser rather than on a hand-
 * made object shaped the way I imagined the parser's output.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  noteTotals, topSpecies, newBuyers, yearContext, summariseNote,
} from './src/lib/salesChange.js'

const require = createRequire(import.meta.url)
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const R = (species, buyer, boxes, weight, value) =>
  ({ species, species_canon: species, buyer, boxes, total_weight: weight, total_value: value })

/* ---- the note's own figures come from its ROWS ------------------------- */
{
  const rows = [R('COD', 'A', 10, 380, 1520), R('HADDOCK', 'B', 20, 760, 1596)]
  eq('totals are the row sum', noteTotals(rows), { boxes: 30, weight: 1140, value: 3116, ppk: 2.73 })
  eq('an empty note is zero, not NaN', noteTotals([]), { boxes: 0, weight: 0, value: 0, ppk: null })
  eq('a note with no weight has no price per kilo', noteTotals([R('COD', 'A', 1, 0, 5)]).ppk, null)
}

/* ---- what carried the note --------------------------------------------- */
{
  const rows = [
    R('HADDOCK', 'A', 40, 1500, 3000), R('COD', 'B', 10, 380, 1900),
    R('HAKE', 'C', 5, 190, 1200), R('WITCH', 'D', 1, 38, 100),
  ]
  const t = topSpecies(rows)
  eq('biggest money first', t.map((x) => x.species), ['HADDOCK', 'COD', 'HAKE'])
  eq('shares are of the note, and read as percentages', t.map((x) => x.share), [48, 31, 19])
  eq('and each carries its own price per kilo', t[0].ppk, 2)
  eq('three by default, however many species there are', topSpecies(rows).length, 3)
}

/* ---- new buyers: three states, not two ---------------------------------
 *
 * "no new buyers" and "nobody looked" must not render the same. A caller with
 * no list of known buyers gets null, never an empty array — an empty array
 * would quietly claim every buyer on the note is already on file. */
{
  const rows = [R('COD', 'Harbour Fish Co', 1, 1, 1), R('COD', 'New Firm Ltd', 1, 1, 1),
    R('HADDOCK', 'Harbour Fish Co', 1, 1, 1)]
  eq('buyers are counted once each', newBuyers(rows).buyers, 2)
  eq('with no list to compare against, nothing is claimed', newBuyers(rows).fresh, null)
  eq('against a known list, only the new one is named',
    newBuyers(rows, new Set(['Harbour Fish Co'])).fresh, ['New Firm Ltd'])
  eq('an empty known list means every buyer is new',
    newBuyers(rows, new Set()).fresh, ['Harbour Fish Co', 'New Firm Ltd'])
  eq('case and spacing do not make a buyer new',
    newBuyers(rows, new Set(['harbour   fish co', 'NEW FIRM LTD'])).fresh, [])
}

/* ---- the year the note belongs to -------------------------------------- */
{
  const landings = [
    { id: 1, landing_date: '2026-01-06', value: 1000 },
    { id: 2, landing_date: '2026-02-06', value: 2000 },
    { id: 3, landing_date: '2025-12-06', value: 9999 },
  ]
  eq('the note is read against ITS OWN year, not this one',
    yearContext('2026-03-01', landings), { year: '2026', landings: 2, value: 3000 })
  eq('a note being replaced does not count itself',
    yearContext('2026-03-01', landings, 2), { year: '2026', landings: 1, value: 1000 })
  eq('no date, no year context', yearContext(null, landings), null)
  eq('a rubbish date does not invent a year', yearContext('not-a-date', landings), null)
}

/* ---- the whole summary -------------------------------------------------- */
{
  const res = {
    filename: 'note.pdf', market: 'Don Fishing · Peterhead',
    meta: { vessel: 'NORTH WIND BCK500', isoDate: '2026-03-01', saleNo: '3390001' },
    rows: [R('COD', 'Harbour Fish Co', 10, 380, 1900), R('HADDOCK', 'New Firm Ltd', 20, 760, 1596)],
    reconcile: { found: true, ok: true, expected: { boxes: 30, weight: 1140, value: 3496 }, diffs: null },
  }
  const landings = [{ id: 1, landing_date: '2026-01-06', value: 1000 }]
  const s = summariseNote(res, { isNew: true, landings, knownBuyers: new Set(['Harbour Fish Co']) })

  eq('it reports a reconciled note as checked', s.checked, 'ok')
  eq('a new landing says so', s.isNew, true)
  eq('the year moves by the note', [s.before.value, s.after.value], [1000, 4496])
  eq('and by one landing', [s.before.landings, s.after.landings], [1, 2])
  eq('the new buyer is named', s.fresh, ['New Firm Ltd'])
  eq('rows, species and buyers are counted', [s.rows, s.species, s.buyers], [2, 2, 2])

  /* A NOTE THAT PRINTS NO TOTAL HAS NOT FAILED — it cannot be checked, and
   * calling that "reconciled" would be a claim nobody made. `reconcile_ok` is
   * nullable in the database for exactly this reason. */
  const noTotal = summariseNote({ ...res, reconcile: { found: false, ok: false } }, { landings })
  eq('an uncheckable note is neither ok nor a failure', noTotal.checked, 'none')
  eq('and shows no difference', noTotal.diffs, null)

  const off = summariseNote({
    ...res,
    reconcile: { found: true, ok: false, expected: { boxes: 30, weight: 1140, value: 3500 },
                 diffs: { boxes: 0, weight: 0, value: -4 } },
  }, { landings })
  eq('a note that does not tie says so', off.checked, 'differs')
  eq('and carries the difference', off.diffs.value, -4)

  /* A REPLACED NOTE ADDS NO LANDING. It is the same one re-read, so the count
   * does not move and the value moves by the DIFFERENCE. The first cut counted
   * it as an extra landing and the panel read "1 landing → 2" for a note that
   * added neither. */
  const replaced = summariseNote(res, { isNew: false, replacedId: 1, landings })
  eq('a replaced note adds no landing to the year',
    [replaced.before.landings, replaced.after.landings], [1, 1])
  eq('and moves the year by the difference, not the whole note',
    [replaced.before.value, replaced.after.value], [1000, 3496])
}

/* ---- THE REAL SAMPLE NOTE ----------------------------------------------
 *
 * The fixtures above are objects I shaped; this is the document the demo
 * actually hands a visitor, put through the actual parser. If the panel is
 * going to be wrong, it will be wrong here first. */
if (existsSync('public/samples/sample-sales-note.pdf')) {
  const ParseCore = require('./src/lib/parse-core.cjs')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const buf = readFileSync('public/samples/sample-sales-note.pdf')
  const res = await ParseCore.parsePdf(new Uint8Array(buf), pdfjs, 'sample-sales-note.pdf')
  const s = summariseNote(res, { isNew: true, landings: [], knownBuyers: new Set() })

  eq('the sample note reconciles', s.checked, 'ok')
  eq('and its figures are the row sum', [s.rows, s.boxes, s.value], [57, 768, 111800.76])
  eq('its vessel is read', s.vessel, 'NORTH WIND BCK500')
  eq('every buyer is new to an empty boat', s.fresh.length, s.buyers)
  eq('the shares of what carried it add to no more than 100',
    s.top.reduce((a, t) => a + t.share, 0) <= 100, true)
  eq('a first note takes the year from nothing to itself',
    [s.before.landings, s.after.landings, s.after.value], [0, 1, 111800.76])
  console.log('      (real sample note: ' + s.rows + ' rows, ' + s.species + ' species, '
    + s.buyers + ' buyers, £' + s.value.toLocaleString('en-GB') + ')')
} else {
  console.log('ok    (sample note not built — run scripts/make-sample-docs.mjs)')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
