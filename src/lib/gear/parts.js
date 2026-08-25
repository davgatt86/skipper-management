/* The gear vocabulary, and how a length is written down.
 *
 * THE PARTS LIST IS NOT CLOSED. A pair trawl and a single rig differ, and
 * shipping a fixed list is the mistake the market clocks made — a species moved
 * between auction clocks used to need a code change and a deploy for something
 * the skipper knew the day it happened. So the shipped names live here and a
 * fleet's own additions, renames and retirements live in `gear_parts`, merged
 * over the top by resolveParts(). Seed five rows per fleet instead and a later
 * correction reaches nobody.
 *
 * These five are the ones David named. They are a starting vocabulary, not an
 * authority.
 */

/* `halves` — the rope is measured in TWO HALVES AND AN OVERALL.
 *
 * David, Aug 2026: "when measuring a headline/footrope/ground gear we do in 2x
 * halves & total overall." He was already doing it: the measurement of
 * 19-08-2026 carries `Stb 60'3"/Port 60'5"` typed into the NOTES of a separate
 * `inspected` row, because the form had nowhere else to put it — and 60'3" plus
 * 60'5" is the 120'8" of that day's `measured` row. The feature is his method,
 * written down as data instead of prose.
 *
 * Bridles and legs are NOT halved. There is one of each per side already, so
 * they are two components, not one rope with two halves — halving them would
 * quarter the gear. A codend has no halves at all. */
export const DEFAULT_PARTS = [
  { key: 'ground_gear', label: 'Ground gear', halves: true },
  { key: 'footrope', label: 'Footrope', halves: true },
  { key: 'headline', label: 'Headline', halves: true },
  { key: 'bridles', label: 'Bridles' },
  { key: 'legs', label: 'Legs' },
  { key: 'codend', label: 'Codend' },
]

/* Merge the fleet's own rows over the shipped list. Same shape as the stores
 * catalogue: an override supplies only what it changes, so a fleet that renames
 * one part still tracks later corrections to the rest. */
export function resolveParts(rows) {
  const byKey = new Map(DEFAULT_PARTS.map((p, i) => [p.key, { ...p, sort: i, custom: false }]))
  for (const r of rows || []) {
    const base = byKey.get(r.part_key) || { key: r.part_key, label: r.part_key, sort: 99, custom: true }
    byKey.set(r.part_key, {
      ...base,
      label: r.label || base.label,
      sort: r.sort ?? base.sort,
      hidden: !!r.hidden,
      // Whether a part is measured in halves is the BOAT'S to say, like every
      // other rule in this app. A rig I have not seen may halve something I
      // did not, so null on the row means "keep the shipped answer".
      halves: r.halves == null ? !!base.halves : !!r.halves,
      custom: base.custom || !DEFAULT_PARTS.some((d) => d.key === r.part_key),
    })
  }
  return [...byKey.values()]
    .filter((p) => !p.hidden)
    .sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99) || a.label.localeCompare(b.label))
}

export const partLabel = (parts, key) => parts.find((p) => p.key === key)?.label || key
export const partHasHalves = (parts, key) => !!parts.find((p) => p.key === key)?.halves

/* ---------------------------------------------------------------- lengths
 *
 * Fathoms, feet and inches, metres — the three David asked for, because gear is
 * measured in all three depending on the part and the man.
 *
 * EVERY MEASUREMENT IS STORED TWICE, and both are needed. `value` + `unit` is
 * what was written down, so it reads back the way he wrote it — 5 ft 6 in comes
 * back as 5' 6", not 1.6764 m. `value_mm` is the same length in millimetres, so
 * a series stays comparable when the unit changes partway through it, which it
 * will. A wear curve where one reading is in fathoms and the next in metres is
 * worse than no curve at all.
 */
export const LENGTH_UNITS = [
  { key: 'fathom', label: 'Fathoms', short: 'fm', mm: 1828.8 },
  { key: 'ft_in', label: 'Feet & inches', short: 'ft', mm: 304.8 },
  { key: 'm', label: 'Metres', short: 'm', mm: 1000 },
]

export const unitMm = (unit) => LENGTH_UNITS.find((u) => u.key === unit)?.mm || null

// Feet-and-inches is entered as two boxes and held as decimal feet, so the
// arithmetic is ordinary and only the display is compound.
export const ftInToValue = (ft, inch) => {
  const f = Number(ft) || 0
  const i = Number(inch) || 0
  if (!f && !i) return null
  return f + i / 12
}
export const valueToFtIn = (value) => {
  const v = Number(value)
  if (!Number.isFinite(v)) return { ft: '', inch: '' }
  const ft = Math.floor(v)
  // Rounded to the nearest inch, then carried — 5.9999 ft is 6' 0", not 5' 12".
  let inch = Math.round((v - ft) * 12)
  if (inch === 12) return { ft: ft + 1, inch: 0 }
  return { ft, inch }
}

export function toMm(value, unit) {
  // BLANK IS NOT ZERO. Number('') is 0 and Number.isFinite(0) is true, so
  // without this an empty box canonicalises to 0 mm and joins the wear series
  // as a genuine reading of nothing — which is how a headline appears to have
  // vanished. Same trap as the running-hours figure in the maintenance page.
  if (value === null || value === undefined || String(value).trim() === '') return null
  const v = Number(value)
  const mm = unitMm(unit)
  if (!Number.isFinite(v) || !mm) return null
  return v * mm
}

/* What it says on the page. Blank stays blank the whole way through — an
 * unknown length must never render as 0, which reads as "measured, and it is
 * gone". Same trap as the running-hours reading in the maintenance page. */
export function fmtLength(value, unit) {
  const v = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(v)) return ''
  if (unit === 'ft_in') {
    const { ft, inch } = valueToFtIn(v)
    return inch ? `${ft}′ ${inch}″` : `${ft}′`
  }
  const u = LENGTH_UNITS.find((x) => x.key === unit)
  if (!u) return String(v)
  const n = Math.round(v * 100) / 100
  return `${n} ${u.short}`
}

/* ------------------------------------------------- halves and the overall
 *
 * A headline, footrope or ground gear is measured as PORT half, STARBOARD
 * half, and an overall along the whole rope. Three readings of one rope, and
 * the point is that they are three separate acts of measuring, not one figure
 * and two derived from it.
 *
 * THE OVERALL IS NOT DERIVED FROM THE HALVES. It is measured, so it can
 * disagree with them, and when it does one of the three is wrong — which is a
 * check the paper method could never make. `agrees` reports that; it never
 * silently corrects it, the same rule the settlement reconciliation follows.
 *
 * WHEN THE OVERALL WAS NOT TAKEN, the halves are summed and `basis` says
 * `summed` rather than `measured`. A summed total and a measured total are
 * different facts and must not read alike — the same discipline as the "since
 * measured / since fitted / since aboard" basis on the matrix.
 *
 * THE IMBALANCE IS REPORTED AND NEVER JUDGED. Port 60'5" against starboard
 * 60'3" is a real two inches on David's own net, and whether that matters is
 * his call, not a threshold I invented. The engine-limits work settled this:
 * a limit derived from history alone would have flagged the CORRECT readings.
 */

// One inch. That is the resolution `ft_in` rounds to, so it is the finest
// disagreement that can mean anything; below it the two figures are the same
// measurement written twice.
export const HALVES_TOLERANCE_MM = 25.4

export function halvesCheck({ port, stbd, overall, unit }) {
  const portMm = toMm(port, unit)
  const stbdMm = toMm(stbd, unit)
  const overallMm = toMm(overall, unit)

  const haveBoth = portMm != null && stbdMm != null
  const sumMm = haveBoth ? portMm + stbdMm : null

  const imbalanceMm = haveBoth ? Math.abs(portMm - stbdMm) : null
  const longer = !haveBoth || portMm === stbdMm ? null : (portMm > stbdMm ? 'port' : 'stbd')

  // Only comparable when BOTH sides of the comparison exist. Missing is null,
  // never false — "we did not check" and "it does not agree" are not the same.
  const diffMm = sumMm != null && overallMm != null ? overallMm - sumMm : null
  /* The epsilon is not fussiness: 120'1" minus 120' comes out as
   * 25.400000000001455 mm through decimal feet, so a bare `<= 25.4` calls an
   * exact one-inch difference a disagreement. The tolerance is one inch
   * INCLUSIVE and the float must not decide otherwise. */
  const agrees = diffMm == null ? null : Math.abs(diffMm) <= HALVES_TOLERANCE_MM + 1e-6

  const totalMm = overallMm ?? sumMm ?? null
  const basis = overallMm != null ? 'measured' : (sumMm != null ? 'summed' : null)

  return { portMm, stbdMm, overallMm, sumMm, haveBoth,
           imbalanceMm, longer, diffMm, agrees, totalMm, basis }
}

/** A millimetre figure back in the unit it was written in, for display. */
export function fmtMm(mm, unit) {
  if (mm == null || !Number.isFinite(Number(mm))) return ''
  const per = unitMm(unit)
  if (!per) return ''
  return fmtLength(Number(mm) / per, unit)
}

/** Which side is longer, in the boat's own words. */
export const sideLabel = (side) =>
  side === 'port' ? 'port' : side === 'stbd' ? 'starboard' : ''
