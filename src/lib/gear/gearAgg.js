/* Reading the gear log.
 *
 * The page is a MATRIX: nets down the side, parts across the top, so you can
 * read one net's whole rig across a row, or one part across every net down a
 * column. David asked for both — "select measured headline, I would see a days
 * since for each net" is the column; "port net > ground gear > headline >
 * bridles > legs" is the row — and a matrix is the one shape that is both.
 */

const DAY = 86400000

export const dayOf = (d) => (d ? String(d).slice(0, 10) : null)

// Whole days between two dates, or null if either is missing. Blank stays
// blank: an unknown age must never render as 0, which reads as "done today".
export function daysBetween(from, to) {
  if (!from) return null
  const a = Date.parse(`${dayOf(from)}T00:00:00Z`)
  const b = Date.parse(`${dayOf(to) || new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / DAY)
}

// The set currently on the net — the one nobody has taken off yet.
export const fittedComponent = (components, netId, partKey) =>
  (components || []).find(
    (c) => c.net_id === netId && c.part_key === partKey && !c.removed_on) || null

// Everything ever fitted there, newest first. The history is the point of the
// log, so retired sets are kept rather than deleted.
export const historyFor = (components, netId, partKey) =>
  (components || [])
    .filter((c) => c.net_id === netId && c.part_key === partKey)
    .sort((a, b) => String(b.fitted_on || '').localeCompare(String(a.fitted_on || '')))

export const measurementsFor = (measurements, componentId) =>
  (measurements || [])
    .filter((m) => m.component_id === componentId)
    .sort((a, b) => String(b.done_on || '').localeCompare(String(a.done_on || '')))

// How long a set has been on, or was on. Null while nothing is known.
export const lifeDays = (component, today) =>
  component ? daysBetween(component.fitted_on, component.removed_on || today) : null

/* ONE CELL OF THE MATRIX.
 *
 * `basis` is why the number is what it is, and the page must show it. "69 days
 * since measured" and "69 days since she came aboard" are different facts, and
 * rendering them identically would let a net that has never been looked at pass
 * for one that was checked ten weeks ago.
 *
 *   measured — a measurement on the fitted set
 *   fitted   — no measurement, so counting from when the set went on
 *   aboard   — nothing fitted either, so counting from when the net came aboard
 *   none     — nothing known at all
 */
export function cellFor(net, partKey, components, measurements, today) {
  const component = fittedComponent(components, net.id, partKey)
  const ms = component ? measurementsFor(measurements, component.id) : []
  const lastMeasured = ms.find((m) => m.kind === 'measured') || null
  const lastAny = ms[0] || null

  let since = null, basis = 'none'
  if (lastMeasured?.done_on) { since = lastMeasured.done_on; basis = 'measured' }
  else if (component?.fitted_on) { since = component.fitted_on; basis = 'fitted' }
  else if (net.came_aboard) { since = net.came_aboard; basis = 'aboard' }

  return {
    net, partKey, component,
    fittedOn: component?.fitted_on || null,
    lastMeasured, lastAny,
    measurements: ms,
    since, basis,
    days: daysBetween(since, today),
    // How long the fitted set has been on, which is a different question from
    // how long since anyone measured it.
    fittedDays: lifeDays(component, today),
  }
}

/* The whole grid. Nets are grouped by vessel, because a pair team carries four
 * — two on each boat — and they are never shared between them. */
export function buildMatrix({ nets, parts, components, measurements, vessels, today, includeRetired = false }) {
  const live = (nets || []).filter((n) => includeRetired || !n.retired_on)
  const byVessel = new Map()
  for (const n of live) {
    if (!byVessel.has(n.vessel_id)) byVessel.set(n.vessel_id, [])
    byVessel.get(n.vessel_id).push(n)
  }
  const vesselOf = new Map((vessels || []).map((v) => [v.id, v]))

  return [...byVessel.entries()]
    .map(([vesselId, vNets]) => ({
      vessel: vesselOf.get(vesselId) || { id: vesselId, label: 'Unknown vessel' },
      rows: vNets
        .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name))
        .map((net) => ({
          net,
          cells: (parts || []).map((p) => cellFor(net, p.key, components, measurements, today)),
        })),
    }))
    .sort((a, b) => String(a.vessel.label || '').localeCompare(String(b.vessel.label || '')))
}

/* Closed lives, for the stats. A set still on the net is NOT a life — it has
 * not finished yet, and averaging it in would drag every figure down towards
 * however recently the last renewal happened. It is reported separately as the
 * one still running. */
export function closedLives(components, partKey = null) {
  return (components || [])
    .filter((c) => c.fitted_on && c.removed_on && (!partKey || c.part_key === partKey))
    .map((c) => ({ ...c, days: daysBetween(c.fitted_on, c.removed_on) }))
    .filter((c) => Number.isFinite(c.days))
}
