/* WHICH GROUNDS EAT GEAR.
 *
 * "Seasonal trackage would be good also, as some areas fished are more abrasive
 * on gear" (David, Aug 2026). That is a measurable claim rather than an
 * impression, because `quota_trip_catches` has carried the FAO area and the EEZ
 * off the logbook since October 2022 — 13,079 rows, so the grounds a set of
 * gear was worked over are recorded, not guessed.
 *
 * AREA, NOT RECTANGLE. David's call, and the data agrees with him: 17 area+EEZ
 * combinations against 129 statistical rectangles. At the number of renewals a
 * boat actually logs, rectangles would divide the evidence into slivers and
 * every one of them would be noise.
 */

// ---------------------------------------------------------------- naming
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
               'XI', 'XII', 'XIII', 'XIV']

/* The logbook writes `27.4.a`; the trade says `IVa`. David names them the trade
 * way — "vib, via, iva" — so that is what the page says.
 *
 * A numeric sub-division runs on (VIb1, VIb2, IIa2) because that is how it is
 * written; a lettered one takes a dot (VIa.s) so it cannot be misread as part
 * of the division letter. Anything that is not a 27.x area is passed through
 * untouched rather than mangled into a wrong-looking Roman numeral.
 */
export function iceLabel(fao) {
  const s = String(fao || '').trim()
  if (!s) return ''
  const parts = s.split('.')
  if (parts[0] !== '27' || parts.length < 2) return s
  const div = Number(parts[1])
  const roman = ROMAN[div]
  if (!roman) return s
  let out = roman
  for (const p of parts.slice(2)) {
    out += /^\d+$/.test(p) ? p : (out === roman ? p : `.${p}`)
  }
  return out
}

/* The EEZ is part of the ground's identity, not decoration. Audacious fished
 * 27.4.a for 578 days inside GBR waters and 337 inside NOR, and those are
 * different grounds to the man towing over them. */
export const groundKey = (fao, eez) => `${fao || '?'}|${eez || ''}`
export const groundLabel = (fao, eez) =>
  eez ? `${iceLabel(fao)} (${eez})` : iceLabel(fao)
export const splitKey = (key) => {
  const [fao, eez] = String(key).split('|')
  return { fao, eez: eez || null, label: groundLabel(fao, eez) }
}

/* ------------------------------------------------------------ the mix
 *
 * Where one set of gear was worked, as day-ground PAIRS. A day fished over two
 * grounds counts in both — which is right for attributing wear, and is why this
 * counts pairs rather than days. The shares therefore sum to 1 across grounds
 * even though the pair total exceeds the days at sea.
 */
export function groundMix(rows, from, to) {
  if (!from) return { pairs: 0, byGround: {} }
  const a = String(from).slice(0, 10)
  const b = String(to || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const byGround = {}
  let pairs = 0
  for (const r of rows || []) {
    const d = String(r.day ?? r.catch_date ?? '').slice(0, 10)
    if (!d || d < a || d > b) continue
    const k = groundKey(r.fao_area, r.eez)
    byGround[k] = (byGround[k] || 0) + 1
    pairs++
  }
  return { pairs, byGround }
}

// The grounds of one mix, biggest first, with each one's share.
export function mixShares(mix) {
  if (!mix.pairs) return []
  return Object.entries(mix.byGround)
    .map(([key, days]) => ({ ...splitKey(key), key, days, share: days / mix.pairs }))
    .sort((a, b) => b.days - a.days)
}

/* ------------------------------------------------- what a ground costs
 *
 * THE METHOD, and it is the point of the file.
 *
 * A finished set of gear is ONE set consumed. Split that one set across the
 * grounds it was worked over, in proportion to the days spent on each. Then a
 * ground's wear rate is:
 *
 *     sets attributed to it  ÷  days fished on it
 *
 * reported as sets per 100 days, because the raw figure is a small decimal.
 * Higher means gear is used up faster there.
 *
 * Why not simply "average life of sets used there": a set worked over four
 * grounds would count its whole life against each of them, so a ground that is
 * always fished alongside a long-lasting one would inherit its figure. Splitting
 * the set is what makes the comparison mean anything.
 *
 * TWO THINGS REPORTED BESIDE EVERY RATE, because without them it is noise
 * wearing the costume of a finding:
 *   - `lives`, how many finished sets contributed at all
 *   - `days`,  how many fished days it rests on
 * A ground with four days and one set will show the most extreme rate on the
 * page, and it means nothing.
 *
 * A life with no logbook days inside it cannot be attributed and is counted in
 * `unattributed` rather than dropped silently.
 */
export function groundWear(lives, groundDays = {}, netVessel = {}) {
  const acc = {}
  let unattributed = 0

  for (const life of lives || []) {
    const rows = groundDays[netVessel[life.net_id]] || []
    const mix = groundMix(rows, life.fitted_on, life.removed_on)
    if (!mix.pairs) { unattributed++; continue }
    for (const [key, days] of Object.entries(mix.byGround)) {
      acc[key] ||= { key, ...splitKey(key), days: 0, sets: 0, lives: 0 }
      acc[key].days += days
      acc[key].sets += days / mix.pairs      // this set, split by where it worked
      acc[key].lives += 1
    }
  }

  const rows = Object.values(acc).map((g) => ({
    ...g,
    sets: Math.round(g.sets * 100) / 100,
    per100: g.days ? Math.round((g.sets / g.days) * 100 * 1000) / 1000 : null,
  }))
  // Worst first — but the page must show `days` and `lives` beside it, because
  // the top of this table is exactly where a thin figure would mislead.
  rows.sort((a, b) => (b.per100 ?? -1) - (a.per100 ?? -1))
  return { rows, unattributed }
}

/* Is there enough here to say anything at all?
 *
 * Deliberately strict. Comparing grounds needs several finished sets AND
 * several grounds to compare, and a page that ranks two grounds off one renewal
 * would be inventing a finding. Same discipline as confidence() in gearStats,
 * and as the pair price-gap panel that reported a mean difference of £0.000
 * rather than a headline.
 */
export function groundConfidence(rows, liveCount) {
  const solid = rows.filter((r) => r.days >= 20 && r.lives >= 2)
  if (!liveCount) return { level: 'none', text: 'no finished sets yet — nothing to attribute' }
  if (liveCount < 3) return {
    level: 'thin',
    text: `${liveCount} finished set${liveCount === 1 ? '' : 's'} — far too few to compare grounds`,
  }
  if (solid.length < 2) return {
    level: 'thin',
    text: 'not enough fished days on enough grounds to compare them yet',
  }
  return { level: 'ok', text: `${liveCount} finished sets across ${solid.length} grounds` }
}
