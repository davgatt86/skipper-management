// Daily market price-sheet parser (pdf.js, in-browser).
// Auto-detects three layouts and normalises to one shape:
//   Peterhead (Don Fishing)  — two side-by-side blocks, LOW/HIGH/AVE, GBP
//   Denmark fiskeauktion.dk  — Species/Sort/Kilo/Avg/Max, GBP
//   Denmark Hanstholm report — Species/Sort/Avg/Max, comma decimals, GBP
// Coordinate-based column assignment (validated against pdfplumber output
// on the real June 2026 sheets), so it survives the run-together text that
// plain extraction produces on the Danish reports.
import {
  pdSpecies, dkSpecies, dkGrade, parsePdDate, parseDkDate, num,
} from './marketCanon.js'

const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res()
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src))
    document.body.appendChild(s)
  })
}
async function ensurePdfjs() {
  if (!window.pdfjsLib) {
    await loadScript(PDFJS_SRC)
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  }
  return window.pdfjsLib
}

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
function parsePd(pages, fullText) {
  const price_date = parsePdDate(fullText)
  const warnings = []
  const prices = []
  const volumes = []
  const meta = { boats: null, consignments: null, total_boxes: null }

  const GRADE = /^(A[0-9]|B[0-9]|U9|-)$/i
  const isMoney = s => /^£?\d[\d,]*\.\d{2}$/.test(s)
  const isHdr = s => /^(LOW|HIGH|AVE)$/i.test(s)

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
    if (i.x > cols.left.ave + 5 && !isMoney(i.str) && !isHdr(i.str) && /[A-Za-z]/.test(i.str)) {
      if (i.x < rightSpeciesX) rightSpeciesX = i.x
    }
  }
  const split = isFinite(rightSpeciesX) ? (cols.left.ave + rightSpeciesX) / 2 : (cols.left.ave + cols.right.low) / 2

  const nearest = (x, c) => {
    const d = { low: Math.abs(x - c.low), high: Math.abs(x - c.high), ave: Math.abs(x - c.ave) }
    return d.low <= d.high && d.low <= d.ave ? 'low' : (d.high <= d.ave ? 'high' : 'ave')
  }

  for (const pg of pages) {
    for (const r of pg.rows) {
      for (const side of ['left', 'right']) {
        const c = cols[side]
        const its = r.items.filter(i => side === 'left' ? i.x <= split : i.x > split)
        if (!its.length) continue
        const slot = { low: null, high: null, ave: null }
        const headTok = []
        let grade = ''
        for (const i of its) {
          if (isMoney(i.str)) { const k = nearest(i.x, c); if (slot[k] == null) slot[k] = num(i.str) }
          else if (isHdr(i.str)) { /* header row */ }
          else if (GRADE.test(i.str)) grade = i.str.toUpperCase()
          else headTok.push(i.str)
        }
        if (slot.low == null && slot.high == null && slot.ave == null) continue
        const label = headTok.join(' ').trim()
        if (!label) continue
        const { species, subgrade } = pdSpecies(label)
        prices.push({ source: 'PD', price_date, species, grade, subgrade, low: slot.low, high: slot.high, ave: slot.ave })
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
        const sp = dkSpecies(toks.slice(0, toks.length - 5).join(' '))
        prices.push({ source: 'DK', price_date, species: sp, grade: dkGrade(sort), subgrade: null, low: null, high: null, ave: num(avg) })
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
      if (name) cur = dkSpecies(name)
      const sort = r.items.find(i => i.x >= 160 && i.x < 215 && /^\d+$/.test(i.str))?.str
      const decs = r.items.filter(i => /^\d+,\d{2}$/.test(i.str)).map(i => i.str)
      if (!cur || decs.length < 1 || !sort) continue
      prices.push({ source: 'DK', price_date, species: cur, grade: dkGrade(sort), subgrade: null, low: null, high: null, ave: num(decs[0]) })
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
