// mcatch trip-report PDF parser (pdf.js, in-browser).
// Parses the "Catch details" table — one row per FAR entry with date,
// FAO species code, FAO area, statistical rectangle, EEZ and live kg —
// which carries everything quota needs, including catch dates for
// year-straddling trips. Reconciles against the printed "Totals".
//
// Validated against six real Audacious reports (mcatch-report-api
// v0.0.226): every detail row begins with a private-use icon glyph,
// so row regexes are end-anchored only, never start-anchored.
import { ensurePdfjs } from '../pdfjs.js'



// Rebuild text lines from pdf.js items: group by Y (2-unit tolerance),
// sort by X, join with spaces.
async function extractLines(pdf) {
  const lines = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const rows = []
    for (const it of tc.items) {
      const str = (it.str || '').trim()
      if (!str) continue
      const x = it.transform[4], y = it.transform[5]
      let row = rows.find(r => Math.abs(r.y - y) < 2)
      if (!row) { row = { y, items: [] }; rows.push(row) }
      row.items.push({ x, str })
    }
    rows.sort((a, b) => b.y - a.y) // top of page first
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x)
      lines.push(r.items.map(i => i.str).join(' '))
    }
  }
  return lines
}

const DETAIL = /(\d{2})-(\d{2})-(\d{4}),\s+\d{2}:\d{2}\s+\+\d{2}:\d{2}\s+([A-Z]{2,3})\s+(27\.\S+)\s+(\w{4})\s+([A-Z]{3})\s+([\d,]+\.\d{2})\s*$/
const TOTALS = /Totals\s+([\d,]+\.\d{2})\s*$/

const toNum = s => Number(String(s).replace(/,/g, ''))
const iso = (d, m, y, t) => `${y}-${m}-${d}T${t || '00:00'}:00Z`

// File -> { trip, catches, warnings }  (browser entry point)
export async function parseTripPdf(file) {
  const pdfjsLib = await ensurePdfjs()
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  return parseTripFromPdfDoc(pdf, file.name || '')
}

// Loaded pdf.js document -> { trip, catches, warnings }  (pure, testable)
export async function parseTripFromPdfDoc(pdf, filename) {
  const lines = await extractLines(pdf)
  const full = lines.join('\n')
  const warnings = []

  const g = (re) => { const m = full.match(re); return m ? m : null }
  const tripNr = g(/Trip nr:\s*([A-Z]\d+)/)?.[1] || ''
  const vessel = g(/Vessel\s+([A-Za-z0-9 ]+?)(?:\n|$)/m)?.[1]?.trim() || ''
  const dep = g(/Departure\s+(\w+)\s+@\s+(\d{2})-(\d{2})-(\d{4}),\s*(\d{2}:\d{2})/)
  const arr = g(/Arrival\s+(\w+)\s+@\s+(\d{2})-(\d{2})-(\d{4}),\s*(\d{2}:\d{2})/)
  const capLine = lines.find(l => l.includes('MAS:'))
  const captain = capLine ? capLine.split('MAS:')[1].replace(/-\s*(kg|pcs)\s*$/, '').trim() : ''

  if (!tripNr) warnings.push('No trip number found — is this an mcatch trip report?')

  // "Catch details" section only: from its header line to "Trip logbook"
  let start = lines.findIndex(l => /^Catch details\b/.test(l.replace(/^[^\w]*/, '')))
  if (start < 0) start = lines.findIndex(l => l.includes('Catch details'))
  let end = lines.length
  for (let i = Math.max(start, 0); i < lines.length; i++) {
    if (lines[i].includes('Trip logbook')) { end = i; break }
  }
  const seg = start >= 0 ? lines.slice(start, end) : []
  if (start < 0) warnings.push('No "Catch details" section found')

  const catches = []
  let printedTotal = null
  for (const line of seg) {
    const m = line.match(DETAIL)
    if (m) {
      const [, d, mo, y, sp, fao, sr, eez, kg] = m
      catches.push({
        catch_date: `${y}-${mo}-${d}`,
        species_fao: sp,
        fao_area: fao,
        sr,
        eez,
        live_kg: toNum(kg),
      })
      continue
    }
    const t = line.match(TOTALS)
    if (t) printedTotal = toNum(t[1]) // last Totals in the section wins
  }

  const sum = Math.round(catches.reduce((a, c) => a + c.live_kg, 0) * 100) / 100
  const reconcileOk = printedTotal != null ? Math.abs(sum - printedTotal) < 0.01 : null
  if (reconcileOk === false) warnings.push(`Parsed ${sum.toLocaleString()} kg vs printed Totals ${printedTotal.toLocaleString()} kg`)
  if (!catches.length) warnings.push('No catch detail rows parsed')

  return {
    trip: {
      trip_nr: tripNr,
      vessel,
      departure_port: dep?.[1] || '',
      departure_at: dep ? iso(dep[2], dep[3], dep[4], dep[5]) : null,
      arrival_port: arr?.[1] || '',
      arrival_at: arr ? iso(arr[2], arr[3], arr[4], arr[5]) : null,
      captain,
      total_live_kg: sum,
      printed_total_kg: printedTotal,
      reconcile_ok: reconcileOk,
      filename: filename || '',
    },
    catches,
    warnings,
  }
}
