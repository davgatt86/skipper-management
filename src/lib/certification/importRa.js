/* READING AN EXISTING RISK ASSESSMENT OFF ITS OWN PDF.
 *
 * David keeps twelve in Aegir and asked to bring them in rather than retype
 * fifty-odd hazards. They export as REAL TEXT PDFs — 16 fonts, no images — so
 * this reads them rather than transcribing them.
 *
 * THE COLUMNS ARE POSITIONAL, NOT DELIMITED. Grouped by line alone the columns
 * interleave into nonsense, because a wrapped cell puts the tail of column two
 * beside the tail of column four:
 *
 *   9 Gear coming stuck on sea bed Falling into the water leading to lifejackets
 *   18/07/2023 hypothermia or drowning trained on man overboard injury
 *
 * So each text item is placed by its x, the same way the P&J sales note is
 * read. Measured off the real documents, not guessed: the six columns start at
 * x = 45, 125, 283, 456, 621 and 734 on a 842pt landscape page.
 */

/** The six columns of the Aegir sheet, by where they start. */
export const COLUMNS = [
  { key: 'ref', from: 0, to: 120 },        // risk id, and the date under it
  { key: 'hazard', from: 120, to: 280 },   // Hazard Area/Activity
  { key: 'risk', from: 280, to: 450 },     // Risk
  { key: 'controls', from: 450, to: 615 }, // Controls in place
  { key: 'outcomes', from: 615, to: 730 }, // Risk Outcomes
  { key: 'level', from: 730, to: 1e6 },    // Risk Level
]

/* Rows that are furniture rather than content. `Comments:` and the signature
   line close a hazard block; the header repeats on every page. */
const FURNITURE = [
  /^risk id\b/i, /^comments:/i, /^reviewed by:/i, /^powered by tcpdf/i,
]
const isFurniture = (s) => FURNITURE.some((re) => re.test(s.trim()))

const colOf = (x) => COLUMNS.find((c) => x >= c.from && x < c.to)?.key || 'level'

/** pdf.js text items -> lines, each line split into its six columns. */
export function toRows(items = []) {
  const byY = new Map()
  for (const it of items) {
    if (!it || !String(it.str).trim()) continue
    const y = Math.round(it.transform[5])
    if (!byY.has(y)) byY.set(y, [])
    byY.get(y).push({ x: it.transform[4], s: String(it.str) })
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])                       // top of the page first
    .map(([, parts]) => {
      const cols = {}
      for (const p of parts.sort((a, b) => a.x - b.x)) {
        const k = colOf(p.x)
        cols[k] = ((cols[k] || '') + ' ' + p.s).replace(/\s+/g, ' ').trim()
      }
      return cols
    })
}

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const ID = /^(\d{1,4})$/

/**
 * Rows -> hazards.
 *
 * A NEW HAZARD STARTS WHERE THE FIRST COLUMN CARRIES A RISK ID. Everything
 * after it, until the next id or a `Comments:` line, is continuation of the
 * same hazard's cells — which is what makes the wrapping harmless.
 */
export function hazardsFromRows(rows = []) {
  const out = []
  let cur = null
  const push = () => { if (cur && cur.hazard) out.push(cur) }

  for (const r of rows) {
    const joined = Object.values(r).join(' ')
    if (isFurniture(joined)) {
      /* A signature line ends the block. The NEXT id opens the next one. */
      if (/^comments:|^reviewed by:/i.test(joined.trim())) { push(); cur = null }
      continue
    }

    const first = (r.ref || '').trim()
    if (ID.test(first)) {
      push()
      cur = { ref: first, assessedOn: null, hazard: '', risk: '', controls: '', outcomes: '', level: '' }
    }
    if (!cur) continue

    /* The date sits under the id in the same column. */
    const d = first.match(DATE)
    if (d) cur.assessedOn = `${d[3]}-${d[2]}-${d[1]}`

    for (const k of ['hazard', 'risk', 'controls', 'outcomes', 'level']) {
      if (r[k]) cur[k] = (cur[k] ? cur[k] + ' ' : '') + r[k]
    }
  }
  push()

  return out.map((h) => ({
    ref: h.ref,
    assessedOn: h.assessedOn,
    hazard: tidy(h.hazard),
    /* THE APP HAS NO CONSEQUENCE COLUMN and Aegir has two — Risk and Risk
       Outcomes. Folded into one `consequence`, because dropping them would
       lose the half of the document that says why the hazard matters. */
    consequence: tidy([h.risk, h.outcomes].filter(Boolean).join('. ')),
    controls: tidy(h.controls),
    /* HIS OWN WORDED LEVEL, kept as text and never turned into numbers. He
       asked for them unrated so he can rate them himself, and this is what he
       will rate them FROM — a Low/Medium/High converted to a likelihood and a
       severity would be an invention wearing his judgement's clothes. */
    sourceLevel: tidy(h.level).replace(/\s*risk$/i, '') || null,
  }))
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** The title, off the cover page: "Risk Assessment Review for X". */
export function titleFromCover(lines = []) {
  const joined = lines.join(' ').replace(/\s+/g, ' ')
  const m = joined.match(/Risk Assessment Review\s+for\s+(.+?)(?:\s+[A-Z][A-Z\s]*–|\s*$)/)
  return m ? tidy(m[1]) : ''
}
