/* PETERHEAD AGAINST DENMARK, ON THE SAME SIZE OF FISH.
 *
 * David, Oct 2026: *"check pd grading table and hanstholm sorts (grades) and
 * look for similarities for comparing price market vs market."*
 *
 * The comparison on the page matched grades on the A-NUMBER — Peterhead A3
 * against Denmark A3 — and blended haddock by a hand-written list of tiers.
 * Two things were wrong with that, and the first is fatal as of today:
 *
 *   1. PETERHEAD STOPPED PRINTING A-NUMBERS on 21-10-2026. `A(\d)` finds
 *      nothing in `2a` or `4a+4b+4c`, so every species fell into the
 *      "neither board grades this" branch and collapsed to one All sizes
 *      row — and haddock, whose tiers were spelled `A3 Seed`, matched
 *      nothing at all and dropped off the table completely.
 *   2. THE A-NUMBERS WERE NEVER THE SAME FISH ANYWAY. Denmark numbers cod
 *      and hake from 0, so their A1 cod is 7-12 kg against Peterhead's old
 *      A1 at 10 kg and up. Lining up two ladders by position is a guess;
 *      both markets PUBLISH their weight bands, so it is measurable.
 *
 * So the pairing comes off `gradeBridge.js`, which holds both documents'
 * bands as transcribed — and which was written for this question and then
 * wired to nothing, the "built and never called" fault this repo has
 * shipped three times.
 *
 * SEVERAL PETERHEAD GRADES INSIDE ONE DANISH SIZE ARE BLENDED, which is what
 * the haddock tiers were doing by hand. Derived from the bands, it also
 * covers every other species, and it cannot drift from the documents.
 */
import { bridgeFor, NOT_COMPARABLE, bandText, UNGUTTED } from './gradeBridge.js'

const SP_SYNONYM = {
  catfishes: 'catfish', wolffish: 'catfish', 'witch flounder': 'witch',
  coley: 'saithe', monk: 'monkfish', monks: 'monkfish', anglerfish: 'monkfish',
  lythe: 'pollack',
}
export const canonSp = (x) => {
  const k = String(x || '').trim().toLowerCase()
  return SP_SYNONYM[k] || k
}
/** Title Case, to look a species up in the bridge tables. */
const bridgeName = (k) => k.charAt(0).toUpperCase() + k.slice(1)

/* Denmark's board is keyed A0-A9 and its published sorts are numbered, so the
 * leading A comes off. A9 is their catch-all and matches no published band. */
const dkSort = (g) => {
  const m = String(g || '').match(/^A(\d)$/i)
  return m ? m[1] : null
}

const meanOf = (arr) => {
  const v = arr.filter((x) => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/* THE LINE'S OWN CODE, NOT ITS HISTORY GROUP, and the distinction matters.
 * `histKey` groups haddock 1a, 1b and 1c because ONE old Peterhead row
 * covered all three — that is the right key for a four-year series and the
 * wrong one here. Both boards are being read on the SAME DAY, so today's
 * printed lines are what to compare; keyed on the group, lemon 3a would be
 * compared as "3a+3b" on the strength of a line the board stopped printing. */
const codesOf = (item) => [item.code || item.grade]

/* The outer edge of a set of bands: the smallest fish in the group to the
 * largest, open-topped where the top grade is. Listing each band separately
 * ran to three lines of text in a table column. */
function spanOf(hits) {
  const from = Math.min(...hits.map((h) => h.from))
  const open = hits.some((h) => h.to == null)
  const to = open ? null : Math.max(...hits.map((h) => h.to))
  return bandText(from, to)
}

/**
 * Line up one species' Peterhead lines against Denmark's.
 *
 * Returns rows of { grade, pd, dk, fit, bands } where `fit` is:
 *   exact     identical weight band. The prices are for the same fish.
 *   blend     several Peterhead grades inside one Danish size, averaged.
 *             Fair against the group; not against any one of them.
 *   loose     the bands overlap but neither contains the other. Shown, and
 *             worth less than the others.
 */
export function compareSpecies(pdItems, dkItems, speciesKey) {
  const rows = bridgeFor(bridgeName(speciesKey))
  if (!rows) return { rows: [], note: NOT_COMPARABLE[bridgeName(speciesKey)] || null }

  const byCode = new Map(rows.map((r) => [r.code, r]))
  const dkPrice = new Map()
  for (const it of dkItems) {
    const s = dkSort(it.grade)
    if (s != null && it.ave != null) dkPrice.set(s, it.ave)
  }

  /* Group the Peterhead lines by the Danish size(s) they fall in, so grades
     sharing one Danish size are compared together rather than each against
     the same figure — which would read as three findings when it is one. */
  const buckets = new Map()
  for (const it of pdItems) {
    if (it.ave == null) continue
    const hits = codesOf(it).map((c) => byCode.get(c)).filter(Boolean)
    if (!hits.length) continue
    /* A line already blended by the ladder change can straddle Danish sizes;
       take every size its codes touch. */
    const sorts = [...new Set(hits.flatMap((h) => h.dk))].sort()
    if (!sorts.length) continue
    const k = sorts.join('+')
    if (!buckets.has(k)) buckets.set(k, { sorts, pd: [], names: [], fits: new Set(), hits: [] })
    const b = buckets.get(k)
    b.pd.push(it.ave)
    b.names.push(it.grade)
    for (const h of hits) { b.fits.add(h.fit); b.hits.push(h) }
  }

  const out = []
  for (const [, b] of buckets) {
    const dk = meanOf(b.sorts.map((s) => dkPrice.get(s) ?? null))
    const pd = meanOf(b.pd)
    if (pd == null || dk == null) continue
    /* ONE PETERHEAD LINE AND ONE DANISH SIZE OF THE SAME BAND IS THE ONLY
       CASE WORTH QUOTING WITHOUT A CAVEAT. Anything averaged is a blend, and
       says so, so nobody reads a group figure as a grade's own price. */
    const blended = b.pd.length > 1 || b.sorts.length > 1
      || b.fits.has('pdFiner') || b.fits.has('dkFiner')
    const fit = blended ? 'blend' : (b.fits.has('exact') ? 'exact' : 'loose')
    /* AN UNGUTTED PETERHEAD GRADE IS NOT THE SAME FISH as a Danish size of
       the same kilos, because the guts are in the weight — so the row says so
       instead of reading as a clean price difference. Hanstholm's published
       sorts do not state a presentation, so this is a caveat and not a
       correction: nothing is adjusted, only labelled. */
    const ungutted = (UNGUTTED[bridgeName(speciesKey)] || [])
      .some((c) => b.hits.some((h) => h.code === c))
    out.push({
      grade: b.names.join(' + '),
      dkGrade: b.sorts.map((s) => 'A' + s).join(' + '),
      band: spanOf(b.hits),
      from: Math.min(...b.hits.map((h) => h.from)),
      pd, dk, fit, ungutted,
    })
  }
  /* BIGGEST FISH FIRST, which is how both boards read — sorted on the band's
     own kilos, not on the text of it. Sorting the label put hake Selected,
     Pencil and Small in that order, because "1.2-2.5" sorts above "0.28-0.6"
     above "0.6-1.2" as a string. */
  out.sort((a, b) => b.from - a.from)
  return { rows: out, note: null }
}

/**
 * The whole comparison, from the two boards `buildBoard` produced.
 *
 * `species` on a Peterhead line is the board's own word, so it is canonicalised
 * before being matched — Denmark writes Catfishes and Coley where Peterhead
 * writes Catfish and Saithe.
 */
export function compareBoards(pdBoard, dkBoard) {
  const pdBy = {}, dkBy = {}
  for (const it of pdBoard.items) (pdBy[canonSp(it.species)] = pdBy[canonSp(it.species)] || []).push(it)
  for (const it of dkBoard.items) (dkBy[canonSp(it.species)] = dkBy[canonSp(it.species)] || []).push(it)

  const groups = [], skipped = []
  for (const sp of Object.keys(pdBy).filter((s) => dkBy[s]).sort()) {
    const { rows, note } = compareSpecies(pdBy[sp], dkBy[sp], sp)
    if (rows.length) groups.push({ species: pdBy[sp][0].species, rows })
    /* A SPECIES THAT COULD NOT BE LINED UP SAYS SO. Dropping it silently
       looks identical to a species neither market landed, and they are
       different facts — the reasons are in `NOT_COMPARABLE`. */
    else skipped.push({ species: pdBy[sp][0].species, note })
  }
  return { date: pdBoard.date, dkDate: dkBoard.date, groups, skipped }
}
