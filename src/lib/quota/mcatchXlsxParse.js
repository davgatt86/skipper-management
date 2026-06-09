// mcatch trip-report XLSX parser (SheetJS, in-browser).
//
// mcatch can export the same trip report as an Excel workbook as well as a
// PDF. The workbook splits the report across many sheets; the ones we need:
//   'trip summary'        one row: identifier, vessel, dep/arr dates+ports,
//                         masters, total_catch_weight  -> the trip header
//   'catch details table' one row per FAR catch line, carrying activity_date
//                         AND the FAO components AND economical zone AND ICES
//                         rectangle together -> the exact analog of the PDF
//                         "Catch details" rows, so year-straddling trips split
//                         per row by catch date with no apportioning needed
//   'Catch by species'    per-species totals -> reconciliation target
//   'catch by zone'       per-species-per-zone totals (no dates)  } fallback
//   'catch by day'        per-species-per-day totals (no zone)    } only
//
// Primary path reads 'catch details table' (validated to reconcile to the
// penny against 'Catch by species' on six real Audacious exports, including
// the 2023/2024 straddler C2100420230305 → 34,066.9 / 2,559.3 kg). The note
// that planned this build assumed the details sheet lacked a zone; the real
// exports carry it, so we use it directly and keep catch-by-zone +
// catch-by-day apportioning only as a fallback for exports where the details
// sheet has been filtered out.
//
// Output shape is identical to mcatchParse.parseTripPdf: { trip, catches,
// warnings }, so Quota.jsx's existing trip-insert path is unchanged.
//
// Dates are read from each Date's LOCAL components, never toISOString(): in
// the skipper's timezone (UK, BST in summer) toISOString would shift a
// post-midnight 1-Jan row back into 31-Dec and corrupt the straddle split.
import * as XLSX from 'xlsx'

const num = v => (typeof v === 'number' && isFinite(v) ? v : (v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const pad = n => String(n).padStart(2, '0')

// Local-calendar date 'YYYY-MM-DD' from a JS Date (SheetJS sets local
// components to match the Excel cell, so local getters are timezone-safe).
function dOnly(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  if (typeof v === 'string') { const m = v.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}` }
  return null
}
// Local clock time stamped with Z (matches the PDF parser's iso()), so the
// stored timestamp's date portion is the vessel's local calendar date — which
// is what the position engine slices for the "since statement" comparison.
function tStamp(v) {
  if (!(v instanceof Date) || isNaN(v)) return null
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}:00Z`
}

// Build a dotted FAO area string from the component columns, matching the PDF
// parser's format: '27.4.a', '27.6.a', '27.6.b.2'. Omits empty levels.
function buildArea(rec) {
  const parts = [rec.fao_area, rec.fao_subarea, rec.fao_division, rec.fao_subdivision, rec.fao_unit]
    .map(c => (c == null ? '' : String(c).trim()))
    .filter(Boolean)
  if (parts.length) return parts.join('.')
  // some exports pre-assemble it in fao_zone
  return rec.fao_zone ? String(rec.fao_zone).trim() : ''
}

// Read a sheet as array-of-objects keyed by its header row (header-anchored,
// resilient to column reordering). Returns [] for a missing/empty sheet.
function sheetRecords(wb, name) {
  const ws = wb.Sheets[name]
  if (!ws) return []
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false })
  if (!grid.length) return []
  const hdr = grid[0].map(h => (h == null ? '' : String(h).trim()))
  const out = []
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]
    if (!row || !row.some(c => c != null && c !== '')) continue
    const rec = {}
    for (let c = 0; c < hdr.length; c++) if (hdr[c]) rec[hdr[c]] = row[c] == null ? null : row[c]
    out.push(rec)
  }
  return out
}

// Case-insensitive sheet-name resolver (mcatch capitalisation has drifted:
// 'Catch by species' vs 'catch by zone').
function sheetName(wb, want) {
  const lc = want.toLowerCase()
  return wb.SheetNames.find(n => n.toLowerCase() === lc) || null
}

const toNum = v => (typeof v === 'number' && isFinite(v) ? v : Number(String(v ?? '').replace(/,/g, '')) || 0)

// arrayBuffer -> { trip, catches, warnings }
export function parseTripXlsx(buf, filename) {
  const warnings = []
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const SN = n => sheetName(wb, n)

  // ---- guard: don't let an AFPO holdings file in through the trip button ----
  const firstWs = wb.Sheets[wb.SheetNames[0]]
  const a1 = firstWs ? String((XLSX.utils.sheet_to_json(firstWs, { header: 1, range: 'A1:A3' })[0] || [])[0] || '') : ''
  if (!SN('trip summary') && /ITQ\s*CATCHES/i.test(a1)) {
    return { trip: blankTrip(filename), catches: [], warnings: ['This looks like an AFPO holdings file — upload it with the "AFPO holdings" button instead.'] }
  }

  // ---------- trip header (trip summary, single data row) ----------
  const summary = sheetRecords(wb, SN('trip summary'))[0] || {}
  const tripNr = String(summary.identifier || '').trim()
  const vessel = String(summary.vessel_name || summary.vessel || '').trim()
  const masters = String(summary.masters || '')
  const captain = masters.includes('MAS:')
    ? masters.split('MAS:').pop().replace(/-\s*(kg|pcs)\s*$/i, '').trim()
    : masters.replace(/-\s*(kg|pcs)\s*$/i, '').trim()
  const depAt = tStamp(summary.departure_date)
  const arrAt = tStamp(summary.arrival_date) || tStamp(summary.landing_date)
  const summaryTotal = num(summary.total_catch_weight)

  if (!tripNr) warnings.push('No trip identifier found — is this an mcatch trip-report workbook?')

  // ---------- reconciliation target: Catch by species ----------
  const speciesRows = sheetRecords(wb, SN('Catch by species'))
  const speciesTotals = {}            // FAO code -> kg
  for (const r of speciesRows) {
    const sp = String(r.fish_specie || '').trim()
    if (!sp) continue
    speciesTotals[sp] = (speciesTotals[sp] || 0) + toNum(r.catch_weight)
  }
  const speciesGrand = Object.values(speciesTotals).reduce((a, b) => a + b, 0)
  // Reconciliation anchor: the 'Catch by species' grand total. It is the
  // direct analog of the PDF "Totals" and recomputes from the catch lines, so
  // it reconciles to the detail table on every export era. The trip-summary
  // 'total_catch_weight' header is NOT used for reconciliation — in newer
  // mcatch exports it carries a different figure (a landed / pre-correction
  // weight) that no longer equals the catch breakdown.
  const printedTotal = speciesGrand || (summaryTotal != null ? summaryTotal : null)

  // ---------- catches ----------
  let catches = []
  let usedFallback = false
  const detailRows = sheetRecords(wb, SN('catch details table'))

  if (detailRows.length) {
    // PRIMARY: per-row date + zone + eez + rectangle, aggregate identical rows
    const agg = new Map()             // key -> {catch_date, species_fao, fao_area, sr, eez, live_kg}
    for (const r of detailRows) {
      const sp = String(r.fish_specie || '').trim()
      if (!sp) continue
      const kg = toNum(r.catch_weight)
      const date = dOnly(r.activity_date)
      if (!date) { warnings.push(`A ${sp} catch row had no usable activity date — skipped.`); continue }
      const area = buildArea(r)
      const eez = String(r.economical_zone || '').trim()
      const sr = String(r.ices_rectangle || '').trim()
      const key = `${date}|${sp}|${area}|${eez}|${sr}`
      const e = agg.get(key) || { catch_date: date, species_fao: sp, fao_area: area, sr, eez, live_kg: 0 }
      e.live_kg += kg
      agg.set(key, e)
    }
    catches = [...agg.values()].map(c => ({ ...c, live_kg: Math.round(c.live_kg * 100) / 100 }))
  } else {
    // FALLBACK: no per-haul detail sheet. Combine 'catch by zone' (zone+eez,
    // no dates) with 'catch by day' (dates, no zone) by apportioning each
    // zone-row's weight across the species' daily profile. Straddle split is
    // therefore approximate — flagged below.
    usedFallback = true
    const zoneRows = sheetRecords(wb, SN('catch by zone'))
    const dayRows = sheetRecords(wb, SN('catch by day'))
    const daysBySp = {}               // sp -> [{date, kg}]
    for (const r of dayRows) {
      const sp = String(r.fish_specie || '').trim(); if (!sp) continue
      const date = dOnly(r.activity_date); const kg = toNum(r.catch_weight)
      if (!date) continue
      ;(daysBySp[sp] = daysBySp[sp] || []).push({ date, kg })
    }
    const arrDate = arrAt ? arrAt.slice(0, 10) : (depAt ? depAt.slice(0, 10) : null)
    for (const r of zoneRows) {
      const sp = String(r.fish_specie || '').trim(); if (!sp) continue
      const kgZone = toNum(r.catch_weight)
      const area = buildArea(r)
      const eez = String(r.economical_zone || '').trim()
      const days = daysBySp[sp] || []
      const dayTotal = days.reduce((a, d) => a + d.kg, 0)
      if (!days.length || dayTotal <= 0) {
        catches.push({ catch_date: arrDate, species_fao: sp, fao_area: area, sr: '', eez, live_kg: r2(kgZone) })
        continue
      }
      for (const d of days) {
        const part = kgZone * (d.kg / dayTotal)
        if (Math.abs(part) < 1e-9) continue
        catches.push({ catch_date: d.date, species_fao: sp, fao_area: area, sr: '', eez, live_kg: Math.round(part * 100) / 100 })
      }
    }
    if (catches.length) warnings.push('No per-haul detail sheet in this workbook — catch dates were apportioned from daily totals, so any year-straddle split is approximate.')
  }

  // ---------- reconcile ----------
  const parsedSum = r2(catches.reduce((a, c) => a + (c.live_kg || 0), 0))
  let reconcileOk = null
  if (printedTotal != null) {
    reconcileOk = Math.abs(parsedSum - r2(printedTotal)) < 0.05
    if (!reconcileOk) warnings.push(`Parsed ${parsedSum.toLocaleString()} kg vs report total ${r2(printedTotal).toLocaleString()} kg`)
  }
  // cross-check the species breakdown agrees with the catch detail rows
  // (this is the real integrity check; the summary header is intentionally
  // not compared, see note above).
  // per-species reconciliation against Catch by species (catches us if a
  // species was dropped or double-counted, independent of the grand total)
  if (Object.keys(speciesTotals).length) {
    const bySp = {}
    for (const c of catches) bySp[c.species_fao] = (bySp[c.species_fao] || 0) + (c.live_kg || 0)
    const off = []
    for (const sp of new Set([...Object.keys(speciesTotals), ...Object.keys(bySp)])) {
      if (Math.abs(r2(bySp[sp] || 0) - r2(speciesTotals[sp] || 0)) >= 0.05) off.push(sp)
    }
    if (off.length) warnings.push(`Per-species totals don't match the report for: ${off.join(', ')}`)
  }
  if (!catches.length) warnings.push('No catch rows parsed')

  return {
    trip: {
      trip_nr: tripNr,
      vessel,
      departure_port: String(summary.departure_port || '').trim(),
      departure_at: depAt,
      arrival_port: String(summary.arrival_port || summary.landing_port || '').trim(),
      arrival_at: arrAt,
      captain,
      total_live_kg: parsedSum,
      printed_total_kg: printedTotal != null ? r2(printedTotal) : null,
      reconcile_ok: reconcileOk,
      filename: filename || '',
    },
    catches,
    warnings,
  }
}

function blankTrip(filename) {
  return {
    trip_nr: '', vessel: '', departure_port: '', departure_at: null,
    arrival_port: '', arrival_at: null, captain: '',
    total_live_kg: 0, printed_total_kg: null, reconcile_ok: null, filename: filename || '',
  }
}
