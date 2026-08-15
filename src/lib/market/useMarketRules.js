import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { resolveRules, RULES } from './layoutRules'

/* The fleet's market rules — which clock each species goes on and how high it
 * may be stacked.
 *
 * Starts on the shipped defaults and stays there if there is nothing stored or
 * the read fails. That matters more than it looks: the layout page cannot draw
 * anything without rules, and a boat with no signal must still get its tiers.
 * A missing row is the normal state, not an error.
 */
export function useMarketRules() {
  const [settings, setSettings] = useState(null)
  const [rules, setRules] = useState(RULES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('market_layout_settings').select('data').maybeSingle()
    // Not an error worth stopping for — the defaults are a working set of
    // rules, and they are the ones every fleet ran on until now.
    if (err) setError(err.message)
    const doc = data?.data && Object.keys(data.data).length ? data.data : null
    setSettings(doc)
    setRules(resolveRules(doc))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { rules, settings, loading, error, reload: load, isCustom: !!settings }
}

/* Saving is skipper-only at the database; this just carries the fleet and the
 * author so the row says who last moved a species. */
export async function saveMarketRules(fleetId, doc) {
  const { data: { user } } = await supabase.auth.getUser()
  return supabase.from('market_layout_settings').upsert({
    fleet_id: fleetId,
    data: doc,
    updated_at: new Date().toISOString(),
    updated_by: user?.id ?? null,
  }, { onConflict: 'fleet_id' })
}
