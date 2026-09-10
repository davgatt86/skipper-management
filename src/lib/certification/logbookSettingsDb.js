import { supabase } from '../../supabaseClient'
import { resolveGuides } from './predeparture'

/* HOW OFTEN THE BOAT MEANS TO HOLD THE RECURRING OLB ENTRIES.
 *
 * One jsonb per fleet holding ONLY WHAT DIFFERS from the shipped guides, the
 * same shape as the market rules and the stores catalogue. Storing the whole
 * set would freeze this fleet's copy of today's defaults, so a later correction
 * would never reach a boat that had once opened the settings.
 */
export async function loadGuides() {
  const { data, error } = await supabase
    .from('logbook_settings').select('data').maybeSingle()
  /* A FLEET WITH NO ROW IS THE ORDINARY CASE, not an error — it means the
     shipped guides, unchanged. */
  if (error) throw error
  return { stored: data?.data || {}, guides: resolveGuides(data?.data) }
}

export async function saveGuides(stored, { fleetId, userId } = {}) {
  const { error } = await supabase.from('logbook_settings').upsert({
    fleet_id: fleetId,
    data: stored,
    updated_at: new Date().toISOString(),
    updated_by: userId || null,
  }, { onConflict: 'fleet_id' })
  if (error) throw error
  return resolveGuides(stored)
}
