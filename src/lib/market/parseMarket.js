// Daily market price-sheet parser (pdf.js, in-browser).
// Auto-detects three layouts and normalises to one shape:
//   Peterhead (Don Fishing)  — two side-by-side blocks, LOW/HIGH/AVE, GBP
//   Denmark fiskeauktion.dk  — Species/Sort/Kilo/Avg/Max, GBP
//   Denmark Hanstholm report — Species/Sort/Avg/Max, comma decimals, GBP
// Coordinate-based column assignment (validated against pdfplumber output
// on the real June 2026 sheets), so it survives the run-together text that
// plain extraction produces on the Danish reports.
import {
  pdSpecies, pdGuideName, dkSpeciesAndPresentation, dkGrade, parsePdDate, parseDkDate, num,
} from './marketCanon.js'
// One pdf.js for the whole app, bundled rather than fetched from a CDN — this
// parser runs on a boat with a PDF already on the device.
import { ensurePdfjs } from '../pdfjs.js'


// pdf -> [{ page, rows:[{ y, items:[{x,str}] }] }]
async function extractPages(pdf) {
  const pages = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const rows = []
    for (const it of tc.items) {
      const str = (it.str || '').trim()
      if (!str) continue
      const x = it.transform[4], y = it.transform[5]
      let row = rows.find(r => Math.abs(r.y - y) < 2.2)
      if (!row) { row = { y, items: [] }; rows.push(row) }
      row.items.push({ x, str })
    }
    rows.sort((a, b) => b.y - a.y)
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x))
    pages.push({ page: p, rows })
  }
  return pages
}

const GRADE_RE = /^(A[0-9]|B[0-9]|U9|-)$/

// ---------------- Peterhead ----------------
// Two blocks. Left: species<118, grade ~126, low ~164, high ~200, ave ~235.
// Right: species 295-378, grade ~382, low ~440, high ~477, ave ~517.
//
// UNSOLD — THE WORD WAS BEING EATEN BY THE SPECIES NAME (Oct 2026).
//
// The board prints "Unsold" in a PRICE column where a grade did not clear:
//
//     Hadd Chipper | A4 | Unsold | £2.35 | £1.75
//
// It is not money, not a header and not a grade, so it fell through to the
// last branch and was pushed onto the species label. Proved by instrumenting
// the parser over the real 12-10-2026 sheet rather than by reading it:
//
//     LABEL=[Hadd Seed]             -> subgrade=Seed      correct
//     LABEL=[Hadd Chipper Unsold]   -> subgrade=null      lost
//     LABEL=[Round Whiting Unsold]  -> subgrade=null      lost
//
// ONE CAUSE, THREE SYMPTOMS, and David reported two of them:
//
//   1. THE SUBGRADE WENT. `PD_SUBGRADE` is an exact-match map, so "Hadd
//      Chipper" resolves and "Hadd Chipper Unsold" does not. The day's three
//      A4 haddock lines all came back as a bare "Haddock A4" — three
//      identical rows on the page with no way to tell chipper from metro
//      from round, which is exactly what he was looking at.
//
//   2. NOTHING RECORDED THAT IT WAS UNSOLD. `num()` already refuses the word,
//      so `low` came out null — and a null low is how the page says "no
//      figure". A grade that did not sell and a figure nobody printed looked
//      identical, which is the complaint: "system doesn't say that".
//
//   3. AND ON A LABEL THE SPECIES MAP DOES NOT KNOW, THE WORD BECAME THE
//      SPECIES. `market_prices` carries 4 rows under the invented species
//      "Fresh S UNSOLD" and "Fresh XS UNSOLD" — squid grades, which have no
//      entry in either map, so the whole label including the word was kept.
//      Phantom fish in the record of the board.
//
// Measured across the live board: 359 rows over 24 species/grade combinations
// carry a null low beside a real high or ave, back to 26-09-2024. Every one is
// an unsold line that lost the word — it is not a haddock problem.
//
// `unsold` is recorded on the row and the column is NULLABLE: true and false
// are what the parser read, and null is a row filed before any of this, where
// the honest answer is that nobody knows. Defaulting the history to false
// would assert about sixty thousand rows that they cleared, when 359 did not.
function parsePd(pages, fullText) {
  const price_date = parsePdDate(fullText)
  const warnings = []
  const prices = []
  const volumes = []
  const meta = { boats: null, consignments: null, total_boxes: null }

  /* THE BOARD MOVED ONTO THE GRADING TABLE'S OWN CODES — 21 Oct 2026.
   *
   * David: "Don Co have updated their prices to match the grading finally!!"
   *
   *   before   Cod A1 Large · A2 Sprags · A3 Medium · A4 Selected · A5 Small
   *   after    Cod 1a · 1b · 1c · 2 · 3 · 4 · 5a · 5b
   *
   * They are the codes on the Peterhead grading table AND on the boat's own
   * day tally (`XL (1a)`, `Chipper (2b)`, `M Metro (4)`), so a tally grade and
   * a board price can finally be joined on the code instead of bridged by
   * name. The sheet itself settles which half is authoritative:
   *
   *   "THE BY NAMES LISTED NEXT TO THE GRADES ARE NOT DEFINITIVE AND MAY BE
   *    INTERPRETED DIFFERENTLY, PROVIDED AS A GUIDE ONLY."
   *
   * So the CODE identifies the grade and the printed name is kept only as the
   * guide it says it is.
   *
   * NONE of the new codes matched the old `A[0-9]|B[0-9]|U9|-`, so every one
   * of them fell through to the species label — the same shape as the Unsold
   * bug below, and measured on the real sheet it was worse: all 44 rows lost
   * their grade, six took a grade code as their SPECIES (U9b, U9c, U9d, "3"),
   * and cod's eight lines came back as eight rows all called "Cod" with
   * nothing to tell them apart.
   *
   * A bare digit cannot be confused with the volumes block: those counts are
   * two to four digits ("Boxes 1350", "Cod 267") and this is anchored. */
  const GRADE = /^(A[0-9]|B[0-9]|U9|-|[0-9][a-f]?|U9[a-f])$/i
  /* WRITTEN THE WAY THE GRADING TABLE WRITES IT — digit then a LOWERCASE size
   * letter, `1a` / `2b` / `U9a`. The boat's own day tally spells them the same
   * way (`Chipper (2b)`, `M Metro (4)`), and the whole point of the board
   * moving onto these codes is that the two can be joined on them; upper-casing
   * would put a `.toLowerCase()` at every future call site instead.
   * The legacy `A1` / `B2` / `U9` keep their upper case, so nothing already
   * filed reads differently. */
  const normGrade = (s) => {
    const t = s.trim()
    if (/^u9[a-f]$/i.test(t)) return 'U9' + t.slice(2).toLowerCase()
    if (/^[0-9][a-f]$/i.test(t)) return t[0] + t[1].toLowerCase()
    return t.toUpperCase()
  }
  const isMoney = s => /^£?\d[\d,]*\.\d{2}$/.test(s)
  const isHdr = s => /^(LOW|HIGH|AVE)$/i.test(s)
  /* THE BOARD PRINTS "Unsold" IN A PRICE COLUMN, and it is a STATE, not a
     price and not part of the fish's name. See UNSOLD below. */
  const isUnsold = s => /^unsold$/i.test(s)

  // 1. Anchor on the "LOW HIGH AVE  LOW HIGH AVE" header row, so column
  //    positions are read off each sheet instead of hard-coded (templates
  //    have shifted over the years — 2022 sits at different x than 2026).
  let cols = null
  for (const pg of pages) {
    for (const r of pg.rows) {
      const lo = r.items.filter(i => /^LOW$/i.test(i.str)).sort((a, b) => a.x - b.x)
      const hi = r.items.filter(i => /^HIGH$/i.test(i.str)).sort((a, b) => a.x - b.x)
      const av = r.items.filter(i => /^AVE$/i.test(i.str)).sort((a, b) => a.x - b.x)
      if (lo.length >= 2 && hi.length >= 2 && av.length >= 2) {
        cols = {
          left: { low: lo[0].x, high: hi[0].x, ave: av[0].x },
          right: { low: lo[1].x, high: hi[1].x, ave: av[1].x },
        }
        break
      }
    }
    if (cols) break
  }
  if (!cols) {
    warnings.push('Could not find the LOW/HIGH/AVE header row')
    return { source: 'PD', price_date, meta, prices, volumes, warnings }
  }

  // 2. Detect where the right block's species column starts (leftmost text
  //    token sitting right of the left AVE column), to split the two blocks
  //    without guessing — the right block's species is its leftmost element.
  let rightSpeciesX = Infinity
  for (const pg of pages) for (const r of pg.rows) for (const i of r.items) {
    // "Unsold" is excluded for the same reason LOW/HIGH/AVE are: it sits in a
    // PRICE column and is not a species name. It has never yet been the
    // leftmost such token, so this is a latent trap rather than a live one —
    // but a right-block row whose species is further right than its own low
    // column would drag the block split onto a word.
    if (i.x > cols.left.ave + 5 && !isMoney(i.str) && !isHdr(i.str) && !isUnsold(i.str) && /[A-Za-z]/.test(i.str)) {
      if (i.x < rightSpeciesX) rightSpeciesX = i.x
    }
  }
  const split = isFinite(rightSpeciesX) ? (cols.left.ave + rightSpeciesX) / 2 : (cols.left.ave + cols.right.low) / 2

  const nearest = (x, c) => {
    const d = { low: Math.abs(x - c.low), high: Math.abs(x - c.high), ave: Math.abs(x - c.ave) }
    return d.low <= d.high && d.low <= d.ave ? 'low' : (d.high <= d.ave ? 'high' : 'ave')
  }

  /* A FISH IS NAMED ONCE AND ITS OTHER GRADES RUN ON BENEATH IT.
   *
   *     Squid  | U9a | £4.52 ...
   *            | U9b                      <- no prices, dropped
   *            | U9c | £3.02 ...          <- belongs to Squid
   *
   * Without carrying the name down, the grade code became the species: the
   * real sheet filed £3.85 squid under a species called "U9c", and Turbot,
   * Halibut, Tusk and Skate the same way. Six rows of invented fish.
   *
   * Carried PER BLOCK, because the two columns are independent lists, and
   * reset per page.
   *
   * IT IS UPDATED BEFORE THE NO-PRICE ROWS ARE DROPPED, and that is the whole
   * care in it. `Turbot U9a` carries no prices at all, so dropping it first
   * would leave the carry on SQUID and file Turbot's £20.84 under squid —
   * a wrong price on a real fish, which is worse than the invented one. */
  const carry = { left: null, right: null }
  for (const pg of pages) {
    carry.left = null; carry.right = null
    for (const r of pg.rows) {
      for (const side of ['left', 'right']) {
        const c = cols[side]
        const its = r.items.filter(i => side === 'left' ? i.x <= split : i.x > split)
        if (!its.length) continue
        const slot = { low: null, high: null, ave: null }
        const headTok = []
        let grade = ''
        let unsold = false
        for (const i of its) {
          if (isMoney(i.str)) { const k = nearest(i.x, c); if (slot[k] == null) slot[k] = num(i.str) }
          else if (isHdr(i.str)) { /* header row */ }
          else if (isUnsold(i.str)) unsold = true
          else if (GRADE.test(i.str)) grade = normGrade(i.str)
          else headTok.push(i.str)
        }
        const label = headTok.join(' ').trim()
        // Whatever else this row is, if it names a fish it sets the block's
        // running species — BEFORE any row is dropped for carrying no prices.
        const named = label ? pdSpecies(label) : null
        if (named && named.known) carry[side] = named.species

        // An entirely unsold grade has no figures at all and is still a fact
        // about the day — it used to be dropped with the blank rows.
        if (!unsold && slot.low == null && slot.high == null && slot.ave == null) continue

        // A row with no label of its own belongs to the fish named above it.
        // It needs a grade to be a grade row at all; without one there is
        // nothing to say which line of that fish it is, so it is left alone.
        if (!named && !(grade && carry[side])) continue
        const species = named ? named.species : carry[side]
        /* The guide name is taken ONLY off a new-ladder row. On the old board
         * `Lythe/Pollack A3` would otherwise have gained a subgrade of
         * "Pollack" — noise, and a change to four years of rows that nobody
         * asked for. Tied to the grade code, every sheet already filed reads
         * exactly as it did. */
        const subgrade = !named ? null
          : (named.subgrade || (/^([0-9][a-f]?|U9[a-f])$/.test(grade) ? pdGuideName(label) : null))
        prices.push({ source: 'PD', price_date, species, grade, subgrade, low: slot.low, high: slot.high, ave: slot.ave, unsold })
      }
    }
  }

  // Header tallies + bottom per-species box counts (single left column).
  for (const pg of pages) {
    for (const r of pg.rows) {
      const label = r.items.filter(i => i.x < 120 && /[A-Za-z]/.test(i.str)).map(i => i.str).join(' ').trim()
      const n = r.items.find(i => i.x >= 120 && i.x < 300 && /^\d+$/.test(i.str))
      if (!label || !n) continue
      const v = Number(n.str)
      if (/^boats$/i.test(label)) meta.boats = v
      else if (/^consignments$/i.test(label)) meta.consignments = v
      else if (/^boxes$/i.test(label)) meta.total_boxes = v
      else if (!/price|low|high|ave/i.test(label)) volumes.push({ source: 'PD', price_date, label, boxes: v, kg: null })
    }
  }
  if (!price_date) warnings.push('Could not read the Peterhead date')
  if (!prices.length) warnings.push('No Peterhead price rows parsed')
  return { source: 'PD', price_date, meta, prices, volumes, warnings }
}

// ---------------- Denmark: fiskeauktion.dk (GBP) ----------------
function parseDkFisk(pages, fullText) {
  const price_date = parseDkDate(fullText)
  const warnings = []
  const prices = []
  const volBySp = {}
  let total_kg = null
  for (const pg of pages) {
    for (const r of pg.rows) {
      const toks = r.items.map(i => i.str)
      if (toks[toks.length - 1] === 'GBP' && toks.length >= 5) {
        const max = toks[toks.length - 2], avg = toks[toks.length - 3]
        const kilo = toks[toks.length - 4], sort = toks[toks.length - 5]
        /* The presentation rides on the species label — "Whiting u/r". It goes
           in `subgrade`, the way Peterhead's `A4 Round` does, so a round line
           keys apart from its own gutted one instead of being blended into it
           or filed as a species of its own. */
        const { species: sp, presentation } = dkSpeciesAndPresentation(toks.slice(0, toks.length - 5).join(' '))
        prices.push({ source: 'DK', price_date, species: sp, grade: dkGrade(sort), subgrade: presentation, low: null, high: null, ave: num(avg) })
        /* VOLUME IS BY SPECIES AND STAYS THAT WAY. How much whiting crossed
           the market is one figure however it was presented, and the round
           rows used to sit under a species name that existed nowhere else. */
        const kg = num(kilo); if (kg != null) volBySp[sp] = (volBySp[sp] || 0) + kg
      }
      const line = toks.join(' ')
      const tm = line.match(/Total kilo\.?\s+([\d.,]+)/i)
      if (tm) total_kg = Number(tm[1].replace(/,/g, ''))
    }
  }
  const volumes = Object.entries(volBySp).map(([species, kg]) => ({ source: 'DK', price_date, label: species, boxes: null, kg: Math.round(kg * 100) / 100 }))
  if (!price_date) warnings.push('Could not read the Denmark (fiskeauktion) date')
  if (!prices.length) warnings.push('No Denmark (fiskeauktion) price rows parsed')
  return { source: 'DK', price_date, meta: { total_kg }, prices, volumes, warnings }
}

// ---------------- Denmark: Hanstholm report (comma decimals) ----------------
// Columns: Species | Sort | Avg | Max. Species blank on continuation rows
// (carries down). We take Avg only, per David. Per-species kg lives in a
// jumbled top grid — we keep the reliable day total and warn.
function parseDkHanstholm(pages, fullText) {
  const price_date = parseDkDate(fullText)
  const warnings = []
  const prices = []
  let total_kg = null
  const tm = fullText.match(/In total\s+([\d.,]+)\s*Kgs/i)
  if (tm) total_kg = Number(tm[1].replace(/\./g, '').replace(/,/g, '.'))

  let started = false
  let cur = null
  for (const pg of pages) {
    for (const r of pg.rows) {
      const line = r.items.map(i => i.str).join(' ')
      if (/Avg\.?\s*price/i.test(line) || /Sort/i.test(line)) { started = true; continue }
      if (!started) continue
      const name = r.items.filter(i => i.x < 160 && /[A-Za-z]/.test(i.str)).map(i => i.str).join(' ').trim()
      if (name) cur = dkSpeciesAndPresentation(name)
      const sort = r.items.find(i => i.x >= 160 && i.x < 215 && /^\d+$/.test(i.str))?.str
      const decs = r.items.filter(i => /^\d+,\d{2}$/.test(i.str)).map(i => i.str)
      if (!cur || decs.length < 1 || !sort) continue
      prices.push({ source: 'DK', price_date, species: cur.species, grade: dkGrade(sort), subgrade: cur.presentation, low: null, high: null, ave: num(decs[0]) })
    }
  }
  warnings.push('Hanstholm sheet: per-species volume not captured (use the fiskeauktion.dk export for Denmark volume)')
  if (!price_date) warnings.push('Could not read the Denmark (Hanstholm) date')
  if (!prices.length) warnings.push('No Denmark (Hanstholm) price rows parsed')
  return { source: 'DK', price_date, meta: { total_kg }, prices, volumes: [], warnings }
}

// ---------------- dispatcher ----------------
export async function parseMarketPdf(file) {
  const pdfjsLib = await ensurePdfjs()
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  try { return await parseMarketFromDoc(pdf, file.name || '') }
  finally { try { await pdf.destroy() } catch { /* ignore */ } }
}

export async function parseMarketFromDoc(pdf, filename) {
  const pages = await extractPages(pdf)
  const fullText = pages.flatMap(p => p.rows.map(r => r.items.map(i => i.str).join(' '))).join('\n')
  let res
  if (/PETERHEAD DAILY MARKET PRICES/i.test(fullText)) res = parsePd(pages, fullText)
  else if (/fiskeauktion\.dk/i.test(fullText)) res = parseDkFisk(pages, fullText)
  else if (/Hanstholm Fiskeauktion/i.test(fullText)) res = parseDkHanstholm(pages, fullText)
  else return { source: null, price_date: null, meta: {}, prices: [], volumes: [], warnings: ['Unrecognised sheet — not a Peterhead or Denmark price sheet'] }
  return { ...res, filename }
}
