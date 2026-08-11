/* A sanity check of the tier rules against a real day tally, before any of it
 * is written into the app. The point is to find out whether the "/94" estimate
 * and the real stacking heights agree — if they do not, the allocator has to
 * work from heights and the estimate is only a starting budget.
 *
 *   node scripts/tier-check.mjs "path/to/day tally.xlsx"
 */
import XLSX from 'xlsx'

const TOP = 21, BOTTOM = 26           // footprints per tier, flat
const FLAT = TOP + BOTTOM             // 47
const PER_TIER_AT_2 = FLAT * 2        // 94 — the estimate's basis

// David's rule: total / 94, round up; and if the remainder is over .7, or it
// lands exactly on a whole number, add one more.
export function tiersFor(boxes) {
  const raw = boxes / PER_TIER_AT_2
  const whole = Math.ceil(raw)
  const frac = raw - Math.floor(raw)
  return (frac === 0 || frac > 0.7) ? whole + 1 : whole
}

// Max stack height by species + grade. Anything not named is 2 high.
function maxHeight(species, grade) {
  const s = species.toUpperCase(), g = (grade || '').toUpperCase()
  if (/ROE/.test(s) || /ROE/.test(g)) return 1   // roes lie flat
  if (s === 'HADDOCK') {
    if (g.startsWith('M METRO')) return 4
    if (g.startsWith('METRO')) return 3
    if (/^(GOOD SEED|PINGER|CHAT|XL)/.test(g)) return 1
    return 2                                   // Seed, Chipper
  }
  if (s === 'BLACK') {
    if (/^(X SMA|SMA|XX SMA)/.test(g)) return 4
    if (g.startsWith('SEL')) return 3
    return 2                                   // Large, Med
  }
  if (s === 'WHITING') {
    if (/^(ROUND|S ROUND)/.test(g)) return 4
    return 2
  }
  if (s === 'COD') {
    if (/^(MED|SPRAG|COD|LARGE|XL)/.test(g)) return 1
    return 2                                   // B Baby, Baby, Robbie
  }
  // flats, and the round white fish that lie flat
  if (['PLAICE','LEMONS','MEGS','HALIBUT','TURBOT','BRILL','WITCH','SKATE',
       'LYTHE','MONKS','LING','SQUID','HAKE'].includes(s)) return 1
  return 2
}

const AUCTION = (s) => {
  const u = s.toUpperCase()
  if (u.startsWith('COD')) return '1 cod'
  if (u.startsWith('HADDOCK') || u === 'WHITING') return '2 had/whit'
  if (['BLACK','MONKS','LING','LYTHE','SQUID','OTHER','CAT'].includes(u)) return '3 rough'
  if (['HAKE','PLAICE','LEMONS','MEGS','HALIBUT','TURBOT','BRILL','WITCH','SKATE'].includes(u)) return '4 flats'
  return '? UNASSIGNED'
}

const file = process.argv[2]
const wb = XLSX.readFile(file)
const rows = XLSX.utils.sheet_to_json(wb.Sheets['AUDACIOUS TOTALS'], { header: 1, defval: null, blankrows: false })

const hdr = rows.findIndex(r => String(r?.[0] || '').trim() === 'SPECIES')
const dayCols = []
for (let c = 4; c < (rows[hdr] || []).length; c++) {
  const h = String(rows[hdr][c] || '')
  if (/^DAY \d+$/i.test(h)) dayCols.push({ col: c, day: Number(h.match(/\d+/)[0]) })
}

const lines = []
for (let i = hdr + 1; i < rows.length; i++) {
  const r = rows[i] || []
  const species = String(r[0] || '').trim()
  const grade = String(r[1] || '').trim()
  if (!species) continue
  if (/TOTAL/i.test(species)) continue                 // subtotal + grand total rows
  if (!grade) continue
  for (const { col, day } of dayCols) {
    const boxes = Number(r[col] || 0)
    if (boxes > 0) lines.push({ species, grade, day, boxes, h: maxHeight(species, grade), auction: AUCTION(species) })
  }
}

const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0)
// A stack is one species and grade but MAY hold more than one day, so the
// footprint count is per grade across all its days — not per day.
const byGrade = {}
for (const l of lines) {
  const k = l.species + '||' + l.grade
  const o = (byGrade[k] = byGrade[k] || { boxes: 0, h: l.h, auction: l.auction, species: l.species })
  o.boxes += l.boxes
}
const footprintsAtMax = Object.values(byGrade).reduce((s, g) => s + Math.ceil(g.boxes / g.h), 0)

const est = tiersFor(totalBoxes)
console.log(`boxes on the tally           ${totalBoxes}`)
console.log(`tiers by the /94 rule        ${est}   (${totalBoxes}/94 = ${(totalBoxes/94).toFixed(2)})`)
console.log(`footprints that gives you    ${est * FLAT}   (${est} x ${FLAT})`)
console.log(`footprints actually needed   ${footprintsAtMax}   (every stack at its MAX height)`)
console.log(`spare                        ${est * FLAT - footprintsAtMax}`)
console.log('')

const byAuction = {}
for (const l of lines) {
  const a = (byAuction[l.auction] = byAuction[l.auction] || { boxes: 0, fp: 0, species: new Set() })
  a.boxes += l.boxes; a.species.add(l.species)
}
for (const g of Object.values(byGrade)) byAuction[g.auction].fp += Math.ceil(g.boxes / g.h)
console.log('by auction:')
for (const [a, v] of Object.entries(byAuction).sort()) {
  console.log(`  ${a.padEnd(14)} ${String(v.boxes).padStart(5)} boxes  ${String(v.fp).padStart(4)} footprints   ${[...v.species].join(', ')}`)
}

const unassigned = [...new Set(lines.filter(l => l.auction.startsWith('?')).map(l => l.species))]
if (unassigned.length) console.log('\nNOT IN ANY AUCTION GROUP: ' + unassigned.join(', '))
