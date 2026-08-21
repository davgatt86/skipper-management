import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import { readCache, cacheTable, isOnline } from './lib/offline/queue'
import { resolveCurrent, storageKey } from './lib/vessels'

/* WHICH BOAT AM I LOOKING AT — held once, for the whole app.
 *
 * Four of the twelve fleets are pair teams carrying two boats. Until now
 * nothing could say which one a page meant: Fish Sales worked around it by
 * matching on the text in `sales_landings.vessel`, and everything else simply
 * showed the fleet.
 *
 * This has to exist BEFORE `vessel_details` moves off `fleet_id`. All six of
 * its readers call `.maybeSingle()`, which throws the moment a fleet has two
 * rows — so the schema change without a current vessel gives a pair fleet six
 * broken pages rather than two boats.
 *
 * CACHED, because the picker disappearing at sea would be worse than not
 * having one. The vessel list is small and almost never changes, so it is read
 * from the cache first and refreshed when there is a signal — the same shape
 * as the vessel particulars on the engine log page.
 *
 * The CHOICE is in localStorage rather than the database on purpose: it is a
 * view setting, not a fact about the boat, and two people signed into the same
 * fleet may reasonably be looking at different halves of a pair.
 */

const VesselCtx = createContext({
  current: null, vessels: [], multi: false, hasVessels: false, showing: 'none',
  setCurrent: () => {}, loading: true,
})

export function VesselProvider({ children }) {
  const { appUser } = useAuth()
  const fleetId = appUser?.fleet_id || null

  const [vessels, setVessels] = useState([])
  const [storedId, setStoredId] = useState(null)
  const [loading, setLoading] = useState(true)

  // Read the last choice for THIS fleet. The key carries the fleet id, so
  // signing into another account does not inherit the boat picked on this one.
  useEffect(() => {
    try {
      setStoredId(window.localStorage.getItem(storageKey(fleetId)))
    } catch { setStoredId(null) }   // storage can be disabled; not worth failing over
  }, [fleetId])

  useEffect(() => {
    if (!fleetId) { setVessels([]); setLoading(false); return }
    let live = true
    ;(async () => {
      const cached = await readCache('vessels')
      if (live && cached.rows.length) { setVessels(cached.rows); setLoading(false) }
      if (!isOnline()) { if (live) setLoading(false); return }
      const { data } = await supabase.from('vessels')
        .select('id, fleet_id, name, pln, label, active, sort')
        .order('sort', { ascending: true })
      if (live && data) { setVessels(data); cacheTable('vessels', data) }
      if (live) setLoading(false)
    })()
    return () => { live = false }
  }, [fleetId])

  /* The stored id is validated against this fleet's boats every time. A stale
   * one would otherwise filter every query to a vessel that is not there — and
   * because RLS returns nothing for it, the page would come up EMPTY rather
   * than wrong, which looks like a boat with no data instead of a bad setting.
   * resolveCurrent falls back to "all". */
  const state = useMemo(() => resolveCurrent(vessels, storedId), [vessels, storedId])

  const setCurrent = useCallback((id) => {
    setStoredId(id || null)
    try {
      if (id) window.localStorage.setItem(storageKey(fleetId), id)
      else window.localStorage.removeItem(storageKey(fleetId))
    } catch { /* storage disabled — the choice just does not persist */ }
  }, [fleetId])

  const value = useMemo(() => ({ ...state, setCurrent, loading }), [state, setCurrent, loading])
  return <VesselCtx.Provider value={value}>{children}</VesselCtx.Provider>
}

export const useCurrentVessel = () => useContext(VesselCtx)
