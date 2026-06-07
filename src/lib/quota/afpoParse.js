// AFPO "Current Quota Holdings" xlsx parser (SheetJS, in-browser).
// Validated against the 2025 and 2026 Audacious files:
//  - columns A..M are stable across both years
//  - 2026 adds "Scientific Quota" in column O
//  - column N carries side-note FQA figures (Norway Ling, WS Sole)
//  - sections: North Sea / West Coast / Area VII / Area VIII, each ending
//    with a blank-label row holding the section FQA subtotal in column M
import * as XLSX from 'xlsx'

const SECTIONS = ['North Sea', 'West Coast', 'Area VII', 'Area VIII']

const num = v => (typeof v === 'number' && isFinite(v) ? v : null)

function toIsoDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0')
  }
  return null
}
function toIso(v) {
  return v instanceof Date && !isNaN(v) ? v.toISOString() : null
}

// arrayBuffer -> { meta, lines, sections, warnings }
export function parseAfpoXlsx(buf, filename) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: true })

  const cell = (r, c) => (grid[r] ? grid[r][c] : null) // 0-based

  // Row 2 (idx 1): "ITQ CATCHES IN RESPECT OF MV: AUDACIOUS"
  const titleRow = String(cell(1, 0) || '')
  const vessel = titleRow.includes('MV:') ? titleRow.split('MV:')[1].trim() : (wb.SheetNames[0] || '').toUpperCase()
  const lastLanding = toIsoDate(cell(2, 2))   // row 3 col C
  const lastUpdated = toIso(cell(2, 9))       // row 3 col J
  // Quota year from the "20XX T A C" header
  let year = null
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const m = String(cell(r, 1) || '').match(/(20\d{2})\s*T\s*A\s*C/i)
    if (m) { year = Number(m[1]); break }
  }
  if (!year && lastLanding) year = Number(lastLanding.slice(0, 4))

  const lines = []
  const sections = {}   // section -> { fqaPrinted, fqaSum, fqaSideSum }
  let section = null
  const subtotalCandidates = [] // blank-label rows carrying FQA in col M

  for (let r = 4; r < grid.length; r++) {
    const a = cell(r, 0)
    const label = a == null ? '' : String(a).trim()

    if (SECTIONS.includes(label)) {
      section = label
      sections[section] = sections[section] || { fqaPrinted: null, fqaSum: 0, fqaSideSum: 0 }
      continue
    }
    if (!label) {
      const f = num(cell(r, 12))
      if (f != null) subtotalCandidates.push({ section, value: f })
      continue
    }
    if (label === 'Species and Area' || label === 'Non Quota Species' || label.startsWith('ALL TONNES')) continue
    if (num(cell(r, 1)) == null) continue // header echo rows, stray notes

    const line = {
      section,
      stock: label,
      tac_share: num(cell(r, 1)),
      aq: num(cell(r, 2)),
      banking: num(cell(r, 3)),
      lease: num(cell(r, 4)),
      swaps: num(cell(r, 5)),
      allocation: num(cell(r, 6)),
      flexibility: num(cell(r, 7)),
      catch_uk: num(cell(r, 8)),
      catch_nor: num(cell(r, 9)),
      catch_total: num(cell(r, 10)),
      balance: num(cell(r, 11)),
      fqa_units: num(cell(r, 12)),
      fqa_side: num(cell(r, 13)),   // col N side note (Norway Ling, WS Sole)
      sci_quota: num(cell(r, 14)),  // col O (2026+)
    }
    lines.push(line)
  }

  // Last blank-label FQA row is the grand total; earlier ones are section
  // subtotals (first per section wins).
  const fqaGrandPrinted = subtotalCandidates.length ? subtotalCandidates[subtotalCandidates.length - 1].value : null
  for (const cand of subtotalCandidates.slice(0, -1)) {
    if (cand.section && sections[cand.section] && sections[cand.section].fqaPrinted == null) {
      sections[cand.section].fqaPrinted = cand.value
    }
  }

  // Per-section sums. Col-N side notes count only when they are genuine
  // extra sub-stocks (Norway Ling, WS Sole) — the 2026 file also echoes the
  // FOLLOWING row's FQA in col N (NS Monks (NOR) 99, Norway Others 187),
  // which would double-count, so skip side values equal to the next line's
  // own FQA units.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.section || !sections[l.section]) continue
    sections[l.section].fqaSum += l.fqa_units || 0
    const side = l.fqa_side
    if (side != null && side !== 0 && !(lines[i + 1] && lines[i + 1].fqa_units === side)) {
      sections[l.section].fqaSideSum += side
    }
  }

  // Reconcile FQA: line sums + side notes vs printed section subtotals.
  // The 2025 source file's own NS subtotal disagrees with its rows, so
  // mismatches warn rather than block.
  const warnings = []
  let reconcileOk = true
  for (const sec of Object.keys(sections)) {
    const s = sections[sec]
    if (s.fqaPrinted == null) continue
    const sum = Math.round(s.fqaSum + s.fqaSideSum)
    if (Math.abs(sum - Math.round(s.fqaPrinted)) > 0.5) {
      reconcileOk = false
      warnings.push(`${sec}: FQA lines total ${sum.toLocaleString()} vs printed subtotal ${Math.round(s.fqaPrinted).toLocaleString()} (source-file inconsistency)`)
    }
  }
  if (!lines.length) warnings.push('No quota lines found — is this an AFPO Current Quota Holdings file?')

  return {
    meta: { vessel, year, last_landing_date: lastLanding, last_updated: lastUpdated, filename: filename || '', fqa_grand_total: fqaGrandPrinted, reconcile_ok: reconcileOk },
    lines,
    sections,
    warnings,
  }
}
