/* UK QUOTA HOLDERS — the pure half of /quota-holders.
 *
 * The data is an export of the public FQA register (fqaregister.service.gov.uk):
 * one row per holding — a licence (vessel or PO "dummy" licence), its holder,
 * its PO and the FQA units it carries per stock. It is loaded into
 * `quota_holders_data` by the Claude pipeline; it is never committed here
 * (this repo is public, and the register is a point-in-time snapshot).
 *
 * TONNES ARE AN ESTIMATE. The register gives units, not tonnes. For each stock
 * and year:  tonnes per unit = sum of every PO's "TAC share" in that year's
 * Marine Directorate uptake report  ÷  units held in POs on the register.
 * That rate comes from the `balances` dataset of the swaps page, so it moves on
 * by itself when a new year's TACs land in the uptake report. A future year has
 * no report yet: its rate is the latest year's × (1 + the user's % for that stock).
 * Stocks the uptake report does not cover (area VII, Norway, NAFO …) have units
 * but no tonnes, and say so rather than show a zero.
 */

export const ALL = 'All'
export const isAll = (v) => v == null || v === '' || v === ALL

// Groups in the uptake report that are POs (their TAC share is unit-backed).
export const PO_GROUPS = new Set(['SFO', 'Aberdeen', 'NESFO', 'Shetland', 'Fife', 'West Scotland', 'Orkney', 'Klondyke',
  'Lunar', 'Anglo Scottish', 'EEFPO', 'Western PO', 'FPO', 'NIFPO', 'ANIFPO', 'Cornish', 'South West', 'North Sea',
  'Wales & WC', 'Interfish', 'Humberside FPO', 'Isle of Man', 'Northern'])

/* Holding types that are not a fishing boat's own licence: units held by agents,
 * owners, private persons, companies, PO pools and quota schemes. These are the
 * units most likely to be leased out. */
export const ACTIVE_TYPES = new Set(['Vessel licence', 'Fishing Vessel Licencee in membership of PO',
  'Fishing Vessel Licencee not in membership of PO'])
export const isLeasable = (r) => !ACTIVE_TYPES.has(r.htype)

export const NO_PO = 'No PO'

/* The grouping key for a holder. The export's key already folds case,
 * punctuation and Limited/Ltd; this also folds Co into Company, which the
 * register spells both ways for one firm ("Lunar Fishing Co Ltd" and
 * "LUNAR FISHING COMPANY LIMITED"). Applied when the page loads, so it needs no
 * reload of the data. */
export const normHolderKey = (k) => String(k || '').replace(/\bCO\b/g, 'COMPANY').replace(/\s+/g, ' ').trim()

/* A holding with no PO on the register is a NON-SECTOR licence (an over-10 m
 * boat outside every PO, its quota managed by the MMO or Marine Scotland) or an
 * administration pool licence. It is not missing data, so it is never shown as
 * a bare "No PO", and its quota line is the uptake report's Non Sector groups. */
export const NO_PO_LABEL = 'Not in a PO (non-sector)'
export const poLabel = (po) => (po === NO_PO ? NO_PO_LABEL : po)
const isNonSector = (g) => /^non sector/i.test(g || '')

/* Several uptake groups added into one balance line. */
function sumBal(list) {
  if (!list.length) return null
  const add = (k) => list.reduce((a, b) => (b[k] == null ? a : (a ?? 0) + b[k]), null)
  return { tac_t: add('tac_t'), swaps_in_t: add('swaps_in_t'), swaps_out_t: add('swaps_out_t'),
    net_swaps_t: add('net_swaps_t'), landed_t: add('landed_t'), used_pct: null }
}

/* Units a holding carries for the species asked for (all species when none picked). */
export function unitsOf(row, species) {
  const u = row.u || {}
  if (!species || !species.length) return Object.values(u).reduce((a, b) => a + b, 0)
  let s = 0
  for (const k of species) s += u[k] || 0
  return s
}

/* Tonnes for the species asked for; `missing` counts units with no rate. */
export function tonnesOf(row, species, rates) {
  const u = row.u || {}
  const keys = species && species.length ? species : Object.keys(u)
  let t = 0, missing = 0
  for (const k of keys) {
    const n = u[k] || 0
    if (!n) continue
    const r = rates.get(k)
    if (r == null) missing += n
    else t += n * r
  }
  return { t, missing }
}

/* Tonnes per unit, per species, for one year of the uptake report.
 * speciesList: [{species, code}], balances: rows of that year, holdings: register rows. */
export function ratesFor(speciesList, balances, holdings) {
  const tac = new Map()
  for (const b of balances || []) {
    if (!PO_GROUPS.has(b.po)) continue
    tac.set(b.stock, (tac.get(b.stock) || 0) + (b.tac_t || 0))
  }
  const poUnits = new Map()
  for (const h of holdings || []) {
    if (h.po === NO_PO) continue
    for (const [k, v] of Object.entries(h.u || {})) poUnits.set(k, (poUnits.get(k) || 0) + v)
  }
  const out = new Map()
  for (const s of speciesList || []) {
    if (!s.code) continue
    const t = tac.get(s.code), n = poUnits.get(s.species)
    if (t > 0 && n > 0) out.set(s.species, t / n)
  }
  return out
}

/* A future year: the base year's rates moved by the user's % per species. */
export function projectRates(base, pct = {}) {
  const out = new Map()
  for (const [k, r] of base) out.set(k, r * (1 + (Number(pct[k]) || 0) / 100))
  return out
}

export function applyRowFilters(rows, { po, htype, admin, leasable } = {}) {
  return (rows || []).filter((r) =>
    (isAll(po) || r.po === po)
    && (isAll(htype) || r.htype === htype)
    && (isAll(admin) || r.admin === admin)
    && (!leasable || isLeasable(r)))
}

const boatName = (r) => (r.vessel ? `${r.vessel} (${r.lic})` : `Licence ${r.lic}`)

/* The key a holding is grouped under. Holders group across every holding and
 * PO by their normalised name; `split` keeps each holding (licence + PO) apart. */
export function groupKey(r, by, split) {
  if (by === 'po') return r.po
  if (by === 'boat') return `${r.lic}|${r.vessel}`
  return split ? `${r.hkey}|${r.lic}|${r.po}` : r.hkey
}

/* LEAGUE TABLE. Ranks holders, boats or POs by units or estimated tonnes for the
 * species picked. Boats are vessel licences only: units on PO dummy licences are
 * not on any boat, and the result says how many units that leaves out. */
export function league(rows, { by = 'holder', species = [], metric = 'units', rates = new Map(), split = false, top = 20 } = {}) {
  let src = rows || []
  let offBoat = 0
  if (by === 'boat') {
    offBoat = src.filter((r) => !r.vessel).reduce((a, r) => a + unitsOf(r, species), 0)
    src = src.filter((r) => r.vessel)
  }
  const g = new Map()
  for (const r of src) {
    const units = unitsOf(r, species)
    if (!units) continue
    const { t, missing } = tonnesOf(r, species, rates)
    const k = groupKey(r, by, split)
    let e = g.get(k)
    if (!e) {
      e = { key: k, names: new Map(), units: 0, tonnes: 0, missing: 0, holdings: 0, pos: new Set(), vessels: new Set(),
        holders: new Set(), lics: new Set(), per: {} }
      g.set(k, e)
    }
    const nm = by === 'po' ? poLabel(r.po) : by === 'boat' ? boatName(r) : r.holder
    e.names.set(nm, (e.names.get(nm) || 0) + units)
    e.units += units; e.tonnes += t; e.missing += missing; e.holdings++
    e.pos.add(r.po); if (r.vessel) e.vessels.add(r.vessel); e.holders.add(r.holder); e.lics.add(r.lic)
    for (const s of species) {
      const n = r.u?.[s] || 0
      if (!n) continue
      const p = e.per[s] || (e.per[s] = { units: 0, tonnes: 0 })
      p.units += n
      const rt = rates.get(s)
      if (rt != null) p.tonnes += n * rt
    }
  }
  const all = [...g.values()].map((e) => ({
    key: e.key,
    name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
    units: e.units, tonnes: e.tonnes, missing: e.missing, holdings: e.holdings,
    pos: [...e.pos].sort(), vessels: [...e.vessels].sort(), holders: [...e.holders].sort(), lics: [...e.lics].sort(),
    per: e.per,
  }))
  const totalUnits = all.reduce((a, e) => a + e.units, 0)
  const totalTonnes = all.reduce((a, e) => a + e.tonnes, 0)
  const val = (e) => (metric === 'tonnes' ? e.tonnes : e.units)
  all.sort((a, b) => val(b) - val(a) || a.name.localeCompare(b.name))
  all.forEach((e, i) => {
    e.rank = i + 1
    e.share = metric === 'tonnes' ? (totalTonnes ? e.tonnes / totalTonnes : 0) : (totalUnits ? e.units / totalUnits : 0)
  })
  const shown = top && top > 0 ? all.slice(0, top) : all
  const shownShare = shown.reduce((a, e) => a + e.share, 0)
  return { rows: shown, count: all.length, totalUnits, totalTonnes, shownShare, offBoat }
}

/* PO MAKE-UP, part 1: for one stock, each PO's share of the register's units
 * next to its quota and swaps for the year (from the swaps page's balances).
 * A PO swapping out a lot more than its share of units suggests is long. */
export function poShares(rows, balances, { species, code }) {
  const units = new Map()
  let total = 0
  for (const r of rows || []) {
    const n = r.u?.[species] || 0
    if (!n) continue
    units.set(r.po, (units.get(r.po) || 0) + n); total += n
  }
  const forStock = (balances || []).filter((b) => b.stock === code)
  const bal = new Map(forStock.map((b) => [b.po, b]))
  const ns = sumBal(forStock.filter((b) => isNonSector(b.po)))
  if (ns) bal.set(NO_PO, ns)
  const pos = new Set([...units.keys(), ...[...bal.keys()].filter((p) => PO_GROUPS.has(p) || p === NO_PO)])
  const out = []
  for (const po of pos) {
    const b = bal.get(po) || {}
    const n = units.get(po) || 0
    const tac = b.tac_t ?? null
    out.push({
      po, label: poLabel(po), units: n, unitShare: total ? n / total : 0, tac_t: tac,
      swaps_in_t: b.swaps_in_t ?? null, swaps_out_t: b.swaps_out_t ?? null, net_swaps_t: b.net_swaps_t ?? null,
      // Against a quota of a few tonnes the % says nothing (65 t swapped onto
      // 0.2 t reads 32,500%), so it is only shown from 10 t of quota up.
      // Nor for the non-sector line: its units are not what its quota is cut
      // from (69,000 NS haddock units against 10 t), so the % would be noise.
      netOfTac: po !== NO_PO && tac >= 10 && b.net_swaps_t != null ? b.net_swaps_t / tac : null,
      landed_t: b.landed_t ?? null, used_pct: b.used_pct ?? null,
    })
  }
  return out.sort((a, b) => b.units - a.units)
}

/* One PO line: its units and estimated tonnes beside a balance from the uptake
 * report (one stock, or several added together). */
function poLine(po, units, unitShare, tonnes, b) {
  const tac = b?.tac_t ?? null
  return {
    po, label: poLabel(po), units, unitShare, tonnes, tac_t: tac,
    swaps_in_t: b?.swaps_in_t ?? null, swaps_out_t: b?.swaps_out_t ?? null, net_swaps_t: b?.net_swaps_t ?? null,
    netOfTac: po !== NO_PO && tac >= 10 && b?.net_swaps_t != null ? b.net_swaps_t / tac : null,
    landed_t: b?.landed_t ?? null,
  }
}

/* The uptake balances one PO (or the non-sector groups) has for a stock code. */
function balFor(balances, po, code) {
  const list = (balances || []).filter((b) => b.stock === code && (po === NO_PO ? isNonSector(b.po) : b.po === po))
  return sumBal(list)
}

/* PO MAKE-UP, ALL STOCKS: every PO's units and estimated tonnes across every
 * stock, beside its quota and swaps added over the stocks the register and the
 * uptake report share — so the quota column covers the same stocks the units do,
 * not a PO's area VII lines that no tonnes figure here can match. */
export function poOverview(rows, balances, speciesList, rates) {
  const codes = new Set((speciesList || []).map((s) => s.code).filter(Boolean))
  const units = new Map(), tonnes = new Map()
  let totalT = 0
  for (const r of rows || []) {
    const n = unitsOf(r, [])
    if (!n) continue
    units.set(r.po, (units.get(r.po) || 0) + n)
    const { t } = tonnesOf(r, [], rates)
    tonnes.set(r.po, (tonnes.get(r.po) || 0) + t); totalT += t
  }
  const inScope = (balances || []).filter((b) => codes.has(b.stock))
  const pos = new Set([...units.keys(), ...inScope.map((b) => (isNonSector(b.po) ? NO_PO : b.po)).filter((p) => PO_GROUPS.has(p) || p === NO_PO)])
  const out = []
  for (const po of pos) {
    const b = sumBal(inScope.filter((x) => (po === NO_PO ? isNonSector(x.po) : x.po === po)))
    const t = tonnes.get(po) || 0
    out.push(poLine(po, units.get(po) || 0, totalT ? t / totalT : 0, t, b))
  }
  return out.sort((a, b) => b.tonnes - a.tonnes || b.units - a.units)
}

/* PO MAKE-UP, ONE PO: its stocks, each with the PO's share of that stock's
 * units on the register, its estimated tonnes, and its quota and swaps. */
export function poSpecies(rows, balances, po, speciesList, rates) {
  const ukUnits = new Map(), mine = new Map()
  for (const r of rows || []) {
    for (const [k, v] of Object.entries(r.u || {})) {
      ukUnits.set(k, (ukUnits.get(k) || 0) + v)
      if (r.po === po) mine.set(k, (mine.get(k) || 0) + v)
    }
  }
  const out = []
  for (const s of speciesList || []) {
    const n = mine.get(s.species) || 0
    const b = s.code ? balFor(balances, po, s.code) : null
    if (!n && !(b && (b.tac_t || b.swaps_in_t || b.swaps_out_t))) continue
    const r = rates.get(s.species)
    const line = poLine(po, n, ukUnits.get(s.species) ? n / ukUnits.get(s.species) : 0, r == null ? null : n * r, b)
    out.push({ ...line, species: s.species, code: s.code })
  }
  return out.sort((a, b) => (b.tonnes ?? -1) - (a.tonnes ?? -1) || b.units - a.units)
}

/* PO MAKE-UP, part 2: who holds a PO's units for a stock (or all stocks). */
export function poHolders(rows, po, species, rates) {
  return league((rows || []).filter((r) => r.po === po), { by: 'holder', species, metric: 'units', rates, top: 0 })
}

/* LOOK-UP: every holding matching a name, vessel or licence number. */
export function search(rows, q) {
  const s = String(q || '').trim().toUpperCase()
  if (s.length < 2) return []
  return (rows || []).filter((r) => r.holder.toUpperCase().includes(s) || r.hkey.includes(s)
    || (r.vessel || '').toUpperCase().includes(s) || String(r.lic).includes(s))
}

/* A holder's (or any set of holdings') units per species, with tonnes. */
export function breakdown(rows, rates) {
  const m = new Map()
  for (const r of rows || []) {
    for (const [k, v] of Object.entries(r.u || {})) m.set(k, (m.get(k) || 0) + v)
  }
  return [...m.entries()].map(([species, units]) => {
    const r = rates.get(species)
    return { species, units, tonnes: r == null ? null : units * r }
  }).sort((a, b) => (b.tonnes ?? -1) - (a.tonnes ?? -1) || b.units - a.units)
}

/* SIDE BY SIDE: two holders, boats, licences or POs, stock by stock. Each side
 * is a set of holdings; a stock either holds appears once, with both sides'
 * units and estimated tonnes. A units-only stock has null tonnes on both sides
 * and is listed after every stock that has an estimate. */
export function compare(rowsA, rowsB, rates) {
  const add = (m, rows, side) => {
    for (const r of rows || []) {
      for (const [k, v] of Object.entries(r.u || {})) {
        const e = m.get(k) || { species: k, ua: 0, ub: 0 }
        e[side] += v
        m.set(k, e)
      }
    }
  }
  const m = new Map()
  add(m, rowsA, 'ua'); add(m, rowsB, 'ub')
  const lines = [...m.values()].map((e) => {
    const r = rates.get(e.species)
    const ta = r == null ? null : e.ua * r, tb = r == null ? null : e.ub * r
    return { ...e, ta, tb, dt: r == null ? null : ta - tb, du: e.ua - e.ub }
  }).sort((x, y) => (Math.max(y.ta ?? -1, y.tb ?? -1) - Math.max(x.ta ?? -1, x.tb ?? -1)) || (Math.max(y.ua, y.ub) - Math.max(x.ua, x.ub)))
  const sum = (k) => lines.reduce((a, l) => a + (l[k] || 0), 0)
  return { lines, ua: sum('ua'), ub: sum('ub'), ta: sum('ta'), tb: sum('tb'),
    onlyA: lines.filter((l) => l.ua && !l.ub).length, onlyB: lines.filter((l) => l.ub && !l.ua).length }
}

export const fmtUnits =(v) => (v == null ? '' : Math.round(v).toLocaleString('en-GB'))
export const fmtT = (v) => (v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(1))
export const fmtPct = (v) => (v == null ? '' : (v * 100).toFixed(1) + '%')
