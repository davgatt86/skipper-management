import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// The registration number is the identity, so the plate leads with the PLN
// and the vessel name sits underneath it.
//
// Solid cobalt with one angled white flash on the far right (see .plate in
// index.css) — the flash is positioned clear of the lettering, and there is
// no repeating pattern behind text.
//
// vessel_details is one row per fleet and RLS scopes it to the signed-in
// fleet, so this needs no fleet filter of its own.

// "BF83" -> "BF 83". Display only; the canonical label stays "NAME REG".
export function formatPln(pln) {
  if (!pln) return ''
  const clean = String(pln).toUpperCase().replace(/\s+/g, '')
  const m = clean.match(/^([A-Z]+)(\d+)$/)
  return m ? `${m[1]} ${m[2]}` : clean
}

// "AUDACIOUS BF83" — the canonical vessel label used in copy and exports.
export function vesselLabel(v) {
  if (!v) return ''
  const name = (v.vessel_name || '').trim().toUpperCase()
  const pln = (v.pln || '').trim().toUpperCase().replace(/\s+/g, '')
  return [name, pln].filter(Boolean).join(' ')
}

export function useVessel() {
  const [vessel, setVessel] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase
        .from('vessel_details')
        .select('vessel_name, pln, home_port, length_m, call_sign')
        .maybeSingle()
      if (cancel) return
      if (error) console.error('Error loading vessel_details:', error)
      setVessel(data || null)
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  return { vessel, loading }
}

export default function VesselPlate({ vessel, loading, children }) {
  // Nothing to show yet — hold the space rather than flashing an empty plate.
  const reg = formatPln(vessel?.pln)
  const name = vessel?.vessel_name || ''

  const sub = [
    name,
    vessel?.length_m ? `${Number(vessel.length_m).toFixed(2)} m` : null,
    vessel?.home_port || null
  ].filter(Boolean).join(' · ')

  return (
    <div className="plate">
      <div>
        <div className="reg">{loading ? ' ' : (reg || name.toUpperCase() || 'Vessel')}</div>
        {!loading && sub && <div className="vessel">{sub}</div>}
        {children}
      </div>
    </div>
  )
}
