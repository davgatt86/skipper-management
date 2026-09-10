import { supabase } from '../../supabaseClient'

/* "IT DID NOT HAPPEN THIS TRIP" — said once, for one departure.
 *
 * A DECISION ABOUT THE CHECKLIST, never an entry in a book. Writing one makes
 * no entry anywhere; the books remain the only place an entry lives.
 */
export async function listSkips(vesselId) {
  let q = supabase.from('predeparture_skips')
    .select('id, departure_on, item_key, reason, skipped_name, skipped_at')
    .order('departure_on', { ascending: false })
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function skipItem({ fleetId, vesselId, departureOn, itemKey, reason, userId, name }) {
  const { error } = await supabase.from('predeparture_skips').upsert({
    fleet_id: fleetId,
    vessel_id: vesselId || null,
    departure_on: departureOn,
    item_key: itemKey,
    reason: (reason || '').trim() || null,
    skipped_by: userId || null,
    skipped_name: (name || '').trim() || null,
  }, { onConflict: 'fleet_id,vessel_id,departure_on,item_key' })
  if (error) throw error
}

/* PUTTING IT BACK IS ONE CLICK, because a skip is an answer and answers get
   changed. Scoped to the one departure, so it cannot clear another voyage's. */
export async function unskipItem({ vesselId, departureOn, itemKey }) {
  let q = supabase.from('predeparture_skips').delete()
    .eq('departure_on', departureOn).eq('item_key', itemKey)
  q = vesselId ? q.eq('vessel_id', vesselId) : q.is('vessel_id', null)
  const { error } = await q
  if (error) throw error
}
