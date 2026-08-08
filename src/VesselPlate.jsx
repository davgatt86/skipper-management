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

// The fleet's own photo behind the plate, when one has been set. Null falls
// back to the solid cobalt plate — that is the designed default, not a gap.
// Signed URL rather than public: the bucket is fleet-isolated like the others.
export function useFleetHero() {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data: me } = await supabase.from('app_users').select('fleet_id').eq('id', (await supabase.auth.getUser()).data.user?.id).maybeSingle()
      if (!me?.fleet_id) return
      const { data: fleet } = await supabase.from('fleets').select('hero_path').eq('id', me.fleet_id).maybeSingle()
      if (cancel || !fleet?.hero_path) return
      const { data } = await supabase.storage.from('fleet-photos').createSignedUrl(fleet.hero_path, 3600)
      if (!cancel && data?.signedUrl) setUrl(data.signedUrl)
    })()
    return () => { cancel = true }
  }, [])
  return url
}

export default function VesselPlate({ vessel, loading, children }) {
  const hero = useFleetHero()
  // Nothing to show yet — hold the space rather than flashing an empty plate.
  const reg = formatPln(vessel?.pln)
  const name = vessel?.vessel_name || ''

  const sub = [
    name,
    vessel?.length_m ? `${Number(vessel.length_m).toFixed(2)} m` : null,
    vessel?.home_port || null
  ].filter(Boolean).join(' · ')

  // The photo sits UNDER a cobalt veil, never raw: the registration is the
  // identity and has to stay readable over whatever the photo happens to be.
  const heroStyle = hero
    ? {
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, var(--hull) 88%, transparent) 0%, color-mix(in srgb, var(--hull) 62%, transparent) 100%), url("${hero}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined

  return (
    <div className="plate" style={heroStyle}>
      <div>
        <div className="reg">{loading ? ' ' : (reg || name.toUpperCase() || 'Vessel')}</div>
        {!loading && sub && <div className="vessel">{sub}</div>}
        {children}
      </div>
    </div>
  )
}
