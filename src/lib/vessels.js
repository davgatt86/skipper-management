/* WHICH BOAT AM I LOOKING AT.
 *
 * Four of the twelve fleets are pair teams carrying two boats, and until now
 * nothing in the app could say which one a page meant. Fish Sales worked around
 * it by matching on `sales_landings.vessel`, which is a text label; everything
 * else simply showed the fleet.
 *
 * This is the answer those pages ask for, and it has to come BEFORE
 * `vessel_details` moves off `fleet_id` — all six of its readers do
 * `.maybeSingle()`, which throws the moment a fleet has two rows. The schema
 * change without this gives a pair fleet six broken pages, not two boats.
 *
 * NULL MEANS ALL, NOT NONE. A pair team's combined view is a real view — sum
 * the gross and the boxes across both boats — so "no vessel chosen" is a
 * deliberate state and not a missing answer. A single-vessel fleet never gets
 * it: there is nothing to combine, so `current` is simply that boat and no
 * picker is ever shown.
 */

export const storageKey = (fleetId) => `sm.currentVessel.${fleetId || 'none'}`

/* Work out the current vessel from what the fleet has and what was last chosen.
 *
 * THE STORED CHOICE IS VALIDATED AGAINST THIS FLEET'S BOATS, ALWAYS, and that
 * is the part that matters. A stale id — from another account, or a boat since
 * retired — would otherwise filter every query to a vessel that is not there.
 * RLS returns nothing for it, so the page comes up EMPTY rather than wrong,
 * which is the worst way for this to fail: it looks like a boat with no data
 * instead of a bad setting. An unrecognised id falls back to all.
 */
export function resolveCurrent(vessels, storedId) {
  const live = (vessels || []).filter((v) => v && v.active !== false)

  // No boats at all — HANSTHOLM. The page must not pretend otherwise.
  if (!live.length) {
    return { current: null, vessels: [], multi: false, hasVessels: false, showing: 'none' }
  }

  // One boat: it IS the current one, and there is no choice to offer.
  if (live.length === 1) {
    return { current: live[0], vessels: live, multi: false, hasVessels: true, showing: 'one' }
  }

  const found = storedId ? live.find((v) => v.id === storedId) : null
  return {
    current: found || null,
    vessels: live,
    multi: true,
    hasVessels: true,
    showing: found ? 'one' : 'all',
  }
}

/* Apply the choice to a Supabase query.
 *
 * Filtering by the ONLY boat is the same as not filtering, so a single-vessel
 * fleet takes the filter harmlessly — which means a page can call this
 * unconditionally instead of remembering when it applies.
 *
 * BUT NOT WHERE THE COLUMN IS NULL. 5 rows across the database have no
 * vessel_id and never will: HANSTHOLM's rota trips, because that fleet has no
 * boat to point at. Filtering those out is correct — they belong to no vessel —
 * but a page showing "all" must not lose them, which is why `all` applies
 * nothing at all rather than `is null or eq`.
 */
export function scopeQuery(query, current) {
  return current ? query.eq('vessel_id', current.id) : query
}

// The same decision for rows already in hand, which is how the offline pages
// work — they read the table whole and filter here.
export function scopeRows(rows, current) {
  if (!current) return rows || []
  return (rows || []).filter((r) => r.vessel_id === current.id)
}

/* What to call it on screen. `label` is the canonical "NAME REG" — the same
 * form `sales_landings.vessel` uses, which is what let stage 1's backfill be a
 * real join rather than an assumption. */
export const vesselName = (v) => (v ? (v.label || v.name || '') : '')

export const showingLabel = (state) => {
  if (state.showing === 'none') return 'No vessel on record'
  if (state.showing === 'all') return `All ${state.vessels.length} boats`
  return vesselName(state.current)
}
